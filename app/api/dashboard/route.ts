import { env } from "cloudflare:workers";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  advancePayments,
  billings,
  dealerCategoryCosts,
  dealerCommissionRules,
  dealerMembers,
  dealerProductCosts,
  dealerRules,
  dealers,
  installations,
  merchants,
  monthlySettlementStatuses,
  payerAccounts,
  paymentImports,
  payments,
  productCosts,
  products,
  vanSettlements,
} from "../../../db/schema";
import {
  AccessError,
  AppAccess,
  assertAdmin,
  requireAppAccess,
  requireMerchantAccess,
} from "../access";
import {
  DEFAULT_MERCHANT_DETAIL_BILLING_COLUMNS,
  DEFAULT_MERCHANT_DETAIL_FIELDS,
  DEFAULT_MERCHANT_DETAIL_INSTALLATION_COLUMNS,
  DEFAULT_MERCHANT_DETAIL_PAYER_COLUMNS,
  DEFAULT_MERCHANT_LIST_COLUMNS,
  DEFAULT_MAIN_SUMMARY_CARDS,
  DEFAULT_SETTLEMENT_LIST_COLUMNS,
  MERCHANT_DETAIL_BILLING_COLUMNS,
  MERCHANT_DETAIL_FIELDS,
  MERCHANT_DETAIL_INSTALLATION_COLUMNS,
  MERCHANT_DETAIL_PAYER_COLUMNS,
  MERCHANT_LIST_COLUMNS,
  MAIN_SUMMARY_CARDS,
  SETTLEMENT_LIST_COLUMNS,
} from "../../types";

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "알 수 없는 오류";
  if (message.includes("no such table"))
    return "데이터베이스 준비가 완료되지 않았습니다.";
  if (message.includes("UNIQUE constraint failed: payer_accounts.payer_number"))
    return "이미 등록된 납부자번호입니다.";
  return message;
}

function normalizePayerNumber(value: unknown) {
  return String(value ?? "")
    .trim()
    .replaceAll(" ", "")
    .replaceAll("-", "");
}

function normalizeBusinessNumber(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\D/g, "");
}

function normalizeProductName(value: unknown) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function paymentStatus(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized === "미입금" || normalized === "입금완료" ? normalized : null;
}

function paymentDate(value: unknown) {
  const normalized = String(value ?? "").trim();
  return DATE_PATTERN.test(normalized) ? normalized : null;
}

type SalesforceProductCatalogRow = {
  Id: string;
  Name: string;
  Family: string | null;
  Type__c: string | null;
};

type SalesforceQueryPage<T> = {
  records: T[];
  done: boolean;
  nextRecordsUrl?: string;
};

async function loadSalesforceProductCatalog() {
  const runtime = env as unknown as Record<string, unknown>;
  const loginUrl = String(runtime.SF_LOGIN_URL ?? "").trim().replace(/\/$/, "");
  const clientId = String(runtime.SF_CLIENT_ID ?? "").trim();
  const clientSecret = String(runtime.SF_CLIENT_SECRET ?? "").trim();
  const apiVersion = String(runtime.SF_API_VERSION ?? "").trim() || "66.0";
  if (!loginUrl || !clientId || !clientSecret)
    throw new Error(
      "Salesforce 제품 확인을 위한 연결 환경변수가 등록되지 않았습니다.",
    );

  const tokenResponse = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!tokenResponse.ok)
    throw new Error(
      "Salesforce 인증에 실패했습니다. Connected App과 실행 사용자를 확인해주세요.",
    );
  const token = (await tokenResponse.json()) as {
    access_token: string;
    instance_url: string;
  };

  const products: SalesforceProductCatalogRow[] = [];
  let nextUrl = `/services/data/v${apiVersion}/query?q=${encodeURIComponent(
    "SELECT Id, Name, Family, Type__c FROM Product2 WHERE IsActive = true ORDER BY Name, Type__c",
  )}`;
  while (nextUrl) {
    const response = await fetch(`${token.instance_url}${nextUrl}`, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Salesforce Product2 조회에 실패했습니다. (${response.status}: ${detail.slice(0, 180)})`,
      );
    }
    const page = (await response.json()) as SalesforceQueryPage<SalesforceProductCatalogRow>;
    products.push(...page.records);
    nextUrl = page.done ? "" : (page.nextRecordsUrl ?? "");
  }
  return products;
}

async function resolveSalesforceProducts<
  T extends { productName: string; condition?: string },
>(rows: T[]) {
  const catalog = await loadSalesforceProductCatalog();
  const catalogByName = new Map<string, SalesforceProductCatalogRow[]>();
  for (const product of catalog) {
    const key = normalizeProductName(product.Name);
    const matches = catalogByName.get(key) ?? [];
    matches.push(product);
    catalogByName.set(key, matches);
  }

  const requested = new Map<string, T[]>();
  for (const row of rows) {
    const key = normalizeProductName(row.productName);
    const matches = requested.get(key) ?? [];
    matches.push(row);
    requested.set(key, matches);
  }

  const resolved = new Map<
    string,
    { name: string; family: string }
  >();
  const missing: string[] = [];
  const missingFamily: string[] = [];
  for (const [name, requestedRows] of requested) {
    const candidates = catalogByName.get(name) ?? [];
    if (!candidates.length) {
      missing.push(requestedRows[0].productName);
      continue;
    }
    const conditions = new Set(
      requestedRows.map((row) => String(row.condition ?? "").trim()),
    );
    const product =
      candidates.find((candidate) => conditions.has(candidate.Type__c ?? "")) ??
      candidates[0];
    const family = product.Family?.trim();
    if (!family) {
      missingFamily.push(product.Name);
      continue;
    }
    resolved.set(name, { name: product.Name.trim(), family });
  }
  if (missing.length)
    throw new Error(
      `Salesforce Product2에서 찾을 수 없는 제품입니다: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " 외" : ""}`,
    );
  if (missingFamily.length)
    throw new Error(
      `Salesforce에서 제품군(Family)이 지정되지 않은 제품입니다: ${missingFamily.slice(0, 8).join(", ")}${missingFamily.length > 8 ? " 외" : ""}`,
    );
  return resolved;
}

function selectedIds(value: unknown, limit = 500) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ].slice(0, limit + 1);
}

function selectedKeys<T extends string>(
  value: unknown,
  options: readonly { key: T }[],
  defaults: readonly T[],
) {
  if (!Array.isArray(value)) return JSON.stringify(defaults);
  const allowed = new Set(options.map((item) => item.key));
  const keys = value.filter(
    (item): item is T => typeof item === "string" && allowed.has(item as T),
  );
  return JSON.stringify(keys);
}

const VAT_NET_SALESFORCE_SYNC_CUTOFF = "2026-09-05T00:00:00.000Z";
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function numberList(value: unknown) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [
    ...new Set(
      values
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0),
    ),
  ];
}

async function snapshot(access: AppAccess) {
  const db = getDb();
  const [
    allDealers,
    allRules,
    productRows,
    costRows,
    dealerProductCostRows,
    dealerCategoryCostRows,
    dealerCommissionRuleRows,
    allMerchants,
    allInstallations,
    allBillings,
    allPayers,
    allPayments,
    allAdvances,
    allMonthlySettlementStatuses,
    allVanSettlements,
    memberRows,
  ] = await Promise.all([
    db.select().from(dealers).orderBy(dealers.id),
    db.select().from(dealerRules).orderBy(desc(dealerRules.effectiveFrom)),
    db.select().from(products).orderBy(products.id),
    db.select().from(productCosts).orderBy(desc(productCosts.effectiveFrom)),
    db
      .select()
      .from(dealerProductCosts)
      .orderBy(desc(dealerProductCosts.effectiveFrom)),
    db
      .select()
      .from(dealerCategoryCosts)
      .orderBy(desc(dealerCategoryCosts.effectiveFrom)),
    db
      .select()
      .from(dealerCommissionRules)
      .orderBy(desc(dealerCommissionRules.effectiveFrom)),
    db.select().from(merchants).orderBy(desc(merchants.installDate)),
    db.select().from(installations).orderBy(installations.id),
    db
      .select()
      .from(billings)
      .orderBy(desc(billings.billingMonth), desc(billings.id)),
    db.select().from(payerAccounts).orderBy(payerAccounts.id),
    db
      .select()
      .from(payments)
      .orderBy(desc(payments.paymentDate), desc(payments.id)),
    db
      .select()
      .from(advancePayments)
      .orderBy(desc(advancePayments.paymentDate), desc(advancePayments.id)),
    db
      .select()
      .from(monthlySettlementStatuses)
      .orderBy(
        desc(monthlySettlementStatuses.settlementMonth),
        desc(monthlySettlementStatuses.id),
      ),
    db
      .select()
      .from(vanSettlements)
      .orderBy(desc(vanSettlements.settlementMonth), vanSettlements.vanCompany),
    access.role === "admin"
      ? db.select().from(dealerMembers).orderBy(dealerMembers.id)
      : Promise.resolve([]),
  ]);

  const allowedDealers =
    access.role === "admin" || access.role === "viewer"
      ? allDealers
      : allDealers.filter((row) => row.id === access.dealerId);
  const dealerIds = new Set(allowedDealers.map((row) => row.id));
  const merchantRows = allMerchants.filter((row) =>
    dealerIds.has(row.dealerId),
  );
  const merchantIds = new Set(merchantRows.map((row) => row.id));
  const merchantById = new Map(merchantRows.map((row) => [row.id, row]));
  const productById = new Map(productRows.map((row) => [row.id, row]));
  const installationRows = allInstallations
    .filter((row) => merchantIds.has(row.merchantId))
    .map((row) => {
      const normalizedRow =
        row.source === "salesforce" &&
        (!row.lastSyncedAt || row.lastSyncedAt < VAT_NET_SALESFORCE_SYNC_CUTOFF)
          ? { ...row, salesAmount: Math.round(row.salesAmount / 1.1) }
          : row;
      const installedAt = (normalizedRow.contractInstallAt || "").slice(0, 10);
      const merchant = merchantById.get(normalizedRow.merchantId);
      const dealerCost = dealerProductCostRows.find(
        (cost) =>
          cost.dealerId === merchant?.dealerId &&
          cost.productId === normalizedRow.productId &&
          cost.condition === normalizedRow.condition &&
          cost.effectiveFrom <= installedAt,
      );
      const product = productById.get(normalizedRow.productId);
      const categoryCost = dealerCategoryCostRows.find(
        (cost) =>
          cost.dealerId === merchant?.dealerId &&
          cost.productCategory === product?.category &&
          cost.condition === normalizedRow.condition &&
          cost.effectiveFrom <= installedAt,
      );
      const effectiveCost = costRows.find(
        (cost) =>
          cost.productId === normalizedRow.productId &&
          cost.condition === normalizedRow.condition &&
          cost.effectiveFrom <= installedAt,
      );
      if (normalizedRow.unitCostOverridden && product?.directCostAllowed)
        return {
          ...normalizedRow,
          unitCostRegistered: true,
        };
      const matchedCost = dealerCost ?? categoryCost ?? effectiveCost;
      return matchedCost
        ? {
            ...normalizedRow,
            unitCostSnapshot: matchedCost.unitCost,
            unitCostRegistered: true,
          }
        : {
            ...normalizedRow,
            unitCostRegistered: normalizedRow.unitCostSnapshot !== 0,
          };
    });
  const normalizedPayers = allPayers.map((row) =>
    row.label === "Salesforce CMS"
      ? { ...row, monthlyCharge: Math.round(row.monthlyCharge / 1.1) }
      : row,
  );
  return {
    access,
    dealers: allowedDealers,
    rules: allRules.filter((row) => dealerIds.has(row.dealerId)),
    products: productRows,
    costs: costRows,
    dealerProductCosts: dealerProductCostRows.filter((row) =>
      dealerIds.has(row.dealerId),
    ),
    dealerCategoryCosts: dealerCategoryCostRows.filter((row) =>
      dealerIds.has(row.dealerId),
    ),
    dealerCommissionRules: dealerCommissionRuleRows.filter((row) =>
      dealerIds.has(row.dealerId),
    ),
    merchants: merchantRows,
    installations: installationRows,
    billings: allBillings.filter((row) => merchantIds.has(row.merchantId)),
    payerAccounts: normalizedPayers.filter((row) =>
      merchantIds.has(row.merchantId),
    ),
    payments: allPayments.filter((row) => merchantIds.has(row.merchantId)),
    advancePayments: allAdvances
      .filter((row) => dealerIds.has(row.dealerId))
      .map((row) => ({
        ...row,
        settlementMonth: row.settlementMonth || row.paymentDate.slice(0, 7),
      })),
    monthlySettlementStatuses: allMonthlySettlementStatuses.filter((row) =>
      dealerIds.has(row.dealerId),
    ),
    vanSettlements: allVanSettlements.filter((row) =>
      dealerIds.has(row.dealerId),
    ),
    members: memberRows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      dealerId: row.dealerId,
      active: row.active,
    })),
  };
}

async function repriceInstallationsForProduct(productId: number) {
  const installedAt = "substr(contract_install_at, 1, 10)";
  await env.DB.prepare(
    `UPDATE installations
     SET unit_cost_snapshot = COALESCE(
       (SELECT dealer_product_costs.unit_cost
        FROM dealer_product_costs
        JOIN merchants ON merchants.id = installations.merchant_id
        WHERE dealer_product_costs.dealer_id = merchants.dealer_id
          AND dealer_product_costs.product_id = installations.product_id
          AND dealer_product_costs.condition = installations.condition
          AND dealer_product_costs.effective_from <= ${installedAt}
        ORDER BY dealer_product_costs.effective_from DESC
        LIMIT 1),
       (SELECT dealer_category_costs.unit_cost
        FROM dealer_category_costs
        JOIN merchants ON merchants.id = installations.merchant_id
        JOIN products ON products.id = installations.product_id
        WHERE dealer_category_costs.dealer_id = merchants.dealer_id
          AND dealer_category_costs.product_category = products.category
          AND dealer_category_costs.condition = installations.condition
          AND dealer_category_costs.effective_from <= ${installedAt}
        ORDER BY dealer_category_costs.effective_from DESC
        LIMIT 1),
       (SELECT product_costs.unit_cost
        FROM product_costs
        WHERE product_costs.product_id = installations.product_id
          AND product_costs.condition = installations.condition
          AND product_costs.effective_from <= ${installedAt}
        ORDER BY product_costs.effective_from DESC
        LIMIT 1),
       unit_cost_snapshot
     )
     WHERE product_id = ?
       AND NOT (
         unit_cost_overridden = 1
         AND EXISTS (
           SELECT 1
           FROM products
           WHERE products.id = installations.product_id
             AND products.direct_cost_allowed = 1
         )
       )`,
  )
    .bind(productId)
    .run();
}

async function repriceInstallationsForProductCondition(
  productId: number,
  condition: string,
) {
  const installedAt = "substr(contract_install_at, 1, 10)";
  await env.DB.prepare(
    `UPDATE installations
     SET unit_cost_snapshot = COALESCE(
       (SELECT dealer_product_costs.unit_cost
        FROM dealer_product_costs
        JOIN merchants ON merchants.id = installations.merchant_id
        WHERE dealer_product_costs.dealer_id = merchants.dealer_id
          AND dealer_product_costs.product_id = installations.product_id
          AND dealer_product_costs.condition = installations.condition
          AND dealer_product_costs.effective_from <= ${installedAt}
        ORDER BY dealer_product_costs.effective_from DESC
        LIMIT 1),
       (SELECT dealer_category_costs.unit_cost
        FROM dealer_category_costs
        JOIN merchants ON merchants.id = installations.merchant_id
        JOIN products ON products.id = installations.product_id
        WHERE dealer_category_costs.dealer_id = merchants.dealer_id
          AND dealer_category_costs.product_category = products.category
          AND dealer_category_costs.condition = installations.condition
          AND dealer_category_costs.effective_from <= ${installedAt}
        ORDER BY dealer_category_costs.effective_from DESC
        LIMIT 1),
       (SELECT product_costs.unit_cost
        FROM product_costs
        WHERE product_costs.product_id = installations.product_id
          AND product_costs.condition = installations.condition
          AND product_costs.effective_from <= ${installedAt}
        ORDER BY product_costs.effective_from DESC
        LIMIT 1),
       0
     )
     WHERE product_id = ? AND condition = ?
       AND NOT (
         unit_cost_overridden = 1
         AND EXISTS (
           SELECT 1
           FROM products
           WHERE products.id = installations.product_id
             AND products.direct_cost_allowed = 1
         )
       )`,
  )
    .bind(productId, condition)
    .run();
}

async function repriceInstallationsForDealerCategory(
  dealerId: number,
  productCategory: string,
  condition: string,
) {
  const installedAt = "substr(contract_install_at, 1, 10)";
  await env.DB.prepare(
    `UPDATE installations
     SET unit_cost_snapshot = COALESCE(
       (SELECT dealer_product_costs.unit_cost
        FROM dealer_product_costs
        WHERE dealer_product_costs.dealer_id = ?
          AND dealer_product_costs.product_id = installations.product_id
          AND dealer_product_costs.condition = installations.condition
          AND dealer_product_costs.effective_from <= ${installedAt}
        ORDER BY dealer_product_costs.effective_from DESC
        LIMIT 1),
       (SELECT dealer_category_costs.unit_cost
        FROM dealer_category_costs
        WHERE dealer_category_costs.dealer_id = ?
          AND dealer_category_costs.product_category = ?
          AND dealer_category_costs.condition = installations.condition
          AND dealer_category_costs.effective_from <= ${installedAt}
        ORDER BY dealer_category_costs.effective_from DESC
        LIMIT 1),
       (SELECT product_costs.unit_cost
        FROM product_costs
        WHERE product_costs.product_id = installations.product_id
          AND product_costs.condition = installations.condition
          AND product_costs.effective_from <= ${installedAt}
        ORDER BY product_costs.effective_from DESC
        LIMIT 1),
       0
     )
     WHERE merchant_id IN (SELECT id FROM merchants WHERE dealer_id = ?)
       AND product_id IN (SELECT id FROM products WHERE category = ?)
       AND condition = ?
       AND NOT (
         unit_cost_overridden = 1
         AND EXISTS (
           SELECT 1
           FROM products
           WHERE products.id = installations.product_id
             AND products.direct_cost_allowed = 1
         )
       )`,
  )
    .bind(
      dealerId,
      dealerId,
      productCategory,
      dealerId,
      productCategory,
      condition,
    )
    .run();
}

async function installationUnitCost(
  productId: number,
  condition: string,
  installDate: string,
  dealerId: number,
) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(
       (SELECT dealer_product_costs.unit_cost
        FROM dealer_product_costs
        WHERE dealer_product_costs.dealer_id = ?
          AND dealer_product_costs.product_id = ?
          AND dealer_product_costs.condition = ?
          AND dealer_product_costs.effective_from <= ?
        ORDER BY dealer_product_costs.effective_from DESC
        LIMIT 1),
       (SELECT dealer_category_costs.unit_cost
        FROM dealer_category_costs
        JOIN products ON products.category = dealer_category_costs.product_category
        WHERE dealer_category_costs.dealer_id = ?
          AND products.id = ?
          AND dealer_category_costs.condition = ?
          AND dealer_category_costs.effective_from <= ?
        ORDER BY dealer_category_costs.effective_from DESC
        LIMIT 1),
       (SELECT product_costs.unit_cost
        FROM product_costs
        WHERE product_costs.product_id = ?
          AND product_costs.condition = ?
          AND product_costs.effective_from <= ?
        ORDER BY product_costs.effective_from DESC
        LIMIT 1)
     ) AS unitCost`,
  )
    .bind(
      dealerId,
      productId,
      condition,
      installDate,
      dealerId,
      productId,
      condition,
      installDate,
      productId,
      condition,
      installDate,
    )
    .first<{ unitCost: number | null }>();
  return row?.unitCost ?? null;
}

