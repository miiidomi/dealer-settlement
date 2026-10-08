import { installationCostUnit } from "./asset-lifecycle";
import type { DashboardData, MonthlySettlementStatus } from "./types";
import { createSettlementCalculator } from "./settlement-calculation";
import { installmentSettledRevenueForPeriod } from "./installment-settlement";

export const SETTLEMENT_METRICS = {
  cost: "제품 원가", paymentRevenue: "납입 수익", purchaseRevenue: "구매 수익",
  installmentRevenue: "할부구매 수익", vanFeeRevenue: "VAN피 수익", penaltyRevenue: "위약금 수익",
  revenue: "총 수익", dealerCost: "딜러 원가", dealerProfit: "딜러 수익",
  advance: "선지급", settlementSupply: "정산 공급가액", settlementVat: "VAT",
  settlementWithVat: "VAT 포함 정산액", finalSettlement: "최종 정산",
} as const;
type MetricKey = keyof typeof SETTLEMENT_METRICS;
type Value = string | number | boolean | null;
export type SettlementSnapshotLine = {
  key: string; merchantName: string; label: string; fields: Record<string, Value>;
};
export type SettlementSnapshot = {
  version: 1; dealerId: number; month: string; capturedAt: string;
  kind: "payment" | "legacy" | "review";
  totals: Record<MetricKey, number>; lines: SettlementSnapshotLine[];
};

export function captureSettlementSnapshot(data: DashboardData, dealerId: number, month: string,
  capturedAt: string, kind: SettlementSnapshot["kind"] = "payment"): SettlementSnapshot {
  const calculator = createSettlementCalculator(data, dealerId);
  const metrics = calculator.metricsFor(month, month);
  const merchants = new Map(data.merchants.map(row => [row.id, row]));
  const products = new Map(data.products.map(row => [row.id, row]));
  const lines: SettlementSnapshotLine[] = [];
  const installationIds = new Set(metrics.rangeInstallations.map(row => row.id));
  const applicable = data.installations.filter(row => installationIds.has(row.id) ||
    (calculator.merchantIds.has(row.merchantId) && row.transactionClassification === "할부구매" &&
      installmentSettledRevenueForPeriod(row, month, month) !== 0));
  for (const row of applicable) {
    const currentInstallation = installationIds.has(row.id);
    const rule = calculator.ruleFor(row.contractInstallAt || month);
    const commission = calculator.commissionRuleFor(row, month);
    const flat = calculator.selectedDealer?.flatCommissionEnabled === true;
    lines.push({ key: `installation:${row.id}`, merchantName: merchants.get(row.merchantId)?.name ?? "-",
      label: `설치제품 · ${products.get(row.productId)?.name ?? "-"}`,
      fields: {
        "제품 ID": row.productId, "설치일": row.contractInstallAt, "거래유형": row.transactionClassification,
        ...(currentInstallation ? { "제품 상태": row.condition, "수량": row.quantity,
          "단위 원가": installationCostUnit(row), "제품 원가 합계": row.quantity * installationCostUnit(row),
          "원가 분담율": flat ? (row.transactionClassification === "구매" ? 100 : 0) : (rule?.costShareRate ?? 0),
          "수당": flat && !["구매", "할부구매", "무상"].includes(row.transactionClassification ?? "")
            ? (commission?.commissionAmount ?? 0) * row.quantity : 0 } : {}),
        ...(row.transactionClassification === "할부구매" ? {
          "대금책정": row.fixing, "영업수수료": row.incentive,
          "대금책정 입금상태": row.fixingPaymentStatus, "영업수수료 입금상태": row.incentivePaymentStatus,
          "대금책정 정산월": row.fixingSettlementMonth, "영업수수료 정산월": row.incentiveSettlementMonth,
        } : {}),
        "수익 배분율": flat ? 0 : (rule?.profitShareRate ?? 0),
      } });
  }
  for (const row of metrics.rangePayments) lines.push({ key: `payment:${row.id}`,
    merchantName: merchants.get(row.merchantId)?.name ?? "-", label: "납입내역",
    fields: { "납입일": row.paymentDate, "납입 공급가액": row.supplyAmount,
      "수익 배분율": calculator.selectedDealer?.flatCommissionEnabled ? 0 : (calculator.ruleFor(row.paymentDate)?.profitShareRate ?? 0) } });
  for (const row of metrics.rangeVanSettlements) lines.push({ key: `van:${row.id}`, merchantName: "딜러 공통",
    label: `VAN피 · ${row.vanCompany}`, fields: { "VAN피": row.vanFee,
      "수익 배분율": calculator.selectedDealer?.flatCommissionEnabled ? 0 : (calculator.ruleFor(row.settlementMonth)?.profitShareRate ?? 0) } });
  for (const row of metrics.rangeAdvances) lines.push({ key: `advance:${row.id}`, merchantName: "딜러 공통",
    label: "선지급", fields: { "선지급": row.amount, "정산월": row.settlementMonth } });
  for (const row of metrics.rangePenalties) lines.push({ key: `penalty:${row.salesforceCaseId}`,
    merchantName: merchants.get(row.merchantId)?.name ?? "-", label: `위약금 · ${row.caseNumber ?? "-"}`,
    fields: { "위약금": row.amount, "입금일": row.paymentDate } });
  return { version: 1, dealerId, month, capturedAt, kind,
    totals: Object.fromEntries(Object.keys(SETTLEMENT_METRICS).map(key =>
      [key, metrics[key as MetricKey]])) as SettlementSnapshot["totals"],
    lines: lines.sort((a,b) => a.key.localeCompare(b.key)) };
}

