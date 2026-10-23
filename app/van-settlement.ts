import type { Rule, VanSettlement } from "./types";

export const vanRuleLabel = (rule?: Rule) => rule?.vanShareRate == null
  ? "기존 수익 배분율"
  : `정액 ${Number(rule.vanFixedAmount ?? 0).toLocaleString("ko-KR")}원 + 잔여 ${rule.vanShareRate}%`;

/** Monthly payouts are additive; the approved July/August 2026 bundle belongs to August. */
export function vanSettlementBreakdown(
  months: string[], rows: VanSettlement[], ruleFor: (month: string) => Rule | undefined,
  enabled: boolean, flatCommission: boolean,
) {
  if (!enabled) return [];
  const july = ruleFor("2026-07"), august = ruleFor("2026-08");
  const combined = july?.vanShareRate != null && august?.vanShareRate != null &&
    july.vanCombineJulyAugust === true && august.vanCombineJulyAugust === true &&
    july.vanShareRate === august.vanShareRate &&
    (july.vanFixedAmount ?? 0) === (august.vanFixedAmount ?? 0);
  return months.map(month => {
    const rule = ruleFor(month);
    const configured = rule?.vanShareRate != null;
    const deferred = combined && month === "2026-07";
    const periodStart = combined && month === "2026-08" ? "2026-07" : month;
    const sourceRows = rows.filter(row => row.settlementMonth >= periodStart && row.settlementMonth <= month);
    const revenue = sourceRows.reduce((sum, row) => sum + row.vanFee, 0);
    const fixedAmount = configured && !deferred ? (rule?.vanFixedAmount ?? 0) : 0;
    const shareRate = configured ? rule!.vanShareRate! : flatCommission ? 0 : (rule?.profitShareRate ?? 0);
    const sharedBase = configured ? Math.max(0, revenue - fixedAmount) : revenue;
    const payout = deferred ? 0 : configured
      ? fixedAmount + Math.round(sharedBase * shareRate / 100)
      : sourceRows.reduce((sum, row) => sum + Math.round(row.vanFee * shareRate / 100), 0);
    return {month, periodStart, periodEnd: month, configured, deferred,
      revenue, fixedAmount, shareRate, sharedBase, payout,
      combined: combined && (month === "2026-07" || month === "2026-08"),
      sourceRows};
  });
}
