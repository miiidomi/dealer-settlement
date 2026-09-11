export type Dealer = {
  id: number;
  name: string;
  salesforceManagerValue: string | null;
  advanceEnabled: boolean;
  flatCommissionEnabled: boolean;
  vanSettlementEnabled: boolean;
  settlementDirectionVisible: boolean;
  installmentPendingEnabled: boolean;
  mainSummaryCards: string | null;
  settlementListColumns: string | null;
  merchantListColumns: string | null;
  merchantDetailFields: string | null;
  merchantDetailBillingColumns: string | null;
  merchantDetailPayerColumns: string | null;
  merchantDetailInstallationColumns: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  active: boolean;
};
export type Access = {
  userId: string;
  email: string;
  displayName: string;
  role: "admin" | "dealer" | "viewer";
  dealerId: number | null;
};
export type Rule = {
  id: number;
  dealerId: number;
  effectiveFrom: string;
  costShareRate: number;
  profitShareRate: number;
  vatSeparate: boolean;
};
export type Product = {
  id: number;
  name: string;
  category: string;
  active: boolean;
  directCostAllowed: boolean;
};
export type Cost = {
  id: number;
  productId: number;
  unitCost: number;
  condition: string;
  effectiveFrom: string;
};
export type DealerProductCost = {
  id: number;
  dealerId: number;
  productId: number;
  unitCost: number;
  condition: string;
  effectiveFrom: string;
};
export type DealerCategoryCost = {
  id: number;
  dealerId: number;
  productCategory: string;
  unitCost: number;
  condition: string;
  effectiveFrom: string;
};
export type DealerCommissionRule = {
  id: number;
  dealerId: number;
  targetType: "productCategory" | "product" | string;
  productId: number | null;
  productCategory: string;
  condition: string;
  rentalAmount: number;
  contractTermMonths: number;
  commissionAmount: number;
  effectiveFrom: string;
};
export type Merchant = {
  id: number;
  name: string;
  businessNumber: string;
  dealerId: number;
  installDate: string;
  accountStatus: string | null;
  salesforceId: string | null;
  lastSyncedAt: string | null;
};
export type Installation = {
  id: number;
  merchantId: number;
  productId: number;
  quantity: number;
  unitCostSnapshot: number;
  unitCostOverridden: boolean;
  unitCostRegistered: boolean;
  salesforceLineItemId: string | null;
  salesforceCaseId: string | null;
  salesforceCaseNumber: string | null;
  contractInstallAt: string | null;
  contractTermMonths: number;
  condition: string;
  van: string | null;
  transactionClassification: string | null;
  fixing: number;
  incentive: number;
  fixingPaymentStatus: "미입금" | "입금완료" | null;
  fixingPaymentDate: string | null;
  incentivePaymentStatus: "미입금" | "입금완료" | null;
  incentivePaymentDate: string | null;
  fixingSettlementMonth: string | null;
  incentiveSettlementMonth: string | null;
  salesAmount: number;
  source: string;
  lastSyncedAt: string | null;
};
export type Billing = {
  id: number;
  merchantId: number;
  billingMonth: string;
  billingAmount: number;
  rentalRevenue: number;
  cancellationRevenue: number;
  otherRevenue: number;
  purchaseType: "rental" | "purchase" | "installment";
  installmentMonths: number | null;
};
export type PayerAccount = {
  id: number;
  merchantId: number;
  payerNumber: string;
  label: string | null;
  monthlyCharge: number;
  billingType: "rental" | "purchase" | "installment";
  installmentMonths: number | null;
  startMonth: string;
  endMonth: string | null;
  active: boolean;
};
export type Payment = {
  id: number;
  payerAccountId: number;
  merchantId: number;
  billingMonth: string;
  paymentDate: string;
  grossAmount: number;
  supplyAmount: number;
  vatAmount: number;
  sourceFile: string;
  externalKey: string;
  createdAt: string;
};
export type Member = {
  id: number;
  email: string;
  role: "admin" | "dealer";
  dealerId: number | null;
  active: boolean;
};
export type AdvancePayment = {
  id: number;
  dealerId: number;
  paymentDate: string;
  settlementMonth: string;
  amount: number;
  memo: string | null;
  createdAt: string;
};
export type MonthlySettlementStatus = {
  id: number;
  dealerId: number;
  settlementMonth: string;
  settlementDate: string | null;
  paid: boolean;
  taxInvoiceIssuedAt: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
};
export type VanSettlement = {
  id: number;
  dealerId: number;
  settlementMonth: string;
  vanCompany: string;
  transactionCount: number;
  paymentAmount: number;
  vanFee: number;
  sourceFile: string | null;
  createdAt: string;
  updatedAt: string;
};
export type DashboardData = {
  access: Access;
  dealers: Dealer[];
  rules: Rule[];
  products: Product[];
  costs: Cost[];
  dealerProductCosts: DealerProductCost[];
  dealerCategoryCosts: DealerCategoryCost[];
  dealerCommissionRules: DealerCommissionRule[];
  merchants: Merchant[];
  installations: Installation[];
  billings: Billing[];
  payerAccounts: PayerAccount[];
  payments: Payment[];
  advancePayments: AdvancePayment[];
  monthlySettlementStatuses: MonthlySettlementStatus[];
  vanSettlements: VanSettlement[];
  members: Member[];
};

