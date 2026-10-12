import { monthsBetween, payerActiveInMonth, type DashboardData } from '../../app/types.ts';
import { AppError, siteLink, type Env } from './env.ts';

export type PaymentStatus = '미납' | '일부납부' | '완납';
export type PaymentStatusFilters = {
  merchantId?: number;
  status?: PaymentStatus | '전체';
  excludeMonths?: string[];
  groupBy?: 'merchant' | 'billing';
};

/** Same active payer and supply-amount basis as the site's billing view.
 * Match receipts by billing month, never by the month the money arrived.
 */
export function paymentStatusPage(data: DashboardData, dealerId: number, start: string, end: string,
  filters: PaymentStatusFilters, offset: number, limit: number, env: Pick<Env, 'SITE_BASE_URL'>) {
  const merchants = data.merchants.filter(m => m.dealerId === dealerId);
  if (filters.merchantId !== undefined && !merchants.some(m => m.id === filters.merchantId))
    throw new AppError(404, '이 딜러의 가맹점을 찾지 못했습니다.');
  const selected = merchants.filter(m => filters.merchantId === undefined || m.id === filters.merchantId);
  const merchantById = new Map(selected.map(m => [m.id, m]));
  const excluded = new Set(filters.excludeMonths ?? []);
  const months = monthsBetween(start, end).filter(m => !excluded.has(m));
  const paymentsByPayerMonth = new Map<string, DashboardData['payments']>();
  for (const payment of data.payments) {
    const key = `${payment.merchantId}:${payment.payerAccountId}:${payment.billingMonth}`;
    const rows = paymentsByPayerMonth.get(key) ?? [];
    rows.push(payment); paymentsByPayerMonth.set(key, rows);
  }
  const details = data.payerAccounts.filter(p => merchantById.has(p.merchantId) && p.billingType !== 'installment')
    .flatMap(payer => months.filter(month => payerActiveInMonth(payer, month)).map(month => {
      const payments = paymentsByPayerMonth.get(`${payer.merchantId}:${payer.id}:${month}`) ?? [];
      const paidAmount = payments.reduce((sum, p) => sum + p.supplyAmount, 0);
      const expectedAmount = payer.monthlyCharge;
      const unpaidAmount = Math.max(0, expectedAmount - paidAmount);
      const status: PaymentStatus = unpaidAmount === 0 ? '완납' : paidAmount > 0 ? '일부납부' : '미납';
      const merchant = merchantById.get(payer.merchantId)!;
      return {merchantId:merchant.id,merchantName:merchant.name,businessNumber:merchant.businessNumber,
        payerAccountId:payer.id,payerNumber:payer.payerNumber,billingType:payer.billingType,
        billingMonth:month,expectedAmount,paidAmount,unpaidAmount,status,
        paymentGrossAmount:payments.reduce((sum,p)=>sum+p.grossAmount,0),
        paymentDates:payments.map(p=>p.paymentDate),paymentCount:payments.length,
        siteUrl:siteLink(env,merchant.id)};
    })).filter(row => !filters.status || filters.status === '전체' || row.status === filters.status)
    .sort((a,b) => a.merchantId-b.merchantId || a.billingMonth.localeCompare(b.billingMonth) || a.payerAccountId-b.payerAccountId);
  const merchantSummaries = [...new Set(details.map(r=>r.merchantId))].map(id => {
    const rows = details.filter(r=>r.merchantId===id), first=rows[0];
    return {merchantId:id,merchantName:first.merchantName,businessNumber:first.businessNumber,
      billingMonths:[...new Set(rows.map(r=>r.billingMonth))],statuses:[...new Set(rows.map(r=>r.status))],
      billingCount:rows.length,expectedAmount:rows.reduce((s,r)=>s+r.expectedAmount,0),
      paidAmount:rows.reduce((s,r)=>s+r.paidAmount,0),unpaidAmount:rows.reduce((s,r)=>s+r.unpaidAmount,0),siteUrl:first.siteUrl};
  });
  const rows = filters.groupBy === 'billing' ? details : merchantSummaries;
  return {dealerId,period:{startMonth:start,endMonth:end,excludedMonths:[...excluded],basis:'청구월'},
    statusFilter:filters.status ?? '전체',groupBy:filters.groupBy ?? 'merchant',
    rows:rows.slice(offset,offset+limit),totalRows:rows.length,nextOffset:offset+limit<rows.length?offset+limit:null,
    totals:{merchantCount:merchantSummaries.length,billingCount:details.length,
      expectedAmount:details.reduce((s,r)=>s+r.expectedAmount,0),paidAmount:details.reduce((s,r)=>s+r.paidAmount,0),
      unpaidAmount:details.reduce((s,r)=>s+r.unpaidAmount,0)},
    amountBasis:'공급가액, 딜러 배분 전. Salesforce CMS 월청구액은 사이트와 동일하게 VAT 제외로 정규화합니다.',
    statusBasis:'청구월별 활성 납부자번호의 예정 공급가액 − 해당 납부자번호·청구월의 납부 공급가액. 잔액 0은 완납, 잔액이 있고 납부액 > 0은 일부납부, 나머지는 미납.',
    paymentBasis:'청구월로 납부액을 연결합니다. 제외한 청구월의 자료만 제외하며 다른 월에 입금된 선택 청구월의 납부액은 반영합니다.',
    totalBasis:'합계는 페이지가 아닌 필터에 일치하는 전체 청구행 기준입니다. 일부납부는 미납 필터에 포함되지 않습니다.',
    limitations:'현재 저장된 납부자 월청구액과 활성기간 기준의 예정 미납액입니다. 월청구액 변경 이력·실제 CMS 미수잔액·납기 경과 여부는 확정하지 않습니다. 할부구매 납부자번호는 제외합니다.',
    merchantsWithoutBillingPayers:selected.filter(m=>!data.payerAccounts.some(p=>p.merchantId===m.id && p.billingType!=='installment' && months.some(month=>payerActiveInMonth(p,month)))).map(m=>({merchantId:m.id,merchantName:m.name})),
    queriedAt:new Date().toISOString()};
}
