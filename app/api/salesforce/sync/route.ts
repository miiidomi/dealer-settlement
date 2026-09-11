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
  let nextUrl = `/services/data/v${apiVersion}/query?q=${encodeURIComponent(soql)}`;
  while (nextUrl) {
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

    const token = await getToken(loginUrl, clientId, clientSecret);
    const [accounts, cases, lineItems] = await Promise.all([
      queryAll<SfAccount>(
        token.instance_url,
        token.access_token,
        apiVersion,
        `SELECT Id, Name, BusinessNumber__c, AccountStatus__c, toLabel(AccountStatus__c) AccountStatusLabel FROM Account WHERE ManagingFranchise__c = '${sfDealer}'`,
      ),
      queryAll<SfCase>(
        token.instance_url,
        token.access_token,
        apiVersion,
        `SELECT Id, CaseNumber, AccountId, ContractInstall_Dt__c FROM Case WHERE RecordType.DeveloperName = 'BusinessInquiry' AND FirstType__c = '본사설치' AND Status IN ('계약 및 설치', '종결(성공)') AND Account.ManagingFranchise__c = '${sfDealer}'`,
      ),
      queryAll<SfLineItem>(
        token.instance_url,
        token.access_token,
        apiVersion,
        `SELECT Id, Case__c, fm_ProductName__c, Van__c, Quantity__c, Agreement__c, fm_Type__c, TransactionClassification__c, Fixing__c, Incentive__c, FixingPaymentStatus__c, FixingPaymentDate__c, IncentivePaymentStatus__c, IncentivePaymentDate__c, Amount__c FROM CaseLineItem__c WHERE Case__r.RecordType.DeveloperName = 'BusinessInquiry' AND Case__r.FirstType__c = '본사설치' AND Case__r.Status IN ('계약 및 설치', '종결(성공)') AND Case__r.Account.ManagingFranchise__c = '${sfDealer}'`,
      ),
    ]);
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
      cmsRows = await queryAll<SfCms>(
        token.instance_url,
        token.access_token,
        apiVersion,
        `SELECT Id, Account__c, PayerNumber__c, MonthAmount__c FROM CMS__c WHERE Account__r.ManagingFranchise__c = '${sfDealer}' AND PayerNumber__c != NULL`,
      );
    } catch {
      cmsWarning =
        "CMS 조회를 건너뛰었습니다. 개체 권한과 API 이름을 확인해주세요.";
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
    let existingMerchantRows = await db.select().from(merchants);
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
        .filter((row) => row.salesforceId)
        .map((row) => [row.salesforceId as string, row]),
    );
    const accountByBusinessNumber = new Map<string, SfAccount | null>();
    for (const account of accounts) {
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
      else if (!matchedCost) unpriced += 1;
      return [
        {
          item,
          merchant,
          product,
          contractDate,
          condition,
          caseNumber: parentCase?.CaseNumber || null,
          unitCost: matchedCost?.unitCost ?? 0,
        },
      ];
    });

    if (syncableLineItems.length) {
      await env.DB.batch(
        syncableLineItems.map(
          ({
            item,
            merchant,
            product,
            contractDate,
            condition,
            caseNumber,
            unitCost,
          }) =>
            env.DB.prepare(
              `INSERT INTO installations (merchant_id, product_id, quantity, contract_term_months, unit_cost_snapshot, unit_cost_overridden, salesforce_line_item_id, salesforce_case_id, salesforce_case_number, contract_install_at, condition, van, transaction_classification, fixing, incentive, fixing_payment_status, fixing_payment_date, incentive_payment_status, incentive_payment_date, sales_amount, source, last_synced_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'salesforce', ?) ON CONFLICT(salesforce_line_item_id) DO UPDATE SET merchant_id = excluded.merchant_id, product_id = excluded.product_id, quantity = excluded.quantity, contract_term_months = excluded.contract_term_months, unit_cost_snapshot = CASE WHEN installations.unit_cost_overridden = 1 THEN installations.unit_cost_snapshot WHEN excluded.contract_install_at IS NULL THEN installations.unit_cost_snapshot ELSE excluded.unit_cost_snapshot END, salesforce_case_id = excluded.salesforce_case_id, salesforce_case_number = excluded.salesforce_case_number, contract_install_at = COALESCE(excluded.contract_install_at, installations.contract_install_at), condition = excluded.condition, van = excluded.van, transaction_classification = excluded.transaction_classification, fixing = excluded.fixing, incentive = excluded.incentive, fixing_payment_status = excluded.fixing_payment_status, fixing_payment_date = excluded.fixing_payment_date, incentive_payment_status = excluded.incentive_payment_status, incentive_payment_date = excluded.incentive_payment_date, sales_amount = excluded.sales_amount, source = 'salesforce', last_synced_at = excluded.last_synced_at`,
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
              now,
            ),
        ),
      );
    }

    const syncableCmsRows = cmsRows.flatMap((cms) => {
      const merchant =
        merchantByAccountId.get(cms.Account__c) ??
        manualMerchantByUniqueAccountId.get(cms.Account__c);
      const payerNumber = String(cms.PayerNumber__c ?? "").trim();
      if (!merchant || !payerNumber) return [];
      return [{ cms, merchant, payerNumber }];
    });
    if (syncableCmsRows.length) {
      await env.DB.batch(
        syncableCmsRows.map(({ cms, merchant, payerNumber }) =>
          env.DB.prepare(
            `INSERT INTO payer_accounts (merchant_id, payer_number, label, monthly_charge, billing_type, installment_months, start_month, end_month, active) VALUES (?, ?, 'Salesforce CMS · VAT 별도', ?, 'rental', NULL, ?, NULL, 1) ON CONFLICT(payer_number) DO UPDATE SET merchant_id = excluded.merchant_id, label = excluded.label, monthly_charge = excluded.monthly_charge, billing_type = excluded.billing_type, start_month = CASE WHEN excluded.start_month = '' THEN payer_accounts.start_month ELSE excluded.start_month END, active = 1`,
          ).bind(
            merchant.id,
            payerNumber,
            vatIncludedToSupply(cms.MonthAmount__c),
            merchant.installDate.slice(0, 7),
          ),
        ),
      );
    }

    return Response.json({
      message: "Salesforce 동기화가 완료되었습니다.",
      syncedAt: now,
      accounts: new Set(installableCases.map((row) => row.AccountId)).size,
      cases: installableCases.length,
      lineItems: syncableLineItems.length,
      payerAccounts: syncableCmsRows.length,
      cmsWarning,
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