export const money = new Intl.NumberFormat("ko-KR");
export const won = (value: number) => `${money.format(Math.round(value))}원`;
export const purchaseLabels = {
  rental: "임대",
  purchase: "일시불 구매",
  installment: "할부 구매",
} as const;

export const MAIN_SUMMARY_CARDS = [
  { key: "expectedBilling", label: "예정 청구액" },
  { key: "paidAmount", label: "실제 납부액" },
  { key: "vanFeeRevenue", label: "VAN피 수익" },
  { key: "installationCost", label: "설치 원가" },
  { key: "totalRevenue", label: "총 수익" },
  { key: "advanceDeduction", label: "선지급 차감" },
  { key: "finalSettlement", label: "최종 정산" },
] as const;
export type MainSummaryCardKey = (typeof MAIN_SUMMARY_CARDS)[number]["key"];
export const DEFAULT_MAIN_SUMMARY_CARDS: MainSummaryCardKey[] =
  MAIN_SUMMARY_CARDS.map((item) => item.key);

export const SETTLEMENT_LIST_COLUMNS = [
  { key: "installDate", label: "최초 설치일" },
  { key: "van", label: "VAN" },
  { key: "productQuantity", label: "제품 수량" },
  { key: "rentalSalesAmount", label: "임대료 판매단가" },
  { key: "installationCost", label: "설치 원가" },
  { key: "expectedBilling", label: "예정 청구액" },
  { key: "paidAmount", label: "실제 납부액" },
  { key: "purchaseRevenue", label: "구매수익" },
  { key: "installmentRevenue", label: "할부구매수익" },
  { key: "settlementAmount", label: "정산금액" },
  { key: "paymentStatus", label: "납부 상태" },
] as const;
export type SettlementListColumnKey =
  (typeof SETTLEMENT_LIST_COLUMNS)[number]["key"];
export const DEFAULT_SETTLEMENT_LIST_COLUMNS: SettlementListColumnKey[] = [
  "installDate",
  "van",
  "installationCost",
  "expectedBilling",
  "paidAmount",
  "purchaseRevenue",
  "installmentRevenue",
  "paymentStatus",
];

export const MERCHANT_LIST_COLUMNS = [
  { key: "van", label: "VAN" },
  { key: "transactionClassification", label: "거래구분" },
  { key: "installDate", label: "최초 설치일" },
  { key: "accountStatus", label: "사업장 상태" },
  { key: "installedProducts", label: "설치 제품" },
  { key: "installationCost", label: "설치 원가" },
  { key: "monthlyCharge", label: "월 청구액" },
] as const;
export type MerchantListColumnKey =
  (typeof MERCHANT_LIST_COLUMNS)[number]["key"];
export const DEFAULT_MERCHANT_LIST_COLUMNS: MerchantListColumnKey[] =
  MERCHANT_LIST_COLUMNS.map((item) => item.key);

