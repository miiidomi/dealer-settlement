import { env } from "cloudflare:workers";
import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  dealers,
  merchants,
  productCosts,
  products,
} from "../../../../db/schema";
import { AccessError, assertAdmin, requireAppAccess } from "../../access";

import { installationLifecycle, latestAssetEvents, type AssetEvent, type LifecycleCase, type LinkedAsset } from "../../../asset-lifecycle";
import { penaltyPaymentDate } from "../../../salesforce-settlement";
import { obsoleteInstallationsSql, validateSalesforcePage } from "../../../salesforce-sync-reconciliation";
import { normalizePayerNumber, resolveCmsMerchant, supplementalAccountFilters, isCmsPayer, ensurePayerSyncControlsSql, cmsPayerUpsertSql } from "../../../payer-reconciliation";

type SalesforceToken = { access_token: string; instance_url: string };
type SalesforceQuery<T> = {
  records: T[];
  done: boolean;
  nextRecordsUrl?: string;
};
type SfAccount = {
  Id: string;
  Name: string;
  BusinessNumber__c: string | null;
  AccountStatus__c: string | null;
  AccountStatusLabel?: string | null;
  ManagingFranchise__c: string | null;
};
type SfCase = {
  Id: string;
  CaseNumber: string | null;
  AccountId: string;
  ContractInstall_Dt__c: string | null;
};
type SfLineItem = {
  Id: string;
  Case__c: string;
  fm_IsFromAsset__c: boolean;
  Asset__c: string | null;
  fm_ProductName__c: string | null;
  Van__c: string | null;
  Quantity__c: number | null;
  Agreement__c: number | null;
  fm_Type__c: string | null;
  TransactionClassification__c: string | null;
  Fixing__c: number | null;
  Incentive__c: number | null;
  FixingPaymentStatus__c: string | null;
  FixingPaymentDate__c: string | null;
  IncentivePaymentStatus__c: string | null;
  IncentivePaymentDate__c: string | null;
  Amount__c: number | null;
};
type SfCms = {
  Id: string;
  Account__c: string;
  PayerNumber__c: string | null;
  MonthAmount__c: number | null;
};
type SfProduct = {
  Id: string;
  Name: string;
  Family: string | null;
};

function runtimeValue(name: string) {
  return String((env as unknown as Record<string, unknown>)[name] ?? "").trim();
}

function autoSyncSecretFromRequest(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer "))
    return authorization.slice("bearer ".length).trim();
  return (
    request.headers.get("x-auto-sync-secret") ??
    new URL(request.url).searchParams.get("syncToken") ??
    ""
  ).trim();
}

function isAuthorizedAutoSyncRequest(request: Request) {
  const secret = runtimeValue("AUTO_SYNC_SECRET");
  return secret.length >= 24 && autoSyncSecretFromRequest(request) === secret;
}

function safeDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

function safePaymentStatus(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized === "미입금" || normalized === "입금완료"
    ? normalized
    : null;
}

function normalizeBusinessNumber(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function vatIncludedToSupply(value: number | null | undefined) {
  return Math.round(Number(value ?? 0) / 1.1);
}

async function getToken(
  loginUrl: string,
  clientId: string,
  clientSecret: string,
) {
  const response = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!response.ok)
    throw new Error(
      "Salesforce 인증에 실패했습니다. Connected App과 실행 사용자를 확인해주세요.",
    );
  return (await response.json()) as SalesforceToken;
}

async function queryAll<T>(
  instanceUrl: string,
  accessToken: string,
  apiVersion: string,
  soql: string,
) {
  const rows: T[] = [];
  const visitedUrls = new Set<string>();
  let nextUrl = `/services/data/v${apiVersion}/query?q=${encodeURIComponent(soql)}`;
  while (nextUrl) {
    if (visitedUrls.has(nextUrl))
      throw new Error("Salesforce 조회 페이지가 반복되어 동기화를 중단했습니다.");
    visitedUrls.add(nextUrl);
    const response = await fetch(`${instanceUrl}${nextUrl}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Salesforce 조회에 실패했습니다. 필드 권한과 API명을 확인해주세요. (${response.status}: ${detail.slice(0, 240)})`,
      );
    }
    const page = (await response.json()) as SalesforceQuery<T>;
    validateSalesforcePage(page);
    rows.push(...page.records);
    nextUrl = page.done ? "" : (page.nextRecordsUrl ?? "");
  }
  return rows;
}

