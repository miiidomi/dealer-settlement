import type { PayerAccount, Payment } from "./types";

/** The status column checks only the billing month preceding the selected end month. */
export function merchantPaymentStatus(
  merchantId: number,
  selectedEndMonth: string,
  payers: PayerAccount[],
  payments: Payment[],
) {
  const [year, month] = selectedEndMonth.split("-").map(Number);
  const billingMonth = new Date(Date.UTC(year, month - 2, 1))
    .toISOString().slice(0, 7);
  const eligiblePayers = payers.filter(payer =>
    payer.merchantId === merchantId && payer.billingType !== "installment" &&
    payer.active && payer.startMonth <= billingMonth &&
    (!payer.endMonth || payer.endMonth >= billingMonth) && payer.monthlyCharge > 0,
  );
  let expected = 0;
  let unpaid = 0;
  for (const payer of eligiblePayers) {
    const paid = payments.filter(payment =>
      payment.merchantId === merchantId && payment.payerAccountId === payer.id &&
      payment.billingMonth === billingMonth,
    ).reduce((sum, payment) => sum + payment.supplyAmount, 0);
    expected += payer.monthlyCharge;
    unpaid += Math.max(0, payer.monthlyCharge - paid);
  }
  return {
    billingMonth,
    expected,
    unpaid,
    status: expected === 0 ? "없음" : unpaid > 0 ? "미납" : "납부완료",
  };
}