export const MERCHANT_DETAIL_FIELDS = [
  { key: "accountStatus", label: "상단 사업장 상태" },
  { key: "vanBadges", label: "상단 VAN" },
  { key: "businessNumber", label: "상단 사업자번호" },
  { key: "firstInstallDate", label: "상단 최초 설치일" },
  { key: "expectedSummary", label: "요약 예정 청구액" },
  { key: "paidSummary", label: "요약 납부 공급가액" },
  { key: "dueSummary", label: "요약 미납액" },
  { key: "productRevenueSummary", label: "요약 제품 수익" },
  { key: "installationCostSummary", label: "요약 전체 설치 원가" },
  { key: "billingTab", label: "월별 납부 현황" },
  { key: "payerTab", label: "납부자번호" },
  { key: "installationTab", label: "설치 제품" },
] as const;
export type MerchantDetailFieldKey =
  (typeof MERCHANT_DETAIL_FIELDS)[number]["key"];
export const DEFAULT_MERCHANT_DETAIL_FIELDS: MerchantDetailFieldKey[] =
  MERCHANT_DETAIL_FIELDS.map((item) => item.key);

export const MERCHANT_DETAIL_BILLING_COLUMNS = [
  { key: "billingMonth", label: "청구월" },
  { key: "payerNumber", label: "납부자번호" },
  { key: "label", label: "구분" },
  { key: "expectedAmount", label: "예정 공급가액" },
  { key: "paidAmount", label: "납부 공급가액" },
  { key: "vat", label: "VAT" },
  { key: "paymentDate", label: "납부일자" },
  { key: "status", label: "상태" },
] as const;
export type MerchantDetailBillingColumnKey =
  (typeof MERCHANT_DETAIL_BILLING_COLUMNS)[number]["key"];
export const DEFAULT_MERCHANT_DETAIL_BILLING_COLUMNS: MerchantDetailBillingColumnKey[] =
  MERCHANT_DETAIL_BILLING_COLUMNS.map((item) => item.key);

export const MERCHANT_DETAIL_PAYER_COLUMNS = [
  { key: "payerNumber", label: "납부자번호" },
  { key: "label", label: "구분명" },
  { key: "billingType", label: "청구 유형" },
  { key: "monthlyCharge", label: "월 공급가액" },
  { key: "billingPeriod", label: "청구 기간" },
] as const;
export type MerchantDetailPayerColumnKey =
  (typeof MERCHANT_DETAIL_PAYER_COLUMNS)[number]["key"];
export const DEFAULT_MERCHANT_DETAIL_PAYER_COLUMNS: MerchantDetailPayerColumnKey[] =
  MERCHANT_DETAIL_PAYER_COLUMNS.map((item) => item.key);

export const MERCHANT_DETAIL_INSTALLATION_COLUMNS = [
  { key: "installDate", label: "설치일" },
  { key: "caseNumber", label: "문의번호" },
  { key: "productName", label: "모델명" },
  { key: "van", label: "VAN" },
  { key: "condition", label: "유형" },
  { key: "contractTermMonths", label: "약정개월" },
  { key: "transactionClassification", label: "거래구분" },
  { key: "quantity", label: "수량" },
  { key: "salesAmount", label: "판매 공급가액" },
  { key: "unitCost", label: "원가 단가" },
  { key: "costTotal", label: "원가 합계" },
  { key: "fixing", label: "대금책정" },
  { key: "incentive", label: "영업수수료" },
  { key: "actualRevenue", label: "실제수익" },
] as const;
export type MerchantDetailInstallationColumnKey =
  (typeof MERCHANT_DETAIL_INSTALLATION_COLUMNS)[number]["key"];
export const DEFAULT_MERCHANT_DETAIL_INSTALLATION_COLUMNS: MerchantDetailInstallationColumnKey[] =
  MERCHANT_DETAIL_INSTALLATION_COLUMNS.map((item) => item.key);