/** Excludes timestamps and display labels. Stable across row/query order changes. */
export function settlementCalculationKey(snapshot: SettlementSnapshot) {
  return JSON.stringify({ dealerId: snapshot.dealerId, month: snapshot.month,
    totals: Object.keys(SETTLEMENT_METRICS).map(key => snapshot.totals[key as MetricKey]),
    lines: snapshot.lines.map(row => ({ key: row.key,
      fields: Object.keys(row.fields).sort().map(key => [key, row.fields[key]]) }))
      .sort((a,b) => a.key.localeCompare(b.key)) });
}

export function parseSettlementSnapshot(raw: string | null | undefined): SettlementSnapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as SettlementSnapshot;
    if (value.version !== 1 || !Number.isInteger(value.dealerId) ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month) || typeof value.capturedAt !== "string" || !Number.isFinite(Date.parse(value.capturedAt)) ||
      !["payment","legacy","review"].includes(value.kind) || !Array.isArray(value.lines) ||
      !value.totals || Object.keys(SETTLEMENT_METRICS).some(key =>
        !Number.isFinite(value.totals[key as MetricKey])) ||
      value.lines.some(row => typeof row.key !== "string" || !row.fields ||
        Object.values(row.fields).some(v => typeof v === "number" && !Number.isFinite(v)))) return null;
    return value;
  } catch { return null; }
}

export function settlementDifferences(before: SettlementSnapshot, after: SettlementSnapshot) {
  const oldRows = new Map(before.lines.map(row => [row.key, row]));
  const newRows = new Map(after.lines.map(row => [row.key, row]));
  return [...new Set([...oldRows.keys(), ...newRows.keys()])].sort().flatMap(key => {
    const oldRow = oldRows.get(key), newRow = newRows.get(key), row = newRow ?? oldRow!;
    if (!oldRow || !newRow) return [{ key, merchantName: row.merchantName, label: row.label,
      field: "항목", before: oldRow ? "존재" : "없음", after: newRow ? "추가" : "삭제" }];
    return [...new Set([...Object.keys(oldRow.fields), ...Object.keys(newRow.fields)])].sort()
      .filter(field => (oldRow.fields[field] ?? null) !== (newRow.fields[field] ?? null))
      .map(field => ({ key, merchantName: row.merchantName, label: row.label, field,
        before: oldRow.fields[field] ?? null, after: newRow.fields[field] ?? null }));
  });
}

export function settlementCheck(status: MonthlySettlementStatus | undefined, current: SettlementSnapshot) {
  const original = parseSettlementSnapshot(status?.paidSnapshot);
  const reviewed = parseSettlementSnapshot(status?.reviewedSnapshot);
  const matching = (value: SettlementSnapshot | null) => value?.dealerId === current.dealerId && value.month === current.month;
  const baseline = matching(original) ? original : null;
  const comparison = matching(reviewed) ? reviewed! : baseline;
  const state = !status?.paid ? "unpaid" : !baseline ? "missing"
    : settlementCalculationKey(comparison!) !== settlementCalculationKey(current) ? "changed" : "unchanged";
  return { state, original: baseline, comparison, current,
    originalDifferences: baseline ? settlementDifferences(baseline,current) : [],
    differences: comparison ? settlementDifferences(comparison,current) : [],
    difference: baseline ? current.totals.finalSettlement - baseline.totals.finalSettlement : null };
}
export type SettlementCheck = ReturnType<typeof settlementCheck>;

/** Allocate once only on a new unpaid -> paid transition, before taking the snapshot. */
export function projectInstallmentSettlement(data: DashboardData, dealerId: number, month: string) {
  const merchantIds = new Set(data.merchants.filter(row => row.dealerId === dealerId).map(row => row.id));
  return { ...data, installations: data.installations.map(row => {
    if (!merchantIds.has(row.merchantId) || row.transactionClassification !== "할부구매" ||
      (row.contractInstallAt || "").slice(0,7) > month) return row;
    return { ...row,
      fixingSettlementMonth: row.fixing > 0 && row.fixingPaymentStatus === "입금완료" &&
        (!row.fixingPaymentDate || row.fixingPaymentDate.slice(0,7) <= month) && !row.fixingSettlementMonth
          ? month : row.fixingSettlementMonth,
      incentiveSettlementMonth: row.incentive > 0 && row.incentivePaymentStatus === "입금완료" &&
        (!row.incentivePaymentDate || row.incentivePaymentDate.slice(0,7) <= month) && !row.incentiveSettlementMonth
          ? month : row.incentiveSettlementMonth,
    };
  }) };
}

