/** DepositDate__c is text: accept complete dates, never infer a missing day. */
export function penaltyPaymentDate(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  const match = raw.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?$/)
    ?? raw.match(/^(\d{4})(\d{2})(\d{2})$/)
    ?? raw.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const normalized = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${normalized}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === normalized
    ? normalized : null;
}

export type PenaltyRow = {
  salesforceCaseId: string;
  merchantId: number;
  status: string;
  amount: number;
  paymentDate: string | null;
};

export function penaltySummary<T extends PenaltyRow>(rows: T[], enabled: boolean, start: string, end: string) {
  const unique = [...new Map(rows.map(row => [row.salesforceCaseId, row])).values()];
  const eligible = enabled ? unique.filter(row =>
    ["해지완료", "해지완료(미회수)"].includes(row.status) &&
    row.amount > 0 && row.paymentDate &&
    row.paymentDate.slice(0, 7) >= start && row.paymentDate.slice(0, 7) <= end,
  ) : [];
  const revenue = eligible.reduce((sum, row) => sum + row.amount, 0);
  const dealerProfit = eligible.reduce((sum, row) => sum + Math.round(row.amount * 0.5), 0);
  return { rows: eligible, revenue, dealerProfit };
}