async function backfillLegacyManualInstallationDates() {
  await env.DB.prepare(
    `UPDATE installations
     SET contract_install_at = (
           SELECT install_date
           FROM merchants
           WHERE merchants.id = installations.merchant_id
         ),
         unit_cost_snapshot = COALESCE(
           (SELECT product_costs.unit_cost
            FROM product_costs
            WHERE product_costs.product_id = installations.product_id
              AND product_costs.condition = installations.condition
              AND product_costs.effective_from <= (
                SELECT install_date
                FROM merchants
                WHERE merchants.id = installations.merchant_id
              )
            ORDER BY product_costs.effective_from DESC
            LIMIT 1),
           unit_cost_snapshot
         )
     WHERE source != 'salesforce'
       AND NOT (
         unit_cost_overridden = 1
         AND EXISTS (
           SELECT 1
           FROM products
           WHERE products.id = installations.product_id
             AND products.direct_cost_allowed = 1
         )
       )
       AND (contract_install_at IS NULL OR contract_install_at = '')
       AND EXISTS (
         SELECT 1
         FROM merchants
         WHERE merchants.id = installations.merchant_id
           AND merchants.install_date != ''
       )`,
  ).run();
}

async function refreshMerchantFirstInstallDate(merchantId: number) {
  await env.DB.prepare(
    `UPDATE merchants
     SET install_date = COALESCE(
       (SELECT MIN(substr(contract_install_at, 1, 10))
        FROM installations
        WHERE installations.merchant_id = merchants.id
          AND contract_install_at IS NOT NULL
          AND contract_install_at != ''),
       install_date
     )
     WHERE id = ?`,
  )
    .bind(merchantId)
    .run();
}

async function seedIfEmpty() {
  const db = getDb();
  const existing = await db.select({ id: dealers.id }).from(dealers).limit(1);
  if (existing.length) {
    await db.update(dealers).set({ name: "이정수", salesforceManagerValue: "이정수", advanceEnabled: true }).where(eq(dealers.name, "새봄파트너스"));
    return;
  }
  const [dealer] = await db
    .insert(dealers)
    .values({
      name: "이정수",
      salesforceManagerValue: "이정수",
      advanceEnabled: true,
    })
    .returning();
  await db
    .insert(dealerRules)
    .values({
      dealerId: dealer.id,
      effectiveFrom: "2026-01-01",
      costShareRate: 50,
      profitShareRate: 50,
      vatSeparate: true,
    });
  const productRows = await db
    .insert(products)
    .values([
      { name: "POS 본체", category: "포스" },
      { name: "주방 프린터", category: "주방기기" },
      { name: "카드 단말기", category: "결제기기" },
      { name: "테이블오더 태블릿", category: "테이블오더" },
    ])
    .returning();
  const byName = Object.fromEntries(
    productRows.map((row) => [row.name, row.id]),
  );
  await db.insert(productCosts).values([
    {
      productId: byName["POS 본체"],
      unitCost: 1180000,
      effectiveFrom: "2025-01-01",
    },
    {
      productId: byName["POS 본체"],
      unitCost: 1280000,
      effectiveFrom: "2026-06-01",
    },
    {
      productId: byName["주방 프린터"],
      unitCost: 290000,
      effectiveFrom: "2025-01-01",
    },
    {
      productId: byName["주방 프린터"],
      unitCost: 320000,
      effectiveFrom: "2026-08-01",
    },
    {
      productId: byName["카드 단말기"],
      unitCost: 210000,
      effectiveFrom: "2025-01-01",
    },
    {
      productId: byName["테이블오더 태블릿"],
      unitCost: 460000,
      effectiveFrom: "2025-01-01",
    },
  ]);
  const merchantRows = await db
    .insert(merchants)
    .values([
      {
        name: "온기식당 성수점",
        businessNumber: "120-88-10421",
        dealerId: dealer.id,
        installDate: "2026-09-02",
      },
      {
        name: "달빛포차 합정점",
        businessNumber: "214-19-88102",
        dealerId: dealer.id,
        installDate: "2026-09-07",
      },
      {
        name: "브릭커피 역삼점",
        businessNumber: "315-42-11890",
        dealerId: dealer.id,
        installDate: "2026-05-19",
      },
      {
        name: "정담국수 강남점",
        businessNumber: "107-31-44920",
        dealerId: dealer.id,
        installDate: "2026-09-14",
      },
    ])
    .returning();
  const mb = Object.fromEntries(merchantRows.map((row) => [row.name, row.id]));
  await db.insert(installations).values([
    {
      merchantId: mb["온기식당 성수점"],
      productId: byName["POS 본체"],
      quantity: 1,
      unitCostSnapshot: 1280000,
    },
    {
      merchantId: mb["온기식당 성수점"],
      productId: byName["카드 단말기"],
      quantity: 1,
      unitCostSnapshot: 210000,
    },
    {
      merchantId: mb["달빛포차 합정점"],
      productId: byName["POS 본체"],
      quantity: 1,
      unitCostSnapshot: 1280000,
      condition: "신품",
      van: "KIS;NICE",
      transactionClassification: "할부구매",
      fixing: 850000,
      incentive: 110000,
    },
    {
      merchantId: mb["달빛포차 합정점"],
      productId: byName["주방 프린터"],
      quantity: 2,
      unitCostSnapshot: 320000,
      condition: "중고",
      van: "KIS",
    },
    {
      merchantId: mb["브릭커피 역삼점"],
      productId: byName["POS 본체"],
      quantity: 1,
      unitCostSnapshot: 1180000,
    },
    {
      merchantId: mb["정담국수 강남점"],
      productId: byName["테이블오더 태블릿"],
      quantity: 4,
      unitCostSnapshot: 460000,
    },
  ]);
  await db.insert(billings).values([
    {
      merchantId: mb["온기식당 성수점"],
      billingMonth: "2026-09",
      billingAmount: 400000,
      rentalRevenue: 400000,
      cancellationRevenue: 0,
      otherRevenue: 0,
      purchaseType: "rental",
    },
    {
      merchantId: mb["달빛포차 합정점"],
      billingMonth: "2026-09",
      billingAmount: 960000,
      rentalRevenue: 0,
      cancellationRevenue: 0,
      otherRevenue: 0,
      purchaseType: "installment",
      installmentMonths: 12,
    },
    {
      merchantId: mb["브릭커피 역삼점"],
      billingMonth: "2026-09",
      billingAmount: 350000,
      rentalRevenue: 250000,
      cancellationRevenue: 100000,
      otherRevenue: 0,
      purchaseType: "rental",
    },
    {
      merchantId: mb["정담국수 강남점"],
      billingMonth: "2026-09",
      billingAmount: 1720000,
      rentalRevenue: 0,
      cancellationRevenue: 0,
      otherRevenue: 1720000,
      purchaseType: "purchase",
    },
  ]);
}