function escapeSoql(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

export async function POST(request: Request) {
  try {
    if (!isAuthorizedAutoSyncRequest(request)) {
      const access = await requireAppAccess();
      assertAdmin(access);
    }

    const body = (await request.json().catch(() => ({}))) as {
      dealerId?: number;
    };
    const db = getDb();
    const [dealer] = await db
      .select()
      .from(dealers)
      .where(eq(dealers.id, Number(body.dealerId)))
      .limit(1);
    if (!dealer || !dealer.active)
      return Response.json(
        { error: "동기화할 활성 딜러를 선택해주세요." },
        { status: 400 },
      );
    const managerValue = dealer.salesforceManagerValue?.trim() || dealer.name;
    if (!managerValue)
      return Response.json(
        { error: "딜러의 Salesforce 매칭값을 먼저 등록해주세요." },
        { status: 400 },
      );
    const sfDealer = escapeSoql(managerValue);

    const loginUrl = runtimeValue("SF_LOGIN_URL").replace(/\/$/, "");
    const clientId = runtimeValue("SF_CLIENT_ID");
    const clientSecret = runtimeValue("SF_CLIENT_SECRET");
    const apiVersion = runtimeValue("SF_API_VERSION") || "66.0";
    if (!loginUrl || !clientId || !clientSecret) {
      return Response.json(
        {
          error:
            "Salesforce 연결 설정이 필요합니다. SF_LOGIN_URL, SF_CLIENT_ID, SF_CLIENT_SECRET을 사이트 환경변수에 등록해주세요.",
        },
        { status: 503 },
      );
    }

    const syncStartedAt = new Date().toISOString();
    const token = await getToken(loginUrl, clientId, clientSecret);
    let existingMerchantRows = await db.select().from(merchants);
    const [accounts, cases, lineItems] = await Promise.all([
      queryAll<SfAccount>(
        token.instance_url,
        token.access_token,
        apiVersion,
        `SELECT Id, Name, BusinessNumber__c, ManagingFranchise__c, AccountStatus__c, toLabel(AccountStatus__c) AccountStatusLabel FROM Account WHERE ManagingFranchise__c = '${sfDealer}'`,
      ),
      queryAll<SfCase>(
        token.instance_url,
        token.access_token,
        apiVersion,
        `SELECT Id, CaseNumber, AccountId, ContractInstall_Dt__c FROM Case WHERE RecordType.DeveloperName = 'BusinessInquiry' AND FirstType__c IN ('본사설치', '명의변경') AND Status IN ('계약 및 설치', '종결(성공)') AND Account.ManagingFranchise__c = '${sfDealer}'`,
      ),
      queryAll<SfLineItem>(
        token.instance_url,
        token.access_token,
        apiVersion,
        `SELECT Id, Case__c, fm_IsFromAsset__c, Asset__c, fm_ProductName__c, Van__c, Quantity__c, Agreement__c, fm_Type__c, TransactionClassification__c, Fixing__c, Incentive__c, FixingPaymentStatus__c, FixingPaymentDate__c, IncentivePaymentStatus__c, IncentivePaymentDate__c, Amount__c FROM CaseLineItem__c WHERE Case__r.RecordType.DeveloperName = 'BusinessInquiry' AND Case__r.FirstType__c IN ('본사설치', '명의변경') AND Case__r.Status IN ('계약 및 설치', '종결(성공)') AND Case__r.Account.ManagingFranchise__c = '${sfDealer}'`,
      ),
    ]);
    // CMS for an existing imported merchant must not depend on having an
    // eligible installation Case or a non-empty ManagingFranchise field.
    const accountIndex = new Map(accounts.map(row => [row.Id,row]));
    for (const filter of supplementalAccountFilters(dealer.id,existingMerchantRows)) {
      const extra = await queryAll<SfAccount>(token.instance_url,token.access_token,apiVersion,
        `SELECT Id, Name, BusinessNumber__c, ManagingFranchise__c, AccountStatus__c, toLabel(AccountStatus__c) AccountStatusLabel FROM Account WHERE ${filter}`);
      for (const row of extra) accountIndex.set(row.Id,row);
    }
    accounts.splice(0,accounts.length,...accountIndex.values());
    // Fetch all termination statuses so reverted/cancelled cases stop contributing.
    const terminationCases = dealer.penaltySettlementEnabled ? await queryAll<{
      Id: string; CaseNumber: string; AccountId: string; Status: string;
      Penaltyfee__c: number | null; DepositDate__c: string | null;
    }>(token.instance_url, token.access_token, apiVersion,
      `SELECT Id, CaseNumber, AccountId, Status, Penaltyfee__c, DepositDate__c FROM Case WHERE RecordType.DeveloperName = 'TerminationInquiry' AND Account.ManagingFranchise__c = '${sfDealer}'`,
    ) : [];
    // Query original assets, then completed events referencing those exact IDs.
    // This is independent from penalty settlement and from the new owner's dealer.
    const assetAccountIds = [...new Set([
      ...accounts.map(row => row.Id),
      ...existingMerchantRows.filter(row => row.dealerId === dealer.id && row.salesforceId).map(row => row.salesforceId!),
    ])];
    const linkedAssets: LinkedAsset[] = [];
    for (let start = 0; start < assetAccountIds.length; start += 100) {
      const ids = assetAccountIds.slice(start, start + 100).map(id => `'${escapeSoql(id)}'`).join(",");
      linkedAssets.push(...await queryAll<LinkedAsset>(token.instance_url, token.access_token, apiVersion,
        `SELECT Id, AccountId, Case__c, Quantity, EachLineItem__r.CaseLineItem__c FROM Asset WHERE AccountId IN (${ids})`));
    }
    const assetEvents: AssetEvent[] = [];
    for (let start = 0; start < linkedAssets.length; start += 100) {
      const ids = linkedAssets.slice(start, start + 100).map(row => `'${escapeSoql(row.Id)}'`).join(",");
      const caseFields = ["Id", "Status", "FirstType__c", "RecordType.DeveloperName", "ClosedDate", "ClosedSuccess_Dt__c", "LastModifiedDate"];
      const [direct, individual] = await Promise.all([
        queryAll<{ Id: string; Asset__c: string; Case__r: LifecycleCase }>(token.instance_url, token.access_token, apiVersion,
          `SELECT Id, Asset__c, ${caseFields.map(field => `Case__r.${field}`).join(", ")} FROM CaseLineItem__c WHERE Asset__c IN (${ids}) AND Case__r.RecordType.DeveloperName IN ('BusinessInquiry', 'TerminationInquiry')`),
        queryAll<{ Id: string; SourceAsset__c: string; CaseLineItem__r: { Case__r: LifecycleCase } | null }>(token.instance_url, token.access_token, apiVersion,
          `SELECT Id, SourceAsset__c, ${caseFields.map(field => `CaseLineItem__r.Case__r.${field}`).join(", ")} FROM EachLineItem__c WHERE SourceAsset__c IN (${ids}) AND CaseLineItem__r.Case__r.RecordType.DeveloperName IN ('BusinessInquiry', 'TerminationInquiry')`),
      ]);
      for (const row of direct) if (row.Case__r) assetEvents.push({ assetId: row.Asset__c, case: row.Case__r });
      for (const row of individual) if (row.CaseLineItem__r?.Case__r) assetEvents.push({ assetId: row.SourceAsset__c, case: row.CaseLineItem__r.Case__r });
    }
    const lifecycleByAssetId = latestAssetEvents(assetEvents);
    const assetsByLineItemId = new Map<string, LinkedAsset[]>();
    const assetsById = new Map(linkedAssets.map(row => [row.Id, row]));
    for (const asset of linkedAssets) {
      const itemId = asset.EachLineItem__r?.CaseLineItem__c;
      if (itemId) assetsByLineItemId.set(itemId, [...(assetsByLineItemId.get(itemId) ?? []), asset]);
    }
    const queriedCasesById = new Map(cases.map(row => [row.Id, row]));
    const directlyLinkedAssets = new Set(lineItems.filter(row => row.Asset__c).map(row => `${row.Asset__c}:${queriedCasesById.get(row.Case__c)?.AccountId}`));
    const assetLinkWarnings = linkedAssets.filter(row => lifecycleByAssetId.has(row.Id) && !row.EachLineItem__r?.CaseLineItem__c && !directlyLinkedAssets.has(`${row.Id}:${row.AccountId}`)).length;
    let salesforceProducts: SfProduct[] = [];
    try {
      salesforceProducts = await queryAll<SfProduct>(
        token.instance_url,
        token.access_token,
        apiVersion,
        "SELECT Id, Name, Family FROM Product2 WHERE IsActive = true",
      );
    } catch {
      salesforceProducts = [];
    }
    let cmsRows: SfCms[] = [];
    let cmsWarning: string | null = null;
    try {
      const cmsAccountIds = accounts.map(row => row.Id);
      for (let start=0; start<cmsAccountIds.length; start+=200) {
      const ids = cmsAccountIds.slice(start,start+200).map(id => `'${escapeSoql(id)}'`).join(',');
      cmsRows.push(...await queryAll<SfCms>(
        token.instance_url,
        token.access_token,
        apiVersion,
        `SELECT Id, Account__c, PayerNumber__c, MonthAmount__c FROM CMS__c WHERE Account__c IN (${ids}) AND PayerNumber__c != NULL`,
      ));
      }
    } catch (error) {
      cmsRows = [];
      cmsWarning =
        `CMS 조회에 실패했습니다. 개체·필드 권한과 API 이름을 확인해주세요. ${error instanceof Error ? error.message : "조회 오류"}`;
    }

    const now = new Date().toISOString();
    const caseIdsWithProducts = new Set(lineItems.map((row) => row.Case__c));
    const eligibleCases = cases.filter((row) =>
      caseIdsWithProducts.has(row.Id),
    );
    const casesById = new Map(eligibleCases.map((row) => [row.Id, row]));
    const accountById = new Map(accounts.map((row) => [row.Id, row]));
    const installableCases = eligibleCases.filter((row) =>
      accountById.has(row.AccountId),
    );
    const casesByAccount = new Map<string, SfCase[]>();
    for (const caseRow of installableCases) {
      const rows = casesByAccount.get(caseRow.AccountId) ?? [];
      rows.push(caseRow);
      casesByAccount.set(caseRow.AccountId, rows);
    }
    for (const [accountId, accountCases] of casesByAccount) {
      const account = accountById.get(accountId)!;
      const caseIds = new Set(accountCases.map((row) => row.Id));
      const candidates = existingMerchantRows.filter(
        (row) =>
          row.dealerId === dealer.id &&
          (row.salesforceId === account.Id ||
            (row.salesforceId ? caseIds.has(row.salesforceId) : false) ||
            (!row.salesforceId &&
              Boolean(account.BusinessNumber__c) &&
              normalizeBusinessNumber(row.businessNumber) ===
                normalizeBusinessNumber(account.BusinessNumber__c))),
      );
      let canonical =
        candidates.find((row) => row.salesforceId === account.Id) ??
        candidates[0];
      const salesforceInstallDate = accountCases
        .map((row) => safeDate(row.ContractInstall_Dt__c))
        .filter(Boolean)
        .sort()[0];
      const installDate = [salesforceInstallDate, canonical?.installDate]
        .filter((value): value is string => Boolean(value))
        .sort()[0] ?? "";
      const values = {
        name: account.Name || "상호 미등록",
        businessNumber: account.BusinessNumber__c || "",
        dealerId: dealer.id,
        installDate,
        accountStatus:
          account.AccountStatusLabel || account.AccountStatus__c || null,
        salesforceId: account.Id,
        lastSyncedAt: now,
      };
      if (canonical) {
        for (const duplicate of candidates.filter(
          (row) => row.id !== canonical!.id,
        )) {
          await env.DB.batch([
            env.DB.prepare("UPDATE payments SET merchant_id = ? WHERE merchant_id = ?").bind(
              canonical.id,
              duplicate.id,
            ),
            env.DB.prepare("UPDATE billings SET merchant_id = ? WHERE merchant_id = ?").bind(
              canonical.id,
              duplicate.id,
            ),
            env.DB.prepare("UPDATE installations SET merchant_id = ? WHERE merchant_id = ?").bind(
              canonical.id,
              duplicate.id,
            ),
            env.DB.prepare("UPDATE payer_accounts SET merchant_id = ? WHERE merchant_id = ?").bind(
              canonical.id,
              duplicate.id,
            ),
            env.DB.prepare("UPDATE cancellation_penalties SET merchant_id = ? WHERE merchant_id = ?").bind(canonical.id, duplicate.id),
            env.DB.prepare("DELETE FROM merchants WHERE id = ?").bind(duplicate.id),
          ]);
          existingMerchantRows = existingMerchantRows.filter(
            (row) => row.id !== duplicate.id,
          );
        }
        [canonical] = await db
          .update(merchants)
          .set(values)
          .where(eq(merchants.id, canonical.id))
          .returning();
        existingMerchantRows = existingMerchantRows.map((row) =>
          row.id === canonical.id ? canonical : row,
        );
      } else {
        [canonical] = await db.insert(merchants).values(values).returning();
        existingMerchantRows.push(canonical);
      }
    }

    const productNames = [
      ...new Set(
        lineItems
          .map((row) => row.fm_ProductName__c?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const familyByProductName = new Map(
      salesforceProducts.map((row) => [
        row.Name.trim(),
        row.Family?.trim() || "미지정",
      ]),
    );
    const existingProducts = await db
      .select()
      .from(products)
      .orderBy(asc(products.id));
    const existingNames = new Set(existingProducts.map((row) => row.name));
    const missingProducts = productNames.filter(
      (name) => !existingNames.has(name),
    );
    if (missingProducts.length)
      await db
        .insert(products)
        .values(
          missingProducts.map((name) => ({
            name,
            category: familyByProductName.get(name) ?? "미지정",
            active: true,
          })),
        );
    const productsToUpdate = existingProducts.filter((product) => {
      const family = familyByProductName.get(product.name.trim());
      return (
        family &&
        family !== product.category &&
        ["Salesforce", "Salesforce Product2", "미지정", "수동 등록"].includes(
          product.category,
        )
      );
    });
    if (productsToUpdate.length)
      await env.DB.batch(
        productsToUpdate.map((product) =>
          env.DB.prepare("UPDATE products SET category = ? WHERE id = ?").bind(
            familyByProductName.get(product.name.trim())!,
            product.id,
          ),
        ),
      );

    const [merchantRows, productRows, costRows] = await Promise.all([
      db.select().from(merchants),
      db.select().from(products),
      db.select().from(productCosts),
    ]);
    const merchantByAccountId = new Map(
      merchantRows
        .filter((row) => row.salesforceId && row.dealerId === dealer.id)
        .map((row) => [row.salesforceId as string, row]),
    );
    const accountByBusinessNumber = new Map<string, SfAccount | null>();
    for (const account of accounts) {
      if (account.ManagingFranchise__c && account.ManagingFranchise__c !== managerValue) continue;
      const businessNumber = normalizeBusinessNumber(
        account.BusinessNumber__c,
      );
      if (!businessNumber) continue;
      accountByBusinessNumber.set(
        businessNumber,
        accountByBusinessNumber.has(businessNumber) ? null : account,
      );
    }
    const manualMerchantsByBusinessNumber = new Map<
      string,
      typeof merchantRows
    >();
    for (const merchant of merchantRows) {
      if (merchant.dealerId !== dealer.id || merchant.salesforceId) continue;
      const businessNumber = normalizeBusinessNumber(merchant.businessNumber);
      if (!businessNumber) continue;
      const rows = manualMerchantsByBusinessNumber.get(businessNumber) ?? [];
      rows.push(merchant);
      manualMerchantsByBusinessNumber.set(businessNumber, rows);
    }
    const manualMerchantByUniqueAccountId = new Map<
      string,
      (typeof merchantRows)[number]
    >();
    for (const [
      businessNumber,
      manualMerchantRows,
    ] of manualMerchantsByBusinessNumber) {
      if (manualMerchantRows.length !== 1) continue;
      const account = accountByBusinessNumber.get(businessNumber);
      if (!account || merchantByAccountId.has(account.Id)) continue;
      manualMerchantByUniqueAccountId.set(account.Id, manualMerchantRows[0]);
    }
    const manualStatusRows = [...manualMerchantByUniqueAccountId.entries()]
      .map(([accountId, merchant]) => {
        const account = accountById.get(accountId);
        const accountStatus =
          account?.AccountStatusLabel || account?.AccountStatus__c || null;
        return accountStatus ? { merchant, accountStatus } : null;
      })
      .filter(
        (
          row,
        ): row is {
          merchant: (typeof merchantRows)[number];
          accountStatus: string;
        } => Boolean(row),
      );
    if (manualStatusRows.length) {
      await env.DB.batch(
        manualStatusRows.map(({ merchant, accountStatus }) =>
          env.DB.prepare(
            "UPDATE merchants SET account_status = ?, last_synced_at = ? WHERE id = ?",
          ).bind(accountStatus, now, merchant.id),
        ),
      );
    }
    const productByName = new Map(productRows.map((row) => [row.name, row]));
    let unpriced = 0;
    let undated = 0;
    const syncableLineItems = lineItems.flatMap((item) => {
      const parentCase = casesById.get(item.Case__c);
      const merchant = parentCase
        ? merchantByAccountId.get(parentCase.AccountId)
        : undefined;
      const product = item.fm_ProductName__c
        ? productByName.get(item.fm_ProductName__c.trim())
        : undefined;
      if (!merchant || !product) return [];
      const contractDate = safeDate(parentCase?.ContractInstall_Dt__c);
      const condition = item.fm_Type__c?.trim() || "신품";
      const matchedCost = contractDate
        ? costRows
            .filter(
              (cost) =>
                cost.productId === product.id &&
                cost.condition === condition &&
                cost.effectiveFrom <= contractDate,
            )
            .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
        : undefined;
      if (!contractDate) undated += 1;
      else if (!matchedCost && !item.fm_IsFromAsset__c) unpriced += 1;
      return [
        {
          item,
          merchant,
          product,
          contractDate,
          condition,
          caseNumber: parentCase?.CaseNumber || null,
          unitCost: item.fm_IsFromAsset__c ? 0 : (matchedCost?.unitCost ?? 0),
          assetLifecycle: installationLifecycle([
            ...(assetsByLineItemId.get(item.Id) ?? []).filter(asset => asset.AccountId === parentCase?.AccountId),
            ...(item.Asset__c && assetsById.get(item.Asset__c)?.AccountId === parentCase?.AccountId ? [assetsById.get(item.Asset__c)!] : []),
          ], lifecycleByAssetId),
        },
      ];
    });

    // Upserts and removal are one atomic batch. Remove only this dealer's
    // Salesforce rows absent from the complete query, including an empty result.
    // Rows written by a newer concurrent sync are protected by the start time.
    const installationResults = await env.DB.batch([
        ...syncableLineItems.map(
          ({
            item,
            merchant,
            product,
            contractDate,
            condition,
            caseNumber,
            unitCost,
            assetLifecycle,
          }) =>
            env.DB.prepare(
              `INSERT INTO installations (merchant_id, product_id, quantity, contract_term_months, unit_cost_snapshot, unit_cost_overridden, salesforce_line_item_id, salesforce_case_id, salesforce_case_number, contract_install_at, condition, van, transaction_classification, fixing, incentive, fixing_payment_status, fixing_payment_date, incentive_payment_status, incentive_payment_date, sales_amount, is_from_asset, asset_lifecycle, source, last_synced_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'salesforce', ?) ON CONFLICT(salesforce_line_item_id) DO UPDATE SET merchant_id = excluded.merchant_id, product_id = excluded.product_id, quantity = excluded.quantity, contract_term_months = excluded.contract_term_months, unit_cost_snapshot = CASE WHEN excluded.is_from_asset = 1 THEN 0 WHEN installations.is_from_asset = 1 AND excluded.is_from_asset = 0 THEN excluded.unit_cost_snapshot WHEN installations.unit_cost_overridden = 1 THEN installations.unit_cost_snapshot WHEN excluded.contract_install_at IS NULL THEN installations.unit_cost_snapshot ELSE excluded.unit_cost_snapshot END, salesforce_case_id = excluded.salesforce_case_id, salesforce_case_number = excluded.salesforce_case_number, contract_install_at = COALESCE(excluded.contract_install_at, installations.contract_install_at), condition = excluded.condition, van = excluded.van, transaction_classification = excluded.transaction_classification, fixing = CASE WHEN installations.fixing_settlement_month IS NOT NULL THEN installations.fixing ELSE excluded.fixing END, incentive = CASE WHEN installations.incentive_settlement_month IS NOT NULL THEN installations.incentive ELSE excluded.incentive END, fixing_payment_status = CASE WHEN installations.fixing_settlement_month IS NOT NULL THEN installations.fixing_payment_status ELSE excluded.fixing_payment_status END, fixing_payment_date = CASE WHEN installations.fixing_settlement_month IS NOT NULL THEN installations.fixing_payment_date ELSE excluded.fixing_payment_date END, incentive_payment_status = CASE WHEN installations.incentive_settlement_month IS NOT NULL THEN installations.incentive_payment_status ELSE excluded.incentive_payment_status END, incentive_payment_date = CASE WHEN installations.incentive_settlement_month IS NOT NULL THEN installations.incentive_payment_date ELSE excluded.incentive_payment_date END, unit_cost_overridden = CASE WHEN installations.is_from_asset = 1 AND excluded.is_from_asset = 0 THEN 0 ELSE installations.unit_cost_overridden END, sales_amount = excluded.sales_amount, is_from_asset = excluded.is_from_asset, asset_lifecycle = excluded.asset_lifecycle, source = 'salesforce', last_synced_at = excluded.last_synced_at`,
            ).bind(
              merchant.id,
              product.id,
              Math.max(1, Math.round(Number(item.Quantity__c ?? 1))),
              Math.max(1, Math.round(Number(item.Agreement__c ?? 36))),
              unitCost,
              item.Id,
              item.Case__c,
              caseNumber,
              contractDate || null,
              condition,
              item.Van__c || null,
              item.TransactionClassification__c || null,
              Math.round(Number(item.Fixing__c ?? 0)),
              Math.round(Number(item.Incentive__c ?? 0)),
              safePaymentStatus(item.FixingPaymentStatus__c),
              safeDate(item.FixingPaymentDate__c) || null,
              safePaymentStatus(item.IncentivePaymentStatus__c),
              safeDate(item.IncentivePaymentDate__c) || null,
              vatIncludedToSupply(item.Amount__c),
              item.fm_IsFromAsset__c ? 1 : 0,
              assetLifecycle,
              now,
            ),
        ),
        env.DB.prepare(obsoleteInstallationsSql).bind(
          dealer.id,
          syncStartedAt,
          JSON.stringify(lineItems.map(item => item.Id)),
        ),
    ]);
    const removedLineItems = installationResults.at(-1)?.meta.changes ?? 0;

    let penaltyUndated = 0;
    let penaltyCount = 0;
    if (dealer.penaltySettlementEnabled) {
      const penaltyStatements = [env.DB.prepare("DELETE FROM cancellation_penalties WHERE dealer_id = ?").bind(dealer.id)];
      for (const row of terminationCases) {
        const account = accountById.get(row.AccountId);
        if (!account) continue;
        let merchant = merchantByAccountId.get(row.AccountId) ?? manualMerchantByUniqueAccountId.get(row.AccountId);
        if (!merchant && ["해지완료", "해지완료(미회수)"].includes(row.Status) && Number(row.Penaltyfee__c) > 0) {
          [merchant] = await db.insert(merchants).values({ name: account.Name, businessNumber: account.BusinessNumber__c || "", dealerId: dealer.id, installDate: "", accountStatus: account.AccountStatusLabel || account.AccountStatus__c, salesforceId: account.Id, lastSyncedAt: now }).returning();
          merchantByAccountId.set(account.Id, merchant);
        }
        if (!merchant) continue;
        const paymentDate = penaltyPaymentDate(row.DepositDate__c);
        const amount = Math.max(0, Math.round(Number(row.Penaltyfee__c ?? 0)));
        if (["해지완료", "해지완료(미회수)"].includes(row.Status) && amount > 0) {
          if (!paymentDate) penaltyUndated++;
          else penaltyCount++;
        }
        penaltyStatements.push(env.DB.prepare(`INSERT INTO cancellation_penalties (dealer_id, merchant_id, salesforce_case_id, case_number, status, amount, payment_date, raw_payment_date, last_synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(salesforce_case_id) DO UPDATE SET dealer_id = excluded.dealer_id, merchant_id = excluded.merchant_id, case_number = excluded.case_number, status = excluded.status, amount = excluded.amount, payment_date = excluded.payment_date, raw_payment_date = excluded.raw_payment_date, last_synced_at = excluded.last_synced_at`).bind(dealer.id, merchant.id, row.Id, row.CaseNumber, row.Status, amount, paymentDate, row.DepositDate__c, now));
      }
      await env.DB.batch(penaltyStatements);
    }

    await env.DB.prepare(ensurePayerSyncControlsSql).run();
    const controls = await env.DB.prepare(
      "SELECT payer_number, action FROM payer_sync_controls WHERE dealer_id=?",
    ).bind(dealer.id).all<{ payer_number: string; action: string }>();
    const controlsByNumber = new Map(controls.results.map(row => [normalizePayerNumber(row.payer_number), row.action]));
    const payerRows = await env.DB.prepare("SELECT id,merchant_id,payer_number,label,active FROM payer_accounts")
      .all<{ id: number; merchant_id: number; payer_number: string; label: string | null; active: number }>();
    // Older imports stored a Case ID rather than the Account ID. Resolve those
    // IDs independently from the installation eligibility conditions.
    const legacyIds = [...new Set(merchantRows.filter(row => row.dealerId === dealer.id &&
      row.salesforceId?.startsWith("500") && /^[a-zA-Z0-9]{15,18}$/.test(row.salesforceId))
      .map(row => row.salesforceId!))];
    const legacyCases: Array<{ Id: string; AccountId: string }> = [];
    for (let start=0; start<legacyIds.length; start+=200) {
      const ids = legacyIds.slice(start,start+200).map(id => `'${escapeSoql(id)}'`).join(",");
      legacyCases.push(...await queryAll<{ Id: string; AccountId: string }>(
        token.instance_url,token.access_token,apiVersion,`SELECT Id,AccountId FROM Case WHERE Id IN (${ids})`,
      ));
    }
    const cmsIssues: Array<{ cmsId: string; accountName: string; payerNumber: string; reason: string }> = [];
    const cmsPreserved: Array<{ cmsId: string; accountName: string; payerNumber: string; reason: string }> = [];
    const cmsGroups = new Map<string, SfCms[]>();
    for (const row of cmsRows) {
      const key = normalizePayerNumber(row.PayerNumber__c);
      cmsGroups.set(key, [...(cmsGroups.get(key) ?? []), row]);
    }
    const syncableCmsRows: Array<{ cms: SfCms; merchant: (typeof merchantRows)[number]; payerNumber: string }> = [];
    const cmsStatements: Array<ReturnType<typeof env.DB.prepare>> = [];
    for (const [payerNumber, group] of cmsGroups) {
      const cms = group[0];
      const account = accountById.get(cms.Account__c);
      const issue = (reason: string) => ({ cmsId: cms.Id, accountName: account?.Name || "가맹점 확인 필요", payerNumber, reason });
      if (!payerNumber) { cmsIssues.push(issue("납부자번호가 비어 있습니다.")); continue; }
      if (group.some(row => row.Account__c !== cms.Account__c || Number(row.MonthAmount__c) !== Number(cms.MonthAmount__c))) {
        cmsIssues.push(issue("동일 납부자번호의 CMS 가맹점 또는 월 청구금액이 달라 자동 연결을 보류했습니다.")); continue;
      }
      const control = controlsByNumber.get(payerNumber);
      if (control) {
        cmsPreserved.push(issue(control === "deleted" ? "수동 삭제한 번호를 다시 등록하지 않았습니다." : "수동 수정한 내용을 유지했습니다.")); continue;
      }
      const match = resolveCmsMerchant(account,dealer.id,merchantRows,accounts,legacyCases,managerValue);
      if (!match.merchant) { cmsIssues.push(issue(match.reason!)); continue; }
      const merchant = match.merchant;
      const previousRows = payerRows.results.filter(row => normalizePayerNumber(row.payer_number) === payerNumber);
      if (previousRows.length > 1 || previousRows.some(row => row.merchant_id !== merchant.id)) {
        cmsIssues.push(issue("이미 다른 가맹점에 등록되었거나 중복된 납부자번호입니다. 자동 이동하지 않았습니다.")); continue;
      }
      const previous = previousRows[0];
      if (previous && (!isCmsPayer(previous.label) || !previous.active)) {
        cmsPreserved.push(issue("수동 등록한 번호 또는 비활성 번호의 설정을 유지했습니다.")); continue;
      }
      const charge = Number(cms.MonthAmount__c ?? 0);
      if (!Number.isFinite(charge) || charge < 0) {
        cmsIssues.push(issue("CMS 월 청구금액이 올바르지 않습니다.")); continue;
      }
      if (previous && previous.payer_number !== payerNumber) {
        cmsStatements.push(env.DB.prepare(`UPDATE payer_accounts SET payer_number=? WHERE id=? AND NOT EXISTS
          (SELECT 1 FROM payer_sync_controls WHERE dealer_id=? AND payer_number=?)`)
          .bind(payerNumber,previous.id,dealer.id,payerNumber));
      }
      cmsStatements.push(env.DB.prepare(cmsPayerUpsertSql).bind(
        merchant.id,payerNumber,vatIncludedToSupply(charge),merchant.installDate.slice(0,7),
        dealer.id,payerNumber,dealer.id,payerNumber,
      ));
      syncableCmsRows.push({ cms,merchant,payerNumber });
    }
    for (let start=0; start<cmsStatements.length; start+=100)
      await env.DB.batch(cmsStatements.slice(start,start+100));

    return Response.json({
      message: assetLinkWarnings ? `Salesforce 동기화가 완료되었습니다. 원본 문의제품 연결이 없는 자산 ${assetLinkWarnings}건은 상태 표시에 반영하지 못했습니다.` : "Salesforce 동기화가 완료되었습니다.",
      assetLinkWarnings,
      reusedLineItems: syncableLineItems.filter(row => row.item.fm_IsFromAsset__c).length,
      syncedAt: now,
      accounts: new Set(installableCases.map((row) => row.AccountId)).size,
      cases: installableCases.length,
      lineItems: syncableLineItems.length,
      removedLineItems,
      payerAccounts: syncableCmsRows.length,
      cmsWarning,
      cmsIssues,
      cmsPreserved,
      cmsFetched: cmsRows.length,
      penaltyCount,
      penaltyUndated,
      unpriced,
      undated,
      skippedAccountsWithoutProductCase:
        accounts.length -
        new Set(installableCases.map((row) => row.AccountId)).size,
      skippedCasesWithoutProducts: cases.length - eligibleCases.length,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Salesforce 동기화 중 오류가 발생했습니다.";
    return Response.json(
      { error: message },
      { status: error instanceof AccessError ? error.status : 500 },
    );
  }
}