function visibleKeys<T extends string>(
  stored: string | null | undefined,
  options: readonly { key: T }[],
  defaults: readonly T[],
) {
  if (!stored) return [...defaults];
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [...defaults];
    const allowed = new Set(options.map((item) => item.key));
    const keys = parsed.filter(
      (value): value is T => typeof value === "string" && allowed.has(value as T),
    );
    return keys;
  } catch {
    return [...defaults];
  }
}

export function settlementListColumnsFor(
  dealer?: Pick<Dealer, "settlementListColumns"> | null,
) {
  return visibleKeys(
    dealer?.settlementListColumns,
    SETTLEMENT_LIST_COLUMNS,
    DEFAULT_SETTLEMENT_LIST_COLUMNS,
  );
}

export function merchantListColumnsFor(
  dealer?: Pick<Dealer, "merchantListColumns"> | null,
) {
  return visibleKeys(
    dealer?.merchantListColumns,
    MERCHANT_LIST_COLUMNS,
    DEFAULT_MERCHANT_LIST_COLUMNS,
  );
}

export function mainSummaryCardsFor(
  dealer?: Pick<Dealer, "mainSummaryCards" | "advanceEnabled" | "vanSettlementEnabled"> | null,
) {
  const cards = visibleKeys(
    dealer?.mainSummaryCards,
    MAIN_SUMMARY_CARDS,
    DEFAULT_MAIN_SUMMARY_CARDS,
  );
  return cards.filter(
    (key) =>
      (key !== "advanceDeduction" || dealer?.advanceEnabled === true) &&
      (key !== "vanFeeRevenue" || dealer?.vanSettlementEnabled !== false),
  );
}

export function merchantDetailFieldsFor(
  dealer?: Pick<Dealer, "merchantDetailFields"> | null,
) {
  return visibleKeys(
    dealer?.merchantDetailFields,
    MERCHANT_DETAIL_FIELDS,
    DEFAULT_MERCHANT_DETAIL_FIELDS,
  );
}

export function merchantDetailBillingColumnsFor(
  dealer?: Pick<Dealer, "merchantDetailBillingColumns"> | null,
) {
  return visibleKeys(
    dealer?.merchantDetailBillingColumns,
    MERCHANT_DETAIL_BILLING_COLUMNS,
    DEFAULT_MERCHANT_DETAIL_BILLING_COLUMNS,
  );
}

export function merchantDetailPayerColumnsFor(
  dealer?: Pick<Dealer, "merchantDetailPayerColumns"> | null,
) {
  return visibleKeys(
    dealer?.merchantDetailPayerColumns,
    MERCHANT_DETAIL_PAYER_COLUMNS,
    DEFAULT_MERCHANT_DETAIL_PAYER_COLUMNS,
  );
}

export function merchantDetailInstallationColumnsFor(
  dealer?: Pick<Dealer, "merchantDetailInstallationColumns"> | null,
) {
  return visibleKeys(
    dealer?.merchantDetailInstallationColumns,
    MERCHANT_DETAIL_INSTALLATION_COLUMNS,
    DEFAULT_MERCHANT_DETAIL_INSTALLATION_COLUMNS,
  );
}
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function monthsBetween(start: string, end: string) {
  const rows: string[] = [];
  const [startYear, startMonth] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  const current = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const last = new Date(Date.UTC(endYear, endMonth - 1, 1));
  while (current <= last && rows.length < 120) {
    rows.push(
      `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}`,
    );
    current.setUTCMonth(current.getUTCMonth() + 1);
  }
  return rows;
}

export function monthRangeFrom(values: Array<string | null | undefined>) {
  const months = values
    .map((value) => String(value ?? "").slice(0, 7))
    .filter((value) => MONTH_PATTERN.test(value))
    .sort();
  const currentMonth = new Date().toISOString().slice(0, 7);
  return {
    start: months[0] ?? `${currentMonth.slice(0, 4)}-01`,
    end: months[months.length - 1] ?? currentMonth,
  };
}

export function payerActiveInMonth(payer: PayerAccount, month: string) {
  return (
    payer.active &&
    MONTH_PATTERN.test(payer.startMonth) &&
    payer.startMonth <= month &&
    (!payer.endMonth || payer.endMonth >= month)
  );
}