async function seedPayerAccountsIfEmpty() {
  const db = getDb();
  const existing = await db
    .select({ id: payerAccounts.id })
    .from(payerAccounts)
    .limit(1);
  if (existing.length) return;
  const sample = await db
    .select()
    .from(merchants)
    .where(
      inArray(merchants.name, [
        "온기식당 성수점",
        "달빛포차 합정점",
        "브릭커피 역삼점",
        "정담국수 강남점",
      ]),
    );
  const byName = Object.fromEntries(sample.map((row) => [row.name, row.id]));
  if (!byName["온기식당 성수점"]) return;
  await db.insert(payerAccounts).values([
    {
      merchantId: byName["온기식당 성수점"],
      payerNumber: "P100021",
      label: "POS 임대",
      monthlyCharge: 300000,
      billingType: "rental",
      startMonth: "2026-09",
    },
    {
      merchantId: byName["온기식당 성수점"],
      payerNumber: "P100022",
      label: "단말기 임대",
      monthlyCharge: 100000,
      billingType: "rental",
      startMonth: "2026-09",
    },
    {
      merchantId: byName["달빛포차 합정점"],
      payerNumber: "P100034",
      label: "장비 할부",
      monthlyCharge: 960000,
      billingType: "installment",
      installmentMonths: 12,
      startMonth: "2026-09",
      endMonth: "2027-08",
    },
    {
      merchantId: byName["브릭커피 역삼점"],
      payerNumber: "P100041",
      label: "월 임대",
      monthlyCharge: 250000,
      billingType: "rental",
      startMonth: "2026-05",
    },
    {
      merchantId: byName["정담국수 강남점"],
      payerNumber: "P100052",
      label: "구매 대금",
      monthlyCharge: 1720000,
      billingType: "purchase",
      startMonth: "2026-09",
      endMonth: "2026-09",
    },
  ]);
}

async function seedPaymentsIfEmpty() {
  const db = getDb();
  const existing = await db.select({ id: payments.id }).from(payments).limit(1);
  if (existing.length) return;
  const payers = await db.select().from(payerAccounts);
  const byNumber = Object.fromEntries(
    payers.map((row) => [row.payerNumber, row]),
  );
  if (!byNumber.P100021) return;
  const now = new Date().toISOString();
  await db.insert(payments).values([
    {
      payerAccountId: byNumber.P100021.id,
      merchantId: byNumber.P100021.merchantId,
      billingMonth: "2026-09",
      paymentDate: "2026-09-05",
      grossAmount: 330000,
      supplyAmount: 300000,
      vatAmount: 30000,
      sourceFile: "샘플_납부내역.xlsx",
      externalKey: "sample-P100021-202609",
      createdAt: now,
    },
    {
      payerAccountId: byNumber.P100034.id,
      merchantId: byNumber.P100034.merchantId,
      billingMonth: "2026-09",
      paymentDate: "2026-09-08",
      grossAmount: 1056000,
      supplyAmount: 960000,
      vatAmount: 96000,
      sourceFile: "샘플_납부내역.xlsx",
      externalKey: "sample-P100034-202609",
      createdAt: now,
    },
    {
      payerAccountId: byNumber.P100041.id,
      merchantId: byNumber.P100041.merchantId,
      billingMonth: "2026-09",
      paymentDate: "2026-09-06",
      grossAmount: 275000,
      supplyAmount: 250000,
      vatAmount: 25000,
      sourceFile: "샘플_납부내역.xlsx",
      externalKey: "sample-P100041-202609",
      createdAt: now,
    },
    {
      payerAccountId: byNumber.P100052.id,
      merchantId: byNumber.P100052.merchantId,
      billingMonth: "2026-09",
      paymentDate: "2026-09-12",
      grossAmount: 1892000,
      supplyAmount: 1720000,
      vatAmount: 172000,
      sourceFile: "샘플_납부내역.xlsx",
      externalKey: "sample-P100052-202609",
      createdAt: now,
    },
  ]);
}

export async function GET() {
  try {
    await seedIfEmpty();
    const access = await requireAppAccess();
    await backfillLegacyManualInstallationDates();
    await seedPayerAccountsIfEmpty();
    await seedPaymentsIfEmpty();
    return Response.json(await snapshot(access));
  } catch (error) {
    return Response.json(
      { error: errorMessage(error) },
      { status: error instanceof AccessError ? error.status : 500 },
    );
  }
}

type ImportedRow = {
  rowNumber: number;
  payerNumber: string;
  paymentDate: string;
  billingMonth?: string;
  amount: number;
  referenceNumber?: string;
};

type ImportedVanRow = {
  rowNumber: number;
  settlementMonth: string;
  vanCompany: string;
  transactionCount: number;
  paymentAmount: number;
  vanFee: number;
};

type ImportedProductCostRow = {
  rowNumber: number;
  productName: string;
  condition: string;
  unitCost: number;
  effectiveFrom: string;
};

type ImportedMerchantRow = {
  rowNumber: number;
  businessNumber: string;
  merchantName: string;
  installDate: string;
  payerNumber?: string;
  productName: string;
  van?: string;
  condition: string;
  transactionClassification: string;
  quantity: number;
  contractTermMonths: number;
  salesAmount: number;
  unitCost: number;
  unitCostProvided?: boolean;
  costTotal?: number;
  fixing: number;
  incentive: number;
  actualRevenue?: number;
};

