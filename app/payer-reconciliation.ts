/** Shared rules for CMS matching, manual management and payment import. */
export function normalizePayerNumber(value: unknown) {
  return String(value ?? "").trim().replace(/[\s\u200B-\u200D\uFEFF-]/g, "");
}

export function isCmsPayer(label: string | null | undefined) {
  return label === "Salesforce CMS" || label?.startsWith("Salesforce CMS ·") === true;
}

function businessNumber(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function sameSalesforceId(a: string | null | undefined, b: string | null | undefined) {
  return Boolean(a && b && a.slice(0, 15) === b.slice(0, 15));
}

type CmsAccount = { Id: string; BusinessNumber__c: string | null; ManagingFranchise__c?: string | null };
type CmsMerchant = { id: number; dealerId: number; salesforceId: string | null; businessNumber: string };

export function resolveCmsMerchant<T extends CmsMerchant>(
  account: CmsAccount | undefined,
  dealerId: number,
  merchants: T[],
  accounts: CmsAccount[],
  legacyCases: Array<{ Id: string; AccountId: string }>,
  expectedManager?: string,
): { merchant: T | null; reason: string | null } {
  if (!account) return { merchant: null, reason: "CMS의 가맹점이 해당 딜러의 Salesforce 조회 결과에 없습니다." };
  if (expectedManager && account.ManagingFranchise__c?.trim() && account.ManagingFranchise__c.trim() !== expectedManager)
    return { merchant: null, reason: "Salesforce 관리가맹점이 다른 딜러로 지정되어 있어 자동 연결을 보류했습니다." };
  const own = merchants.filter(row => row.dealerId === dealerId);
  const direct = own.filter(row => sameSalesforceId(row.salesforceId, account.Id));
  if (direct.length === 1) return { merchant: direct[0], reason: null };
  if (direct.length > 1) return { merchant: null, reason: "동일 Salesforce 가맹점에 연결된 사이트 가맹점이 여러 개입니다." };
  const legacy = own.filter(row => legacyCases.some(c => sameSalesforceId(c.Id, row.salesforceId) && sameSalesforceId(c.AccountId, account.Id)));
  if (legacy.length === 1) return { merchant: legacy[0], reason: null };
  if (legacy.length > 1) return { merchant: null, reason: "문의 ID로 연결된 사이트 가맹점이 여러 개입니다." };
  const number = businessNumber(account.BusinessNumber__c);
  if (!number) return { merchant: null, reason: "사업자번호가 없어 기존 사이트 가맹점과 연결할 수 없습니다." };
  if (accounts.filter(row => businessNumber(row.BusinessNumber__c) === number).length !== 1)
    return { merchant: null, reason: "Salesforce에 동일 사업자번호 가맹점이 여러 개 있어 자동 연결을 보류했습니다." };
  const candidates = own.filter(row => businessNumber(row.businessNumber) === number &&
    (!row.salesforceId || !row.salesforceId.startsWith("001")));
  if (candidates.length === 1) return { merchant: candidates[0], reason: null };
  return { merchant: null, reason: candidates.length > 1
    ? "사이트에 동일 사업자번호 가맹점이 여러 개 있어 자동 연결을 보류했습니다."
    : "사업자번호가 일치하는 기존 사이트 가맹점이 없습니다. 가맹점 연결 정보를 확인해주세요." };
}

/** Only existing merchants of the selected dealer can expand the CMS scope. */
export function supplementalAccountFilters(dealerId: number, merchants: CmsMerchant[]) {
  const own = merchants.filter(row => row.dealerId === dealerId);
  const ids = [...new Set(own.map(row => row.salesforceId).filter((id): id is string =>
    Boolean(id && /^001[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(id))))];
  const numbers = new Set<string>();
  for (const row of own) {
    const normalized = businessNumber(row.businessNumber);
    if (!normalized) continue;
    numbers.add(normalized);
    if (normalized.length === 10) numbers.add(`${normalized.slice(0,3)}-${normalized.slice(3,5)}-${normalized.slice(5)}`);
  }
  const filters: string[] = [];
  for (let i=0; i<ids.length; i+=150) filters.push(`Id IN (${ids.slice(i,i+150).map(id => `'${id}'`).join(',')})`);
  const values = [...numbers];
  for (let i=0; i<values.length; i+=150) filters.push(`BusinessNumber__c IN (${values.slice(i,i+150).map(number => `'${number}'`).join(',')})`);
  return filters;
}

/** Idempotent and separate from existing payment tables; no imported data changes. */
export const ensurePayerSyncControlsSql = `CREATE TABLE IF NOT EXISTS payer_sync_controls (
  dealer_id INTEGER NOT NULL,
  payer_number TEXT NOT NULL,
  merchant_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('edited','deleted')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dealer_id, payer_number)
)`;

export const blockPayerSyncSql = `INSERT INTO payer_sync_controls
  (dealer_id, payer_number, merchant_id, action, updated_at) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(dealer_id, payer_number) DO UPDATE SET merchant_id=excluded.merchant_id,
  action=excluded.action, updated_at=excluded.updated_at`;

export const cmsPayerUpsertSql = `INSERT INTO payer_accounts
  (merchant_id,payer_number,label,monthly_charge,billing_type,installment_months,start_month,end_month,active)
  SELECT ?,?,'Salesforce CMS · VAT 별도',?,'rental',NULL,?,NULL,1
  WHERE NOT EXISTS (SELECT 1 FROM payer_sync_controls WHERE dealer_id=? AND payer_number=?)
  ON CONFLICT(payer_number) DO UPDATE SET
    monthly_charge=excluded.monthly_charge,billing_type=excluded.billing_type,
    label=excluded.label,start_month=CASE WHEN excluded.start_month='' THEN payer_accounts.start_month ELSE excluded.start_month END
  WHERE payer_accounts.merchant_id=excluded.merchant_id
    AND (payer_accounts.label='Salesforce CMS' OR payer_accounts.label LIKE 'Salesforce CMS ·%')
    AND payer_accounts.active=1
    AND NOT EXISTS (SELECT 1 FROM payer_sync_controls WHERE dealer_id=? AND payer_number=?)`;

export type PaymentImportRow = {
  rowNumber: number; payerNumber: string; billingMonth?: string; paymentDate: string;
  amount: number; referenceNumber?: string; merchantName?: string;
};

/** The payer record ID stays stable when the administrator fixes its number. */
export function paymentNaturalKey(payerId: number, paymentDate: string, billingMonth: string, gross: number) {
  return `payer:${payerId}|${paymentDate}|${billingMonth}|${gross}`;
}

export function validPaymentDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}

export function paymentImportReason(row: PaymentImportRow,
  payers: Array<{ payerNumber: string; active: boolean }>) {
  const number = normalizePayerNumber(row.payerNumber);
  if (!number) return "납부자번호 누락";
  const candidates = payers.filter(p => normalizePayerNumber(p.payerNumber) === number && p.active);
  if (candidates.length === 0) return "등록되지 않았거나 비활성인 납부자번호";
  if (candidates.length > 1) return "동일 납부자번호가 여러 가맹점에 연결됨";
  if (!validPaymentDate(row.paymentDate)) return "납입일자가 누락되었거나 올바르지 않음";
  if (row.billingMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.billingMonth)) return "청구월 형식 오류";
  if (!Number.isFinite(row.amount) || !Number.isSafeInteger(Math.round(row.amount)) || Math.round(row.amount) === 0)
    return "납입금액이 누락되었거나 올바르지 않음";
  return null;
}