export async function POST(request: Request) {
  try {
    const access = await requireAppAccess();
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const db = getDb();

    if (access.role === "viewer")
      throw new AccessError(403, "열람 계정은 데이터를 변경할 수 없습니다.");

    if (action === "createMerchant") {
      const dealerId =
        access.role === "dealer" ? access.dealerId : Number(body.dealerId);
      const installDate = String(body.installDate ?? "");
      const selected = Array.isArray(body.products) ? body.products : [];
      if (
        !body.name ||
        !body.businessNumber ||
        !dealerId ||
        !installDate ||
        !selected.length
      )
        return Response.json(
          { error: "가맹점과 설치 제품을 모두 입력해주세요." },
          { status: 400 },
        );
      const [merchant] = await db
        .insert(merchants)
        .values({
          name: String(body.name),
          businessNumber: String(body.businessNumber),
          dealerId,
          installDate,
        })
        .returning();
      const rows = [];
      for (const item of selected as Array<{
        productId: number;
        quantity: number;
        condition?: string;
      }>) {
        const condition = String(item.condition ?? "신품");
        const unitCost = await installationUnitCost(
          Number(item.productId),
          condition,
          installDate,
          dealerId,
        );
        if (unitCost === null)
          throw new Error("설치일 기준으로 적용할 제품 원가가 없습니다.");
        rows.push({
          merchantId: merchant.id,
          productId: Number(item.productId),
          quantity: Number(item.quantity),
          unitCostSnapshot: unitCost,
          contractInstallAt: installDate,
          condition,
        });
      }
      await db.insert(installations).values(rows);
    } else if (action === "importMerchants") {
      assertAdmin(access);
      const dealerId = Number(body.dealerId);
      const rows = Array.isArray(body.rows)
        ? (body.rows as ImportedMerchantRow[])
        : [];
      if (!dealerId || !rows.length || rows.length > 3000)
        return Response.json(
          { error: "딜러와 1건 이상 3,000건 이하의 가맹점 행을 입력해주세요." },
          { status: 400 },
        );
      const [dealer] = await db
        .select()
        .from(dealers)
        .where(eq(dealers.id, dealerId))
        .limit(1);
      if (!dealer?.active)
        return Response.json(
          { error: "등록할 활성 딜러를 선택해주세요." },
          { status: 400 },
        );
      const invalid = rows.find((row) => {
        const classification = String(
          row.transactionClassification ?? "",
        ).trim();
        return (
          !normalizeBusinessNumber(row.businessNumber) ||
          !String(row.merchantName ?? "").trim() ||
          !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(row.installDate) ||
          !String(row.productName ?? "").trim() ||
          !["구매", "할부구매", "임대", "무상"].includes(classification) ||
          !Number.isFinite(Number(row.quantity)) ||
          Number(row.quantity) < 1 ||
          !Number.isFinite(Number(row.contractTermMonths ?? 36)) ||
          Number(row.contractTermMonths ?? 36) < 1 ||
          [row.salesAmount, row.unitCost, row.fixing, row.incentive].some(
            (value) => !Number.isFinite(Number(value)) || Number(value) < 0,
          )
        );
      });
      if (invalid)
        return Response.json(
          {
            error: `${invalid.rowNumber}행의 필수값, 날짜, 거래구분 또는 금액을 확인해주세요. 거래구분은 구매·할부구매·임대·무상 중 하나여야 합니다.`,
          },
          { status: 400 },
        );

      const salesforceProductByImportedName = await resolveSalesforceProducts(rows);
      const existingProductRows = await db.select().from(products);
      const existingProductByName = new Map(
        existingProductRows.map((row) => [normalizeProductName(row.name), row]),
      );
      const productByImportedName = new Map<
        string,
        typeof products.$inferSelect
      >();
      let productsAdded = 0;
      for (const [importedName, salesforceProduct] of salesforceProductByImportedName) {
        const canonicalName = normalizeProductName(salesforceProduct.name);
        let product = existingProductByName.get(canonicalName);
        if (!product) {
          [product] = await db
            .insert(products)
            .values({
              name: salesforceProduct.name,
              category: salesforceProduct.family,
              active: true,
            })
            .returning();
          existingProductByName.set(canonicalName, product);
          productsAdded += 1;
        } else if (
          product.category !== salesforceProduct.family ||
          !product.active
        ) {
          [product] = await db
            .update(products)
            .set({ category: salesforceProduct.family, active: true })
            .where(eq(products.id, product.id))
            .returning();
          existingProductByName.set(canonicalName, product);
        }
        productByImportedName.set(importedName, product);
      }

      const merchantRows = await db
        .select()
        .from(merchants)
        .where(eq(merchants.dealerId, dealerId));
      const merchantByBusinessNumber = new Map(
        merchantRows.map((row) => [normalizeBusinessNumber(row.businessNumber), row]),
      );
      const groupedRows = new Map<string, ImportedMerchantRow[]>();
      for (const row of rows) {
        const key = normalizeBusinessNumber(row.businessNumber);
        const group = groupedRows.get(key) ?? [];
        group.push(row);
        groupedRows.set(key, group);
      }
      for (const [businessKey, merchantImportRows] of groupedRows) {
        const first = merchantImportRows[0];
        const firstInstallDate = merchantImportRows
          .map((row) => row.installDate)
          .sort()[0];
        let merchant = merchantByBusinessNumber.get(businessKey);
        if (!merchant) {
          [merchant] = await db
            .insert(merchants)
            .values({
              name: String(first.merchantName).trim(),
              businessNumber: String(first.businessNumber).trim(),
              dealerId,
              installDate: firstInstallDate,
            })
            .returning();
          merchantRows.push(merchant);
          merchantByBusinessNumber.set(businessKey, merchant);
        } else if (!merchant.salesforceId) {
          [merchant] = await db
            .update(merchants)
            .set({
              name: String(first.merchantName).trim(),
              businessNumber: String(first.businessNumber).trim(),
              installDate: firstInstallDate,
            })
            .where(eq(merchants.id, merchant.id))
            .returning();
          merchantByBusinessNumber.set(businessKey, merchant);
        }
      }

      let payerCount = 0;
      const resolvedUnitCostByKey = new Map<string, Promise<number | null>>();
      const installationStatements = await Promise.all(rows.map(async (row) => {
        const businessKey = normalizeBusinessNumber(row.businessNumber);
        const merchant = merchantByBusinessNumber.get(businessKey)!;
        const product = productByImportedName.get(
          normalizeProductName(row.productName),
        )!;
        const condition = String(row.condition || "신품").trim();
        const van = String(row.van ?? "").trim();
        const classification = String(row.transactionClassification).trim();
        const unitCostProvided = row.unitCostProvided !== false;
        const unitCostKey = [product.id, condition, row.installDate].join(":");
        if (!unitCostProvided && !resolvedUnitCostByKey.has(unitCostKey))
          resolvedUnitCostByKey.set(
            unitCostKey,
            installationUnitCost(
              product.id,
              condition,
              row.installDate,
              dealerId,
            ),
          );
        const resolvedUnitCost = unitCostProvided
          ? Math.round(Number(row.unitCost))
          : ((await resolvedUnitCostByKey.get(unitCostKey)) ?? 0);
        const importKey = [
          "manual",
          dealerId,
          businessKey,
          row.installDate,
          product.id,
          condition,
          van,
          classification,
          Math.max(1, Math.round(Number(row.quantity))),
          Math.round(Number(row.unitCost)),
          Math.round(Number(row.salesAmount)),
          Math.round(Number(row.fixing)),
          Math.round(Number(row.incentive)),
        ].join(":");
        return env.DB.prepare(
          `INSERT INTO installations (merchant_id, product_id, quantity, contract_term_months, unit_cost_snapshot, unit_cost_overridden, salesforce_line_item_id, salesforce_case_id, contract_install_at, condition, van, transaction_classification, fixing, incentive, sales_amount, source, last_synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'manual-excel', NULL)
           ON CONFLICT(salesforce_line_item_id) DO UPDATE SET
             merchant_id = excluded.merchant_id,
             product_id = excluded.product_id,
             quantity = excluded.quantity,
             contract_term_months = excluded.contract_term_months,
             unit_cost_snapshot = excluded.unit_cost_snapshot,
             unit_cost_overridden = excluded.unit_cost_overridden,
             contract_install_at = excluded.contract_install_at,
             condition = excluded.condition,
             van = excluded.van,
             transaction_classification = excluded.transaction_classification,
             fixing = excluded.fixing,
             incentive = excluded.incentive,
             sales_amount = excluded.sales_amount,
             source = 'manual-excel'`,
        ).bind(
          merchant.id,
          product.id,
          Math.max(1, Math.round(Number(row.quantity))),
          Math.max(1, Math.round(Number(row.contractTermMonths ?? 36))),
          resolvedUnitCost,
          unitCostProvided ? 1 : 0,
          importKey,
          row.installDate,
          condition,
          van || null,
          classification,
          Math.round(Number(row.fixing)),
          Math.round(Number(row.incentive)),
          Math.round(Number(row.salesAmount)),
        );
      }));
      for (let start = 0; start < installationStatements.length; start += 100)
        await env.DB.batch(installationStatements.slice(start, start + 100));
      for (const merchant of new Set(
        rows.map((row) =>
          merchantByBusinessNumber.get(
            normalizeBusinessNumber(row.businessNumber),
          ),
        ),
      ))
        if (merchant) await refreshMerchantFirstInstallDate(merchant.id);

      const payerStatements = rows.flatMap((row) => {
        const payerNumber = normalizePayerNumber(row.payerNumber);
        if (!payerNumber) return [];
        payerCount += 1;
        const merchant = merchantByBusinessNumber.get(
          normalizeBusinessNumber(row.businessNumber),
        )!;
        const billingType =
          row.transactionClassification === "구매"
            ? "purchase"
            : row.transactionClassification === "할부구매"
              ? "installment"
              : "rental";
        return [
          env.DB.prepare(
            `INSERT INTO payer_accounts (merchant_id, payer_number, label, monthly_charge, billing_type, installment_months, start_month, end_month, active)
             VALUES (?, ?, '수동 Excel 등록', 0, ?, NULL, ?, NULL, 1)
             ON CONFLICT(payer_number) DO UPDATE SET
               merchant_id = excluded.merchant_id,
               label = excluded.label,
               billing_type = excluded.billing_type,
               start_month = excluded.start_month,
               active = 1`,
          ).bind(merchant.id, payerNumber, billingType, row.installDate.slice(0, 7)),
        ];
      });
      for (let start = 0; start < payerStatements.length; start += 100)
        await env.DB.batch(payerStatements.slice(start, start + 100));

      return Response.json(
        {
          data: await snapshot(access),
          importResult: {
            merchants: groupedRows.size,
            installations: rows.length,
            payerAccounts: payerCount,
            productsAdded,
          },
        },
        { status: 201 },
      );
    } else if (action === "deleteMerchant") {
      assertAdmin(access);
      const merchantId = Number(body.merchantId);
      const [merchant] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, merchantId))
        .limit(1);
      if (!merchant)
        return Response.json(
          { error: "삭제할 가맹점을 찾지 못했습니다." },
          { status: 404 },
        );
      await env.DB.batch([
        env.DB.prepare("DELETE FROM payments WHERE merchant_id = ?").bind(
          merchantId,
        ),
        env.DB.prepare("DELETE FROM billings WHERE merchant_id = ?").bind(
          merchantId,
        ),
        env.DB.prepare("DELETE FROM installations WHERE merchant_id = ?").bind(
          merchantId,
        ),
        env.DB.prepare("DELETE FROM payer_accounts WHERE merchant_id = ?").bind(
          merchantId,
        ),
        env.DB.prepare("DELETE FROM merchants WHERE id = ?").bind(merchantId),
      ]);
    } else if (action === "deleteMerchants") {
      assertAdmin(access);
      const merchantIds = selectedIds(body.merchantIds, 100);
      if (!merchantIds.length || merchantIds.length > 100)
        return Response.json(
          { error: "삭제할 가맹점을 1곳 이상 선택해주세요." },
          { status: 400 },
        );
      await db.delete(payments).where(inArray(payments.merchantId, merchantIds));
      await db.delete(billings).where(inArray(billings.merchantId, merchantIds));
      await db
        .delete(installations)
        .where(inArray(installations.merchantId, merchantIds));
      await db
        .delete(payerAccounts)
        .where(inArray(payerAccounts.merchantId, merchantIds));
      await db.delete(merchants).where(inArray(merchants.id, merchantIds));
    } else if (action === "deletePayments") {
      assertAdmin(access);
      const paymentIds = selectedIds(body.paymentIds);
      if (!paymentIds.length || paymentIds.length > 500)
        return Response.json(
          { error: "삭제할 납입 내역을 1건 이상 선택해주세요." },
          { status: 400 },
        );
      await db.delete(payments).where(inArray(payments.id, paymentIds));
    } else if (action === "deleteProductCosts") {
      assertAdmin(access);
      const costIds = selectedIds(body.costIds);
      const dealerProductCostIds = selectedIds(body.dealerProductCostIds);
      if (
        !costIds.length &&
        !dealerProductCostIds.length
      )
        return Response.json(
          { error: "삭제할 제품원가를 1건 이상 선택해주세요." },
          { status: 400 },
        );
      if (costIds.length + dealerProductCostIds.length > 500)
        return Response.json(
          { error: "제품원가는 한 번에 500건까지 삭제할 수 있습니다." },
          { status: 400 },
        );
      const deletedCosts = costIds.length
        ? await db
            .select()
            .from(productCosts)
            .where(inArray(productCosts.id, costIds))
        : [];
      const deletedDealerCosts = dealerProductCostIds.length
        ? await db
            .select()
            .from(dealerProductCosts)
            .where(inArray(dealerProductCosts.id, dealerProductCostIds))
        : [];
      if (costIds.length)
        await db.delete(productCosts).where(inArray(productCosts.id, costIds));
      if (dealerProductCostIds.length)
        await db
          .delete(dealerProductCosts)
          .where(inArray(dealerProductCosts.id, dealerProductCostIds));
      const affected = new Map<string, { productId: number; condition: string }>();
      for (const cost of [...deletedCosts, ...deletedDealerCosts])
        affected.set(`${cost.productId}:${cost.condition}`, {
          productId: cost.productId,
          condition: cost.condition,
        });
      for (const item of affected.values())
        await repriceInstallationsForProductCondition(
          item.productId,
          item.condition,
        );
    } else if (action === "updateProductCostDealers") {
      assertAdmin(access);
      const costIds = selectedIds(body.costIds);
      const dealerProductCostIds = selectedIds(body.dealerProductCostIds);
      const dealerIds = numberList(body.dealerIds);
      if (!costIds.length && !dealerProductCostIds.length)
        return Response.json(
          { error: "적용 딜러를 변경할 제품원가를 선택해주세요." },
          { status: 400 },
        );
      if (costIds.length + dealerProductCostIds.length > 500)
        return Response.json(
          { error: "제품원가는 한 번에 500건까지 변경할 수 있습니다." },
          { status: 400 },
        );
      if (dealerIds.length) {
        const activeDealers = await db.select().from(dealers);
        const activeDealerIds = new Set(
          activeDealers
            .filter((dealer) => dealer.active)
            .map((dealer) => dealer.id),
        );
        if (dealerIds.some((dealerId) => !activeDealerIds.has(dealerId)))
          return Response.json(
            { error: "적용할 딜러를 확인해주세요." },
            { status: 400 },
          );
      }
      const selectedCosts = costIds.length
        ? await db
            .select()
            .from(productCosts)
            .where(inArray(productCosts.id, costIds))
        : [];
      const selectedDealerCosts = dealerProductCostIds.length
        ? await db
            .select()
            .from(dealerProductCosts)
            .where(inArray(dealerProductCosts.id, dealerProductCostIds))
        : [];
      const selectedGroups = [
        ...selectedCosts.map((cost) => ({
          source: "common" as const,
          dealerId: null as number | null,
          productId: cost.productId,
          condition: cost.condition,
        })),
        ...selectedDealerCosts.map((cost) => ({
          source: "dealer" as const,
          dealerId: cost.dealerId,
          productId: cost.productId,
          condition: cost.condition,
        })),
      ];
      const uniqueGroups = [
        ...new Map(
          selectedGroups.map((group) => [
            `${group.source}:${group.dealerId ?? "all"}:${group.productId}:${group.condition}`,
            group,
          ]),
        ).values(),
      ];
      if (!uniqueGroups.length)
        return Response.json(
          { error: "변경할 제품원가를 찾지 못했습니다." },
          { status: 404 },
        );

      const allCommonCosts = uniqueGroups.some(
        (group) => group.source === "common",
      )
        ? await db.select().from(productCosts)
        : [];
      const allDealerCosts = uniqueGroups.some(
        (group) => group.source === "dealer",
      )
        ? await db.select().from(dealerProductCosts)
        : [];
      const costsToMove = [
        ...uniqueGroups.flatMap((group) =>
          group.source === "common"
            ? allCommonCosts
                .filter(
                  (cost) =>
                    cost.productId === group.productId &&
                    cost.condition === group.condition,
                )
                .map((cost) => ({ source: group.source, cost }))
            : allDealerCosts
                .filter(
                  (cost) =>
                    cost.dealerId === group.dealerId &&
                    cost.productId === group.productId &&
                    cost.condition === group.condition,
                )
                .map((cost) => ({ source: group.source, cost })),
        ),
      ];
      const selectedCostRows = [
        ...new Map(
          costsToMove.map(({ source, cost }) => [
            `${source}:${cost.id}`,
            {
              productId: cost.productId,
              unitCost: cost.unitCost,
              condition: cost.condition,
              effectiveFrom: cost.effectiveFrom,
            },
          ]),
        ).values(),
      ];
      const commonCostIdsToDelete = costsToMove
        .filter((row) => row.source === "common")
        .map((row) => row.cost.id);
      const dealerCostIdsToDelete = costsToMove
        .filter((row) => row.source === "dealer")
        .map((row) => row.cost.id);
      if (commonCostIdsToDelete.length)
        await db
          .delete(productCosts)
          .where(inArray(productCosts.id, commonCostIdsToDelete));
      if (dealerCostIdsToDelete.length)
        await db
          .delete(dealerProductCosts)
          .where(inArray(dealerProductCosts.id, dealerCostIdsToDelete));
      if (dealerIds.length) {
        for (const cost of selectedCostRows) {
          for (const dealerId of dealerIds) {
            const [existing] = await db
              .select()
              .from(dealerProductCosts)
              .where(
                and(
                  eq(dealerProductCosts.dealerId, dealerId),
                  eq(dealerProductCosts.productId, cost.productId),
                  eq(dealerProductCosts.condition, cost.condition),
                  eq(dealerProductCosts.effectiveFrom, cost.effectiveFrom),
                ),
              )
              .limit(1);
            if (existing)
              await db
                .update(dealerProductCosts)
                .set({ unitCost: cost.unitCost })
                .where(eq(dealerProductCosts.id, existing.id));
            else
              await db.insert(dealerProductCosts).values({
                dealerId,
                ...cost,
              });
          }
        }
      } else {
        for (const cost of selectedCostRows) {
          const [existing] = await db
            .select()
            .from(productCosts)
            .where(
              and(
                eq(productCosts.productId, cost.productId),
                eq(productCosts.condition, cost.condition),
                eq(productCosts.effectiveFrom, cost.effectiveFrom),
              ),
            )
            .limit(1);
          if (existing)
            await db
              .update(productCosts)
              .set({ unitCost: cost.unitCost })
              .where(eq(productCosts.id, existing.id));
          else await db.insert(productCosts).values(cost);
        }
      }
      const affected = new Map<string, { productId: number; condition: string }>();
      for (const cost of selectedCostRows)
        affected.set(`${cost.productId}:${cost.condition}`, {
          productId: cost.productId,
          condition: cost.condition,
        });
      for (const item of affected.values())
        await repriceInstallationsForProductCondition(
          item.productId,
          item.condition,
        );
    } else if (action === "deleteVanSettlements") {
      assertAdmin(access);
      const vanSettlementIds = selectedIds(body.vanSettlementIds);
      if (!vanSettlementIds.length || vanSettlementIds.length > 500)
        return Response.json(
          { error: "삭제할 VAN 실적을 1건 이상 선택해주세요." },
          { status: 400 },
        );
      await db
        .delete(vanSettlements)
        .where(inArray(vanSettlements.id, vanSettlementIds));
    } else if (action === "saveDealer") {
      assertAdmin(access);
      const dealerId = Number(body.dealerId || 0);
      const name = String(body.name ?? "").trim();
      const salesforceManagerValue =
        String(body.salesforceManagerValue ?? "").trim() || name;
      const bankName = String(body.bankName ?? "").trim() || null;
      const bankAccountNumber =
        String(body.bankAccountNumber ?? "").trim() || null;
      const vanSettlementEnabled =
        body.vanSettlementEnabled === false ||
        body.vanSettlementEnabled === "false"
          ? false
          : true;
      const settlementListColumns = selectedKeys(
        body.settlementListColumns,
        SETTLEMENT_LIST_COLUMNS,
        DEFAULT_SETTLEMENT_LIST_COLUMNS,
      );
      const mainSummaryCards = selectedKeys(
        body.mainSummaryCards,
        MAIN_SUMMARY_CARDS,
        DEFAULT_MAIN_SUMMARY_CARDS,
      );
      const merchantListColumns = selectedKeys(
        body.merchantListColumns,
        MERCHANT_LIST_COLUMNS,
        DEFAULT_MERCHANT_LIST_COLUMNS,
      );
      const merchantDetailFields = selectedKeys(
        body.merchantDetailFields,
        MERCHANT_DETAIL_FIELDS,
        DEFAULT_MERCHANT_DETAIL_FIELDS,
      );
      const merchantDetailBillingColumns = selectedKeys(
        body.merchantDetailBillingColumns,
        MERCHANT_DETAIL_BILLING_COLUMNS,
        DEFAULT_MERCHANT_DETAIL_BILLING_COLUMNS,
      );
      const merchantDetailPayerColumns = selectedKeys(
        body.merchantDetailPayerColumns,
        MERCHANT_DETAIL_PAYER_COLUMNS,
        DEFAULT_MERCHANT_DETAIL_PAYER_COLUMNS,
      );
      const merchantDetailInstallationColumns = selectedKeys(
        body.merchantDetailInstallationColumns,
        MERCHANT_DETAIL_INSTALLATION_COLUMNS,
        DEFAULT_MERCHANT_DETAIL_INSTALLATION_COLUMNS,
      );
      if (!name)
        return Response.json(
          { error: "딜러 이름을 입력해주세요." },
          { status: 400 },
        );
      if (dealerId) {
        await db
          .update(dealers)
          .set({
            name,
            salesforceManagerValue,
            advanceEnabled: body.advanceEnabled === true,
            flatCommissionEnabled: body.flatCommissionEnabled === true,
            vanSettlementEnabled,
            settlementDirectionVisible:
              body.settlementDirectionVisible !== false,
            installmentPendingEnabled:
              body.installmentPendingEnabled !== false,
            mainSummaryCards,
            settlementListColumns,
            merchantListColumns,
            merchantDetailFields,
            merchantDetailBillingColumns,
            merchantDetailPayerColumns,
            merchantDetailInstallationColumns,
            bankName,
            bankAccountNumber,
            active: body.active !== false,
          })
          .where(eq(dealers.id, dealerId));
      } else {
        const [created] = await db
          .insert(dealers)
          .values({
            name,
            salesforceManagerValue,
            advanceEnabled: body.advanceEnabled === true,
            flatCommissionEnabled: body.flatCommissionEnabled === true,
            vanSettlementEnabled,
            settlementDirectionVisible:
              body.settlementDirectionVisible !== false,
            installmentPendingEnabled:
              body.installmentPendingEnabled !== false,
            mainSummaryCards,
            settlementListColumns,
            merchantListColumns,
            merchantDetailFields,
            merchantDetailBillingColumns,
            merchantDetailPayerColumns,
            merchantDetailInstallationColumns,
            bankName,
            bankAccountNumber,
            active: true,
          })
          .returning();
        await db
          .insert(dealerRules)
          .values({
            dealerId: created.id,
            effectiveFrom: String(body.effectiveFrom || "2000-01-01"),
            costShareRate: Number(body.costShareRate ?? 50),
            profitShareRate: Number(body.profitShareRate ?? 50),
            vatSeparate: true,
          });
      }
    } else if (action === "updateInstallationDate") {
      const installationId = Number(body.installationId);
      const installDate = String(body.installDate ?? "").trim();
      const [installation] = await db
        .select()
        .from(installations)
        .where(eq(installations.id, installationId))
        .limit(1);
      if (!installation)
        return Response.json(
          { error: "설치 제품을 찾지 못했습니다." },
          { status: 404 },
        );
      await requireMerchantAccess(access, installation.merchantId);
      if (!DATE_PATTERN.test(installDate))
        return Response.json(
          { error: "설치일자를 YYYY-MM-DD 형식으로 입력해주세요." },
          { status: 400 },
        );
      const [installationProduct] = await db
        .select()
        .from(products)
        .where(eq(products.id, installation.productId))
        .limit(1);
      if (installation.unitCostOverridden && installationProduct?.directCostAllowed) {
        await db
          .update(installations)
          .set({ contractInstallAt: installDate })
          .where(eq(installations.id, installationId));
        await refreshMerchantFirstInstallDate(installation.merchantId);
        const [merchant] = await db
          .select()
          .from(merchants)
          .where(eq(merchants.id, installation.merchantId))
          .limit(1);
        if (merchant?.installDate)
          await env.DB.prepare(
            `UPDATE payer_accounts
             SET start_month = ?
             WHERE merchant_id = ? AND start_month = ''`,
          )
            .bind(merchant.installDate.slice(0, 7), installation.merchantId)
            .run();
        return Response.json(await snapshot(access), { status: 201 });
      }
      const [merchantForCost] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, installation.merchantId))
        .limit(1);
      const unitCost = merchantForCost
        ? await installationUnitCost(
            installation.productId,
            installation.condition,
            installDate,
            merchantForCost.dealerId,
          )
        : null;
      await db
        .update(installations)
        .set({
          contractInstallAt: installDate,
          unitCostSnapshot: unitCost ?? 0,
        })
        .where(eq(installations.id, installationId));
      await refreshMerchantFirstInstallDate(installation.merchantId);
      const [merchant] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, installation.merchantId))
        .limit(1);
      if (merchant?.installDate)
        await env.DB.prepare(
          `UPDATE payer_accounts
           SET start_month = ?
           WHERE merchant_id = ? AND start_month = ''`,
        )
          .bind(merchant.installDate.slice(0, 7), installation.merchantId)
          .run();
    } else if (action === "updateInstallation") {
      const installationId = Number(body.installationId);
      const [installation] = await db
        .select()
        .from(installations)
        .where(eq(installations.id, installationId))
        .limit(1);
      if (!installation)
        return Response.json(
          { error: "수정할 설치 제품을 찾지 못했습니다." },
          { status: 404 },
        );
      await requireMerchantAccess(access, installation.merchantId);
      const installDate = String(body.installDate ?? "").trim();
      const productId = Number(body.productId);
      const condition = String(body.condition ?? "신품").trim();
      const transactionClassification = String(
        body.transactionClassification ?? "",
      ).trim();
      const quantity = Math.round(Number(body.quantity));
      const contractTermMonths = Math.round(
        Number(body.contractTermMonths ?? 36),
      );
      const salesAmount = Math.round(Number(body.salesAmount ?? 0));
      const fixing = Math.round(Number(body.fixing ?? 0));
      const incentive = Math.round(Number(body.incentive ?? 0));
      const fixingPaymentStatus = paymentStatus(body.fixingPaymentStatus);
      const fixingPaymentDate = paymentDate(body.fixingPaymentDate);
      const incentivePaymentStatus = paymentStatus(body.incentivePaymentStatus);
      const incentivePaymentDate = paymentDate(body.incentivePaymentDate);
      const unitCostText = String(body.unitCost ?? "").trim();
      const directUnitCost = Math.round(Number(unitCostText));
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
      const unitCostOverridden =
        Boolean(product?.directCostAllowed) && unitCostText !== "";
      if (
        !DATE_PATTERN.test(installDate) ||
        !product?.active ||
        !["신품", "중고"].includes(condition) ||
        !["구매", "할부구매", "임대", "무상"].includes(
          transactionClassification,
        ) ||
        !Number.isFinite(quantity) ||
        quantity < 1 ||
        !Number.isFinite(contractTermMonths) ||
        contractTermMonths < 1 ||
        (unitCostOverridden &&
          (!Number.isFinite(directUnitCost) || directUnitCost < 0)) ||
        [salesAmount, fixing, incentive].some(
          (value) => !Number.isFinite(value) || value < 0,
        )
      )
        return Response.json(
          { error: "설치일, 제품, 거래구분, 수량과 금액을 확인해주세요." },
          { status: 400 },
        );
      const merchant = await requireMerchantAccess(access, installation.merchantId);
      const unitCost = await installationUnitCost(
        productId,
        condition,
        installDate,
        merchant.dealerId,
      );
      await db
        .update(installations)
        .set({
          productId,
          quantity,
          contractTermMonths,
          unitCostSnapshot: unitCostOverridden
            ? directUnitCost
            : (unitCost ?? 0),
          unitCostOverridden,
          contractInstallAt: installDate,
          condition,
          van: String(body.van ?? "").trim() || null,
          transactionClassification,
          fixing,
          incentive,
          fixingPaymentStatus,
          fixingPaymentDate,
          incentivePaymentStatus,
          incentivePaymentDate,
          salesAmount,
        })
        .where(eq(installations.id, installationId));
      await refreshMerchantFirstInstallDate(installation.merchantId);
    } else if (action === "deleteInstallation") {
      const installationId = Number(body.installationId);
      const [installation] = await db
        .select()
        .from(installations)
        .where(eq(installations.id, installationId))
        .limit(1);
      if (!installation)
        return Response.json(
          { error: "삭제할 설치 제품을 찾지 못했습니다." },
          { status: 404 },
        );
      await requireMerchantAccess(access, installation.merchantId);
      await db
        .delete(installations)
        .where(eq(installations.id, installationId));
      await refreshMerchantFirstInstallDate(installation.merchantId);
    } else if (action === "createInstallation") {
      const merchantId = Number(body.merchantId);
      const merchant = await requireMerchantAccess(access, merchantId);
      const installDate = String(body.installDate ?? "").trim();
      let productId = Number(body.productId);
      const productName = normalizeProductName(body.productName);
      const productFamily = String(body.productFamily ?? "").trim() || "미지정";
      const condition = String(body.condition ?? "신품").trim();
      const transactionClassification = String(
        body.transactionClassification ?? "",
      ).trim();
      const quantity = Math.round(Number(body.quantity));
      const contractTermMonths = Math.round(
        Number(body.contractTermMonths ?? 36),
      );
      const salesAmount = Math.round(Number(body.salesAmount ?? 0));
      const fixing = Math.round(Number(body.fixing ?? 0));
      const incentive = Math.round(Number(body.incentive ?? 0));
      const fixingPaymentStatus = paymentStatus(body.fixingPaymentStatus);
      const fixingPaymentDate = paymentDate(body.fixingPaymentDate);
      const incentivePaymentStatus = paymentStatus(body.incentivePaymentStatus);
      const incentivePaymentDate = paymentDate(body.incentivePaymentDate);
      const unitCostText = String(body.unitCost ?? "").trim();
      const directUnitCost = Math.round(Number(unitCostText));
      if (!productId && productName) {
        const productRows = await db.select().from(products);
        const existingProduct = productRows.find(
          (row) => normalizeProductName(row.name) === productName,
        );
        if (existingProduct) productId = existingProduct.id;
        else {
          const [created] = await db
            .insert(products)
            .values({
              name: productName,
              category: productFamily,
              active: true,
            })
            .returning();
          productId = created.id;
        }
      }
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
      if (
        product &&
        productFamily !== "미지정" &&
        product.category !== productFamily
      )
        await db
          .update(products)
          .set({ category: productFamily })
          .where(eq(products.id, product.id));
      const unitCostOverridden =
        Boolean(product?.directCostAllowed) && unitCostText !== "";
      if (
        !DATE_PATTERN.test(installDate) ||
        !product?.active ||
        !["신품", "중고"].includes(condition) ||
        !["구매", "할부구매", "임대", "무상"].includes(
          transactionClassification,
        ) ||
        !Number.isFinite(quantity) ||
        quantity < 1 ||
        !Number.isFinite(contractTermMonths) ||
        contractTermMonths < 1 ||
        (unitCostOverridden &&
          (!Number.isFinite(directUnitCost) || directUnitCost < 0)) ||
        [salesAmount, fixing, incentive].some(
          (value) => !Number.isFinite(value) || value < 0,
        )
      )
        return Response.json(
          { error: "설치일, 제품, 거래구분, 수량과 금액을 확인해주세요." },
          { status: 400 },
        );
      const unitCost = await installationUnitCost(
        productId,
        condition,
        installDate,
        merchant.dealerId,
      );
      await db.insert(installations).values({
        merchantId,
        productId,
        quantity,
        contractTermMonths,
        unitCostSnapshot: unitCostOverridden
          ? directUnitCost
          : (unitCost ?? 0),
        unitCostOverridden,
        contractInstallAt: installDate,
        condition,
        van: String(body.van ?? "").trim() || null,
        transactionClassification,
        fixing,
        incentive,
        fixingPaymentStatus,
        fixingPaymentDate,
        incentivePaymentStatus,
        incentivePaymentDate,
        salesAmount,
        source: "manual",
      });
      if (!merchant.installDate || installDate < merchant.installDate)
        await refreshMerchantFirstInstallDate(merchantId);
    } else if (action === "createPayerAccount") {
      const merchantId = Number(body.merchantId);
      await requireMerchantAccess(access, merchantId);
      const payerNumber = normalizePayerNumber(body.payerNumber);
      if (!payerNumber)
        return Response.json(
          { error: "납부자번호를 입력해주세요." },
          { status: 400 },
        );
      const startMonth = String(body.startMonth ?? "");
      if (!startMonth)
        return Response.json(
          { error: "청구 시작월을 입력해주세요." },
          { status: 400 },
        );
      await db.insert(payerAccounts).values({
        merchantId,
        payerNumber,
        label: String(body.label ?? "") || null,
        monthlyCharge: Number(body.monthlyCharge ?? 0),
        billingType: String(body.billingType ?? "rental") as
          "rental" | "purchase" | "installment",
        installmentMonths: body.installmentMonths
          ? Number(body.installmentMonths)
          : null,
        startMonth,
        endMonth: String(body.endMonth ?? "") || null,
      });
    } else if (action === "createCost") {
      assertAdmin(access);
      let productId = Number(body.productId);
      const productName = normalizeProductName(body.productName);
      const productFamily =
        String(body.productFamily ?? "").trim() || "미지정";
      const unitCost = Math.round(Number(body.unitCost));
      const condition = String(body.condition ?? "신품").trim();
      const effectiveFrom = String(body.effectiveFrom ?? "").trim();
      if (
        (!productId && !productName) ||
        !["신품", "중고"].includes(condition) ||
        !Number.isFinite(unitCost) ||
        unitCost < 0 ||
        !DATE_PATTERN.test(effectiveFrom)
      )
        return Response.json(
          { error: "제품, 제품 상태, 원가와 적용 시작일을 확인해주세요." },
          { status: 400 },
        );
      if (!productId && productName) {
        const productRows = await db.select().from(products);
        let product = productRows.find(
          (row) => normalizeProductName(row.name) === productName,
        );
        if (!product)
          [product] = await db
            .insert(products)
            .values({
              name: productName,
              category: productFamily,
              active: true,
            })
            .returning();
        productId = product.id;
      }
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
      if (!product?.active)
        return Response.json(
          { error: "등록할 활성 제품을 찾지 못했습니다." },
          { status: 400 },
        );
      if (
        productName &&
        productFamily !== "미지정" &&
        product.category !== productFamily
      )
        await db
          .update(products)
          .set({ category: productFamily })
          .where(eq(products.id, product.id));
      await db
        .insert(productCosts)
        .values({
          productId,
          unitCost,
          condition,
          effectiveFrom,
        });
      await repriceInstallationsForProduct(productId);
    } else if (action === "importProductCosts") {
      assertAdmin(access);
      const rows = Array.isArray(body.rows)
        ? (body.rows as ImportedProductCostRow[])
        : [];
      if (!rows.length || rows.length > 3000)
        return Response.json(
          { error: "1건 이상 3,000건 이하의 제품 원가를 입력해주세요." },
          { status: 400 },
        );
      const invalid = rows.find(
        (row) =>
          !normalizeProductName(row.productName) ||
          !["신품", "중고"].includes(String(row.condition ?? "").trim()) ||
          !Number.isFinite(Number(row.unitCost)) ||
          Number(row.unitCost) < 0 ||
          !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(
            String(row.effectiveFrom ?? ""),
          ),
      );
      if (invalid)
        return Response.json(
          {
            error: `${invalid.rowNumber}행의 제품명, 제품 상태, 원가 또는 적용일을 확인해주세요.`,
          },
          { status: 400 },
        );
      const salesforceProductByImportedName = await resolveSalesforceProducts(rows);
      const existingProductRows = await db.select().from(products);
      const existingProductByName = new Map(
        existingProductRows.map((row) => [normalizeProductName(row.name), row]),
      );
      const productByImportedName = new Map<
        string,
        typeof products.$inferSelect
      >();
      let productsAdded = 0;
      for (const [importedName, salesforceProduct] of salesforceProductByImportedName) {
        const canonicalName = normalizeProductName(salesforceProduct.name);
        let product = existingProductByName.get(canonicalName);
        if (!product) {
          [product] = await db
            .insert(products)
            .values({
              name: salesforceProduct.name,
              category: salesforceProduct.family,
              active: true,
            })
            .returning();
          existingProductByName.set(canonicalName, product);
          productsAdded += 1;
        } else if (product.category !== salesforceProduct.family) {
          [product] = await db
            .update(products)
            .set({ category: salesforceProduct.family })
            .where(eq(products.id, product.id))
            .returning();
          existingProductByName.set(canonicalName, product);
        }
        productByImportedName.set(importedName, product);
      }
      for (const row of rows) {
        const product = productByImportedName.get(
          normalizeProductName(row.productName),
        )!;
        const condition = String(row.condition).trim();
        const [existing] = await db
          .select()
          .from(productCosts)
          .where(
            and(
              eq(productCosts.productId, product.id),
              eq(productCosts.condition, condition),
              eq(productCosts.effectiveFrom, row.effectiveFrom),
            ),
          )
          .limit(1);
        const unitCost = Math.round(Number(row.unitCost));
        if (existing)
          await db
            .update(productCosts)
            .set({ unitCost })
            .where(eq(productCosts.id, existing.id));
        else
          await db.insert(productCosts).values({
            productId: product.id,
            condition,
            unitCost,
            effectiveFrom: row.effectiveFrom,
          });
      }
      const affectedProductIds = [
        ...new Set(
          rows.map(
            (row) =>
              productByImportedName.get(normalizeProductName(row.productName))!
                .id,
          ),
        ),
      ];
      for (const productId of affectedProductIds)
        await repriceInstallationsForProduct(productId);
      return Response.json(
        {
          data: await snapshot(access),
          importResult: {
            total: rows.length,
            productsAdded,
          },
        },
        { status: 201 },
      );
    } else if (action === "updateCost") {
      assertAdmin(access);
      const costId = Number(body.costId);
      const productId = Number(body.productId);
      const unitCost = Number(body.unitCost);
      const condition = String(body.condition ?? "신품");
      const effectiveFrom = String(body.effectiveFrom);
      const [existing] = await db
        .select()
        .from(productCosts)
        .where(eq(productCosts.id, costId))
        .limit(1);
      if (!existing || existing.productId !== productId)
        return Response.json(
          { error: "수정할 원가 이력을 찾지 못했습니다." },
          { status: 404 },
        );
      await db
        .update(productCosts)
        .set({ unitCost, condition, effectiveFrom })
        .where(eq(productCosts.id, costId));
      await repriceInstallationsForProduct(productId);
    } else if (action === "updateProductAndCost") {
      assertAdmin(access);
      const productId = Number(body.productId);
      const costId = Number(body.costId || 0);
      const dealerProductCostId = Number(body.dealerProductCostId || 0);
      const name = normalizeProductName(body.name);
      const category = String(body.category ?? "").trim() || "수동 등록";
      const active = body.active !== false && body.active !== "false";
      const directCostAllowed =
        body.directCostAllowed === true ||
        body.directCostAllowed === "on" ||
        body.directCostAllowed === "true";
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
      if (!product)
        return Response.json(
          { error: "수정할 제품을 찾지 못했습니다." },
          { status: 404 },
        );
      if (!name)
        return Response.json(
          { error: "제품명을 입력해주세요." },
          { status: 400 },
        );
      const productRows = await db.select().from(products);
      const duplicate = productRows.find(
        (row) =>
          row.id !== productId && normalizeProductName(row.name) === name,
      );
      if (duplicate)
        return Response.json(
          { error: "같은 이름의 제품이 이미 등록되어 있습니다." },
          { status: 400 },
        );

      let costUpdate:
        | { unitCost: number; condition: string; effectiveFrom: string }
        | null = null;
      let existingProductCost: typeof productCosts.$inferSelect | null = null;
      let existingDealerProductCost:
        | typeof dealerProductCosts.$inferSelect
        | null = null;
      if (costId || dealerProductCostId) {
        const unitCost = Number(body.unitCost);
        const condition = String(body.condition ?? "신품").trim();
        const effectiveFrom = String(body.effectiveFrom ?? "").trim();
        if (costId) {
          [existingProductCost] = await db
            .select()
            .from(productCosts)
            .where(eq(productCosts.id, costId))
            .limit(1);
        } else {
          [existingDealerProductCost] = await db
            .select()
            .from(dealerProductCosts)
            .where(eq(dealerProductCosts.id, dealerProductCostId))
            .limit(1);
        }
        const existingCost = existingProductCost ?? existingDealerProductCost;
        if (!existingCost || existingCost.productId !== productId)
          return Response.json(
            { error: "수정할 원가 이력을 찾지 못했습니다." },
            { status: 404 },
          );
        if (
          !["신품", "중고"].includes(condition) ||
          !Number.isFinite(unitCost) ||
          unitCost < 0 ||
          !DATE_PATTERN.test(effectiveFrom)
        )
          return Response.json(
            { error: "제품 상태, 원가 또는 적용일을 확인해주세요." },
            { status: 400 },
          );
        costUpdate = {
          unitCost: Math.round(unitCost),
          condition,
          effectiveFrom,
        };
      }

      await db
        .update(products)
        .set({ name, category, active, directCostAllowed })
        .where(eq(products.id, productId));

      let shouldReprice = false;
      const desiredDealerId = Number(body.dealerId || 0);
      if (desiredDealerId) {
        const [dealer] = await db
          .select()
          .from(dealers)
          .where(eq(dealers.id, desiredDealerId))
          .limit(1);
        if (!dealer?.active)
          return Response.json(
            { error: "적용할 딜러를 확인해주세요." },
            { status: 400 },
          );
      }
      if (costId && costUpdate) {
        if (desiredDealerId) {
          await db.delete(productCosts).where(eq(productCosts.id, costId));
          await db.insert(dealerProductCosts).values({
            dealerId: desiredDealerId,
            productId,
            ...costUpdate,
          });
        } else {
          await db
            .update(productCosts)
            .set(costUpdate)
            .where(eq(productCosts.id, costId));
        }
        shouldReprice = true;
      }
      if (dealerProductCostId && costUpdate) {
        if (desiredDealerId) {
          await db
            .update(dealerProductCosts)
            .set({ dealerId: desiredDealerId, ...costUpdate })
            .where(eq(dealerProductCosts.id, dealerProductCostId));
        } else {
          await db
            .delete(dealerProductCosts)
            .where(eq(dealerProductCosts.id, dealerProductCostId));
          await db.insert(productCosts).values({
            productId,
            ...costUpdate,
          });
        }
        shouldReprice = true;
      }

      if (product.directCostAllowed && !directCostAllowed) {
        await db
          .update(installations)
          .set({ unitCostOverridden: false })
          .where(eq(installations.productId, productId));
        shouldReprice = true;
      }
      if (shouldReprice) {
        await repriceInstallationsForProduct(productId);
      }
    } else if (action === "updateProduct") {
      assertAdmin(access);
      const productId = Number(body.productId);
      const name = normalizeProductName(body.name);
      const category = String(body.category ?? "").trim() || "수동 등록";
      const active = body.active !== false && body.active !== "false";
      const directCostAllowed =
        body.directCostAllowed === true || body.directCostAllowed === "on";
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
      if (!product)
        return Response.json(
          { error: "수정할 제품을 찾지 못했습니다." },
          { status: 404 },
        );
      if (!name)
        return Response.json(
          { error: "제품명을 입력해주세요." },
          { status: 400 },
        );
      const productRows = await db.select().from(products);
      const duplicate = productRows.find(
        (row) =>
          row.id !== productId && normalizeProductName(row.name) === name,
      );
      if (duplicate)
        return Response.json(
          { error: "같은 이름의 제품이 이미 등록되어 있습니다." },
          { status: 400 },
        );
      await db
        .update(products)
        .set({ name, category, active, directCostAllowed })
        .where(eq(products.id, productId));
      if (product.directCostAllowed && !directCostAllowed) {
        await db
          .update(installations)
          .set({ unitCostOverridden: false })
          .where(eq(installations.productId, productId));
        await repriceInstallationsForProduct(productId);
      }
    } else if (action === "createRule") {
      assertAdmin(access);
      await db
        .insert(dealerRules)
        .values({
          dealerId: Number(body.dealerId),
          effectiveFrom: String(body.effectiveFrom),
          costShareRate: Number(body.costShareRate),
          profitShareRate: Number(body.profitShareRate),
          vatSeparate: true,
        });
    } else if (action === "saveDealerProductCost") {
      assertAdmin(access);
      const dealerIds = [
        ...new Set([
          ...numberList(body.dealerIds),
          ...numberList(body.dealerId),
        ]),
      ];
      let productId = Number(body.productId);
      const productName = normalizeProductName(body.productName);
      const productFamily =
        String(body.productFamily ?? "").trim() || "미지정";
      const condition = String(body.condition ?? "신품").trim();
      const unitCost = Math.round(Number(body.unitCost));
      const effectiveFrom = String(body.effectiveFrom ?? "").trim();
      if (!productId && productName) {
        const productRows = await db.select().from(products);
        const existingProduct = productRows.find(
          (row) => normalizeProductName(row.name) === productName,
        );
        if (existingProduct) productId = existingProduct.id;
        else {
          const [created] = await db
            .insert(products)
            .values({
              name: productName,
              category: productFamily,
              active: true,
            })
            .returning();
          productId = created.id;
        }
      }
      if (
        !dealerIds.length ||
        !productId ||
        !["신품", "중고"].includes(condition) ||
        !Number.isFinite(unitCost) ||
        unitCost < 0 ||
        !DATE_PATTERN.test(effectiveFrom)
      )
        return Response.json(
          { error: "딜러, 제품, 원가와 적용일을 확인해주세요." },
          { status: 400 },
        );
      const activeDealers = await db.select().from(dealers);
      const activeDealerIds = new Set(
        activeDealers
          .filter((dealer) => dealer.active)
          .map((dealer) => dealer.id),
      );
      if (dealerIds.some((dealerId) => !activeDealerIds.has(dealerId)))
        return Response.json(
          { error: "적용할 딜러를 확인해주세요." },
          { status: 400 },
        );
      if (productName && productFamily !== "미지정") {
        const [product] = await db
          .select()
          .from(products)
          .where(eq(products.id, productId))
          .limit(1);
        if (
          product &&
          product.category !== productFamily
        )
          await db
            .update(products)
            .set({ category: productFamily })
            .where(eq(products.id, productId));
      }
      await db.insert(dealerProductCosts).values(
        dealerIds.map((dealerId) => ({
          dealerId,
          productId,
          condition,
          unitCost,
          effectiveFrom,
        })),
      );
      await repriceInstallationsForProduct(productId);
    } else if (action === "deleteDealerProductCost") {
      assertAdmin(access);
      const dealerProductCostId = Number(body.dealerProductCostId);
      if (!dealerProductCostId)
        return Response.json(
          { error: "삭제할 딜러별 원가를 선택해주세요." },
          { status: 400 },
        );
      await db
        .delete(dealerProductCosts)
        .where(eq(dealerProductCosts.id, dealerProductCostId));
    } else if (action === "saveDealerCategoryCost") {
      assertAdmin(access);
      const dealerCategoryCostId = Number(body.dealerCategoryCostId || 0);
      const dealerIds = [
        ...new Set([
          ...numberList(body.dealerIds),
          ...numberList(body.dealerId),
        ]),
      ];
      const productCategory = String(body.productCategory ?? "").trim();
      const condition = String(body.condition ?? "신품").trim();
      const unitCost = Math.round(Number(body.unitCost));
      const effectiveFrom = String(body.effectiveFrom ?? "").trim();
      if (
        !dealerIds.length ||
        !productCategory ||
        !["신품", "중고"].includes(condition) ||
        !Number.isFinite(unitCost) ||
        unitCost < 0 ||
        !DATE_PATTERN.test(effectiveFrom)
      )
        return Response.json(
          { error: "딜러, 제품군, 원가와 적용일을 확인해주세요." },
          { status: 400 },
        );
      const activeDealers = await db.select().from(dealers);
      const activeDealerIds = new Set(
        activeDealers
          .filter((dealer) => dealer.active)
          .map((dealer) => dealer.id),
      );
      if (dealerIds.some((dealerId) => !activeDealerIds.has(dealerId)))
        return Response.json(
          { error: "적용할 딜러를 확인해주세요." },
          { status: 400 },
        );
      let previous: typeof dealerCategoryCosts.$inferSelect | undefined;
      if (dealerCategoryCostId) {
        const dealerId = dealerIds[0];
        const values = {
          dealerId,
          productCategory,
          condition,
          unitCost,
          effectiveFrom,
        };
        [previous] = await db
          .select()
          .from(dealerCategoryCosts)
          .where(eq(dealerCategoryCosts.id, dealerCategoryCostId))
          .limit(1);
        if (!previous)
          return Response.json(
            { error: "수정할 제품군 원가를 찾지 못했습니다." },
            { status: 404 },
          );
        await db
          .update(dealerCategoryCosts)
          .set(values)
          .where(eq(dealerCategoryCosts.id, dealerCategoryCostId));
      } else {
        await db.insert(dealerCategoryCosts).values(
          dealerIds.map((dealerId) => ({
            dealerId,
            productCategory,
            condition,
            unitCost,
            effectiveFrom,
          })),
        );
      }
      for (const dealerId of dealerIds)
        await repriceInstallationsForDealerCategory(
          dealerId,
          productCategory,
          condition,
        );
      if (
        previous &&
        (previous.dealerId !== dealerIds[0] ||
          previous.productCategory !== productCategory ||
          previous.condition !== condition)
      )
        await repriceInstallationsForDealerCategory(
          previous.dealerId,
          previous.productCategory,
          previous.condition,
        );
    } else if (action === "deleteDealerCategoryCost") {
      assertAdmin(access);
      const dealerCategoryCostId = Number(body.dealerCategoryCostId);
      const [categoryCost] = await db
        .select()
        .from(dealerCategoryCosts)
        .where(eq(dealerCategoryCosts.id, dealerCategoryCostId))
        .limit(1);
      if (!categoryCost)
        return Response.json(
          { error: "삭제할 제품군 원가를 찾지 못했습니다." },
          { status: 404 },
        );
      await db
        .delete(dealerCategoryCosts)
        .where(eq(dealerCategoryCosts.id, dealerCategoryCostId));
      await repriceInstallationsForDealerCategory(
        categoryCost.dealerId,
        categoryCost.productCategory,
        categoryCost.condition,
      );
    } else if (action === "saveDealerCommissionRule") {
      assertAdmin(access);
      const dealerId = Number(body.dealerId);
      const targetType = body.targetType === "product" ? "product" : "productCategory";
      const requestedProductId = Number(body.productId);
      const productCategory = String(body.productCategory ?? "").trim();
      const condition = String(body.condition ?? "신품").trim();
      const rentalAmount = Math.round(Number(body.rentalAmount));
      const contractTermMonths = Math.round(
        Number(body.contractTermMonths || 36),
      );
      const commissionAmount = Math.round(Number(body.commissionAmount));
      const effectiveFrom = String(body.effectiveFrom ?? "").trim();
      if (
        !dealerId ||
        (targetType === "productCategory" && !productCategory) ||
        (targetType === "product" &&
          (!Number.isInteger(requestedProductId) || requestedProductId <= 0)) ||
        !["신품", "중고"].includes(condition) ||
        !Number.isFinite(rentalAmount) ||
        rentalAmount < 0 ||
        !Number.isFinite(contractTermMonths) ||
        contractTermMonths <= 0 ||
        !Number.isFinite(commissionAmount) ||
        commissionAmount < 0 ||
        !DATE_PATTERN.test(effectiveFrom)
      )
        return Response.json(
          { error: "딜러, 적용 대상, 상태, 임대료, 약정, 수당과 적용일을 확인해주세요." },
          { status: 400 },
        );
      let resolvedCategory = productCategory;
      let productId: number | null = null;
      if (targetType === "product") {
        const [product] = await db
          .select()
          .from(products)
          .where(eq(products.id, requestedProductId))
          .limit(1);
        if (!product)
          return Response.json({ error: "선택한 제품을 찾지 못했습니다." }, { status: 400 });
        productId = product.id;
        resolvedCategory = product.category;
      }
      await db.insert(dealerCommissionRules).values({
        dealerId,
        targetType,
        productId,
        productCategory: resolvedCategory,
        condition,
        rentalAmount,
        contractTermMonths,
        commissionAmount,
        effectiveFrom,
      });
    } else if (action === "updateDealerCommissionRule") {
      assertAdmin(access);
      const dealerCommissionRuleId = Number(body.dealerCommissionRuleId);
      const targetType = body.targetType === "product" ? "product" : "productCategory";
      const requestedProductId = Number(body.productId);
      const productCategory = String(body.productCategory ?? "").trim();
      const condition = String(body.condition ?? "신품").trim();
      const rentalAmount = Math.round(Number(body.rentalAmount));
      const contractTermMonths = Math.round(
        Number(body.contractTermMonths || 36),
      );
      const commissionAmount = Math.round(Number(body.commissionAmount));
      const effectiveFrom = String(body.effectiveFrom ?? "").trim();
      if (
        !dealerCommissionRuleId ||
        (targetType === "productCategory" && !productCategory) ||
        (targetType === "product" &&
          (!Number.isInteger(requestedProductId) || requestedProductId <= 0)) ||
        !["신품", "중고"].includes(condition) ||
        !Number.isFinite(rentalAmount) ||
        rentalAmount < 0 ||
        !Number.isFinite(contractTermMonths) ||
        contractTermMonths <= 0 ||
        !Number.isFinite(commissionAmount) ||
        commissionAmount < 0 ||
        !DATE_PATTERN.test(effectiveFrom)
      )
        return Response.json(
          { error: "적용 대상, 상태, 임대료, 약정, 수당과 적용일을 확인해주세요." },
          { status: 400 },
        );
      const [existingRule] = await db
        .select()
        .from(dealerCommissionRules)
        .where(eq(dealerCommissionRules.id, dealerCommissionRuleId))
        .limit(1);
      if (!existingRule)
        return Response.json(
          { error: "수정할 정액 수당을 찾지 못했습니다." },
          { status: 404 },
        );
      let resolvedCategory = productCategory;
      let productId: number | null = null;
      if (targetType === "product") {
        const [product] = await db
          .select()
          .from(products)
          .where(eq(products.id, requestedProductId))
          .limit(1);
        if (!product)
          return Response.json({ error: "선택한 제품을 찾지 못했습니다." }, { status: 400 });
        productId = product.id;
        resolvedCategory = product.category;
      }
      await db
        .update(dealerCommissionRules)
        .set({
          targetType,
          productId,
          productCategory: resolvedCategory,
          condition,
          rentalAmount,
          contractTermMonths,
          commissionAmount,
          effectiveFrom,
        })
        .where(eq(dealerCommissionRules.id, dealerCommissionRuleId));
    } else if (action === "deleteDealerCommissionRule") {
      assertAdmin(access);
      const dealerCommissionRuleId = Number(body.dealerCommissionRuleId);
      if (!dealerCommissionRuleId)
        return Response.json(
          { error: "삭제할 정액 수당을 선택해주세요." },
          { status: 400 },
        );
      await db
        .delete(dealerCommissionRules)
        .where(eq(dealerCommissionRules.id, dealerCommissionRuleId));
    } else if (action === "saveAdvancePayment") {
      assertAdmin(access);
      const dealerId = Number(body.dealerId);
      const amount = Math.round(Number(body.amount));
      const paymentDate = String(body.paymentDate ?? "");
      const settlementMonth = String(body.settlementMonth ?? "");
      const [dealer] = await db
        .select()
        .from(dealers)
        .where(eq(dealers.id, dealerId))
        .limit(1);
      if (!dealer?.advanceEnabled)
        return Response.json(
          { error: "선지급을 사용하는 딜러만 등록할 수 있습니다." },
          { status: 400 },
        );
      if (
        !DATE_PATTERN.test(paymentDate) ||
        !MONTH_PATTERN.test(settlementMonth) ||
        amount <= 0
      )
        return Response.json(
          { error: "정산월, 지급일자와 0원보다 큰 금액을 입력해주세요." },
          { status: 400 },
        );
      const values = {
        dealerId,
        paymentDate,
        settlementMonth,
        amount,
        memo: String(body.memo ?? "").trim() || null,
      };
      if (body.advancePaymentId)
        await db
          .update(advancePayments)
          .set(values)
          .where(eq(advancePayments.id, Number(body.advancePaymentId)));
      else
        await db
          .insert(advancePayments)
          .values({ ...values, createdAt: new Date().toISOString() });
    } else if (action === "saveMonthlySettlementStatus") {
      assertAdmin(access);
      const dealerId = Number(body.dealerId);
      const settlementMonth = String(body.settlementMonth ?? "").trim();
      const settlementDate = String(body.settlementDate ?? "").trim() || null;
      const taxInvoiceIssuedAt =
        String(body.taxInvoiceIssuedAt ?? "").trim() || null;
      const paid = body.paid === true || body.paid === "on";
      const memo = String(body.memo ?? "").trim() || null;
      if (
        !dealerId ||
        !MONTH_PATTERN.test(settlementMonth) ||
        (settlementDate && !DATE_PATTERN.test(settlementDate)) ||
        (taxInvoiceIssuedAt && !DATE_PATTERN.test(taxInvoiceIssuedAt))
      )
        return Response.json(
          { error: "정산월, 정산일자 또는 세금계산서 발행일자를 확인해주세요." },
          { status: 400 },
        );
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO monthly_settlement_statuses
          (dealer_id, settlement_month, settlement_date, paid, tax_invoice_issued_at, memo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(dealer_id, settlement_month) DO UPDATE SET
           settlement_date = excluded.settlement_date,
           paid = excluded.paid,
           tax_invoice_issued_at = excluded.tax_invoice_issued_at,
           memo = excluded.memo,
           updated_at = excluded.updated_at`,
      )
        .bind(
          dealerId,
          settlementMonth,
          settlementDate,
          paid ? 1 : 0,
          taxInvoiceIssuedAt,
          memo,
          now,
          now,
        )
        .run();
      if (paid) {
        // Record each paid installment component once. This is the line-level
        // dedupe key used for delayed/carryover settlement (FIXING/INCENTIVE).
        const merchantRows = await db.select().from(merchants);
        const dealerMerchantIds = new Set(
          merchantRows
            .filter((merchant) => merchant.dealerId === dealerId)
            .map((merchant) => merchant.id),
        );
        const installmentRows = await db.select().from(installations);
        const settlementStatements = installmentRows.flatMap((item) => {
            if (!dealerMerchantIds.has(item.merchantId) || item.transactionClassification !== "할부구매" || (item.contractInstallAt || "").slice(0, 7) > settlementMonth) return [];
            const statements = [];
            if (item.fixing > 0 && item.fixingPaymentStatus === "입금완료" && (!item.fixingPaymentDate || item.fixingPaymentDate.slice(0, 7) <= settlementMonth) && !item.fixingSettlementMonth)
              statements.push(env.DB.prepare("UPDATE installations SET fixing_settlement_month = ? WHERE id = ? AND fixing_settlement_month IS NULL").bind(settlementMonth, item.id));
            if (item.incentive > 0 && item.incentivePaymentStatus === "입금완료" && (!item.incentivePaymentDate || item.incentivePaymentDate.slice(0, 7) <= settlementMonth) && !item.incentiveSettlementMonth)
              statements.push(env.DB.prepare("UPDATE installations SET incentive_settlement_month = ? WHERE id = ? AND incentive_settlement_month IS NULL").bind(settlementMonth, item.id));
            return statements;
          });
        if (settlementStatements.length) await env.DB.batch(settlementStatements);
      }
    } else if (action === "deleteAdvancePayment") {
      assertAdmin(access);
      const advancePaymentId = Number(body.advancePaymentId);
      const [advance] = await db
        .select()
        .from(advancePayments)
        .where(eq(advancePayments.id, advancePaymentId))
        .limit(1);
      if (!advance)
        return Response.json(
          { error: "삭제할 선지급 내역을 찾지 못했습니다." },
          { status: 404 },
        );
      await db
        .delete(advancePayments)
        .where(eq(advancePayments.id, advancePaymentId));
    } else if (action === "saveVanSettlement") {
      assertAdmin(access);
      const dealerId = Number(body.dealerId);
      const vanSettlementId = Number(body.vanSettlementId || 0);
      const settlementMonth = String(body.settlementMonth ?? "").trim();
      const vanCompany = String(body.vanCompany ?? "").trim().toUpperCase();
      const transactionCount = Math.round(Number(body.transactionCount ?? 0));
      const paymentAmount = Math.round(Number(body.paymentAmount ?? 0));
      const vanFee = Math.round(Number(body.vanFee ?? 0));
      if (
        !dealerId ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(settlementMonth) ||
        !vanCompany ||
        [transactionCount, paymentAmount, vanFee].some(
          (value) => !Number.isFinite(value) || value < 0,
        )
      )
        return Response.json(
          { error: "정산월, VAN사와 0 이상의 실적 금액을 입력해주세요." },
          { status: 400 },
        );
      const [dealer] = await db
        .select()
        .from(dealers)
        .where(eq(dealers.id, dealerId))
        .limit(1);
      if (!dealer?.vanSettlementEnabled)
        return Response.json(
          { error: "VAN 실적을 사용하는 딜러만 등록할 수 있습니다." },
          { status: 400 },
        );
      const now = new Date().toISOString();
      const values = {
        dealerId,
        settlementMonth,
        vanCompany,
        transactionCount,
        paymentAmount,
        vanFee,
        sourceFile: null,
        updatedAt: now,
      };
      if (vanSettlementId) {
        const [existing] = await db
          .select()
          .from(vanSettlements)
          .where(eq(vanSettlements.id, vanSettlementId))
          .limit(1);
        if (!existing)
          return Response.json(
            { error: "수정할 VAN 실적을 찾지 못했습니다." },
            { status: 404 },
          );
        await db
          .update(vanSettlements)
          .set(values)
          .where(eq(vanSettlements.id, vanSettlementId));
      } else {
        await db
          .insert(vanSettlements)
          .values({ ...values, createdAt: now })
          .onConflictDoUpdate({
            target: [
              vanSettlements.dealerId,
              vanSettlements.settlementMonth,
              vanSettlements.vanCompany,
            ],
            set: values,
          });
      }
    } else if (action === "importVanSettlements") {
      assertAdmin(access);
      const dealerId = Number(body.dealerId);
      const rows = Array.isArray(body.rows)
        ? (body.rows as ImportedVanRow[])
        : [];
      if (!dealerId || !rows.length || rows.length > 3000)
        return Response.json(
          { error: "딜러와 1건 이상 3,000건 이하의 VAN 실적을 입력해주세요." },
          { status: 400 },
        );
      const [dealer] = await db
        .select()
        .from(dealers)
        .where(eq(dealers.id, dealerId))
        .limit(1);
      if (!dealer?.vanSettlementEnabled)
        return Response.json(
          { error: "VAN 실적을 사용하는 딜러만 업로드할 수 있습니다." },
          { status: 400 },
        );
      const fileName = String(body.fileName ?? "VAN실적.xlsx").slice(0, 180);
      const invalid = rows.filter(
        (row) =>
          !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.settlementMonth) ||
          !String(row.vanCompany ?? "").trim() ||
          [row.transactionCount, row.paymentAmount, row.vanFee].some(
            (value) => !Number.isFinite(Number(value)) || Number(value) < 0,
          ),
      );
      if (invalid.length)
        return Response.json(
          {
            error: `${invalid[0].rowNumber}행의 정산월 또는 VAN 실적 값을 확인해주세요.`,
          },
          { status: 400 },
        );
      const now = new Date().toISOString();
      for (let start = 0; start < rows.length; start += 100) {
        const batch = rows.slice(start, start + 100).map((row) =>
          env.DB.prepare(
            `INSERT INTO van_settlements (dealer_id, settlement_month, van_company, transaction_count, payment_amount, van_fee, source_file, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(dealer_id, settlement_month, van_company) DO UPDATE SET
               transaction_count = excluded.transaction_count,
               payment_amount = excluded.payment_amount,
               van_fee = excluded.van_fee,
               source_file = excluded.source_file,
               updated_at = excluded.updated_at`,
          ).bind(
            dealerId,
            row.settlementMonth,
            String(row.vanCompany).trim().toUpperCase(),
            Math.round(Number(row.transactionCount)),
            Math.round(Number(row.paymentAmount)),
            Math.round(Number(row.vanFee)),
            fileName,
            now,
            now,
          ),
        );
        await env.DB.batch(batch);
      }
      return Response.json(
        {
          data: await snapshot(access),
          importResult: { total: rows.length },
        },
        { status: 201 },
      );
    } else if (action === "createDealerMember") {
      assertAdmin(access);
      const email = String(body.email ?? "")
        .trim()
        .toLowerCase();
      const dealerId = Number(body.dealerId);
      if (!email || !dealerId)
        return Response.json(
          { error: "딜러와 로그인 이메일을 입력해주세요." },
          { status: 400 },
        );
      await db
        .insert(dealerMembers)
        .values({
          userId: `pending:${email}`,
          email,
          role: "dealer",
          dealerId,
          active: true,
        });
    } else if (action === "importPayments") {
      const rows = Array.isArray(body.rows) ? (body.rows as ImportedRow[]) : [];
      if (!rows.length || rows.length > 3000)
        return Response.json(
          { error: "1건 이상 3,000건 이하의 납부내역을 업로드해주세요." },
          { status: 400 },
        );
      const fileName = String(body.fileName ?? "납부내역.xlsx").slice(0, 180);
      const includesVat = body.amountIncludesVat !== false;
      const scoped = await snapshot(access);
      const merchantIds = new Set(scoped.merchants.map((row) => row.id));
      const payerMap = new Map(
        scoped.payerAccounts
          .filter((row) => merchantIds.has(row.merchantId))
          .map((row) => [normalizePayerNumber(row.payerNumber), row]),
      );
      const matched: Array<{
        row: ImportedRow;
        payerId: number;
        merchantId: number;
        supply: number;
        vat: number;
        key: string;
      }> = [];
      const unmatched: Array<{
        rowNumber: number;
        payerNumber: string;
        reason: string;
      }> = [];
      for (const row of rows) {
        const payerNumber = normalizePayerNumber(row.payerNumber);
        const payer = payerMap.get(payerNumber);
        if (!payer) {
          unmatched.push({
            rowNumber: row.rowNumber,
            payerNumber,
            reason: "등록되지 않았거나 접근할 수 없는 납부자번호",
          });
          continue;
        }
        const gross = Math.round(Number(row.amount));
        if (!gross || !row.paymentDate) {
          unmatched.push({
            rowNumber: row.rowNumber,
            payerNumber,
            reason: "납부일 또는 금액 누락",
          });
          continue;
        }
        const supply = includesVat ? Math.round(gross / 1.1) : gross;
        const vat = includesVat ? gross - supply : Math.round(gross * 0.1);
        const billingMonth = row.billingMonth || row.paymentDate.slice(0, 7);
        const key = row.referenceNumber
          ? `ref:${row.referenceNumber}`
          : `${payerNumber}|${row.paymentDate}|${billingMonth}|${gross}`;
        matched.push({
          row,
          payerId: payer.id,
          merchantId: payer.merchantId,
          supply,
          vat,
          key,
        });
      }
      let imported = 0;
      let duplicates = 0;
      for (let start = 0; start < matched.length; start += 100) {
        const batch = matched
          .slice(start, start + 100)
          .map((item) =>
            env.DB.prepare(
              `INSERT OR IGNORE INTO payments (payer_account_id, merchant_id, billing_month, payment_date, gross_amount, supply_amount, vat_amount, source_file, external_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).bind(
              item.payerId,
              item.merchantId,
              item.row.billingMonth || item.row.paymentDate.slice(0, 7),
              item.row.paymentDate,
              Math.round(Number(item.row.amount)),
              item.supply,
              item.vat,
              fileName,
              item.key,
              new Date().toISOString(),
            ),
          );
        const results = await env.DB.batch(batch);
        for (const result of results) {
          if ((result.meta?.changes ?? 0) > 0) imported += 1;
          else duplicates += 1;
        }
      }
      await db
        .insert(paymentImports)
        .values({
          dealerId: access.role === "dealer" ? access.dealerId : null,
          fileName,
          importedBy: access.email,
          totalRows: rows.length,
          matchedRows: imported,
          unmatchedRows: unmatched.length,
          duplicateRows: duplicates,
          createdAt: new Date().toISOString(),
        });
      return Response.json(
        {
          data: await snapshot(access),
          importResult: { total: rows.length, imported, duplicates, unmatched },
        },
        { status: 201 },
      );
    } else
      return Response.json(
        { error: "지원하지 않는 작업입니다." },
        { status: 400 },
      );
    return Response.json(await snapshot(access), { status: 201 });
  } catch (error) {
    return Response.json(
      { error: errorMessage(error) },
      { status: error instanceof AccessError ? error.status : 500 },
    );
  }
}
