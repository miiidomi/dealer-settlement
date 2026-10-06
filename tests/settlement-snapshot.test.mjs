import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const root = fileURLToPath(new URL('..',import.meta.url));
const vite = await createServer({ appType:'custom',configFile:false,root,
  resolve:{alias:{'@':root}},server:{middlewareMode:true,hmr:false} });
after(() => vite.close());
const { captureSettlementSnapshot:capture, settlementCheck:check, settlementCalculationKey:key,
  projectInstallmentSettlement:project, parseSettlementSnapshot:parse } = await vite.ssrLoadModule('/app/settlement-snapshot.ts');
const { createSettlementCalculator:calculator } = await vite.ssrLoadModule('/app/settlement-calculation.ts');
const { SettlementStatusBadge } = await vite.ssrLoadModule('/app/settlement-change.tsx');
const month = '2026-09', date='2026-10-06T05:00:00.000Z';
function fixture() {
  return { access:{role:'admin'},dealers:[{id:1,flatCommissionEnabled:false,vanSettlementEnabled:true,penaltySettlementEnabled:true}],
    rules:[{id:1,dealerId:1,effectiveFrom:'2025-01-01',costShareRate:50,profitShareRate:50}],
    merchants:[{id:1,dealerId:1,name:'테스트 가맹점'}],products:[{id:1,name:'테스트 제품',category:'포스'}],
    installations:[{id:1,merchantId:1,productId:1,quantity:1,unitCostSnapshot:50000,condition:'신품',
      transactionClassification:'임대',contractInstallAt:'2026-09-10',fixing:0,incentive:0,fixingSettlementMonth:null,
      incentiveSettlementMonth:null,fixingPaymentStatus:null,incentivePaymentStatus:null,salesAmount:100000,contractTermMonths:36}],
    payerAccounts:[{id:1,merchantId:1,billingType:'rental',active:true,startMonth:month,endMonth:null,monthlyCharge:100000}],
    payments:[{id:1,merchantId:1,payerAccountId:1,paymentDate:'2026-09-20',billingMonth:month,supplyAmount:100000,vatAmount:10000}],
    costs:[],dealerProductCosts:[],dealerCategoryCosts:[],dealerCommissionRules:[],cancellationPenalties:[],
    advancePayments:[],vanSettlements:[],monthlySettlementStatuses:[],billings:[],members:[] };
}
const statusFor = original => ({dealerId:1,settlementMonth:month,paid:true,paidSnapshot:JSON.stringify(original),reviewedSnapshot:null});

test('payment snapshot remains immutable and detects cost changes with the correct VAT-inclusive difference', () => {
  const data=fixture(), original=capture(data,1,month,date), status=statusFor(original);
  assert.equal(original.totals.finalSettlement,27500);
  assert.equal(check(status,capture(data,1,month,date)).state,'unchanged');
  data.installations[0].unitCostSnapshot=70000;
  const result=check(status,capture(data,1,month,date));
  assert.equal(result.state,'changed');assert.equal(result.difference,-11000);
  assert.equal(JSON.parse(status.paidSnapshot).totals.finalSettlement,27500);
  assert.ok(result.differences.some(row=>row.field==='단위 원가' && row.before===50000 && row.after===70000));
});
test('offsetting costs still trigger a detail-change alert even when the total is unchanged', () => {
  const data=fixture();data.installations.push({...data.installations[0],id:2,unitCostSnapshot:70000});
  const status=statusFor(capture(data,1,month,date));
  data.installations[0].unitCostSnapshot=70000;data.installations[1].unitCostSnapshot=50000;
  const result=check(status,capture(data,1,month,date));
  assert.equal(result.state,'changed');assert.equal(result.difference,0);assert.ok(result.differences.length>=2);
});
test('review clears the current alert, preserves the payment baseline, and a later change or reversion alerts again', () => {
  const data=fixture(), status=statusFor(capture(data,1,month,date));
  data.installations[0].unitCostSnapshot=70000;
  status.reviewedSnapshot=JSON.stringify(capture(data,1,month,date,'review'));
  assert.equal(check(status,capture(data,1,month,date)).state,'unchanged');
  assert.equal(check(status,capture(data,1,month,date)).difference,-11000);
  data.installations[0].unitCostSnapshot=50000;
  const reverted=check(status,capture(data,1,month,date));
  assert.equal(reverted.state,'changed');assert.equal(reverted.difference,0);
  assert.ok(reverted.differences.some(row=>row.field==='단위 원가' && row.before===70000));
});
test('other dealers, irrelevant months, display renames and query order do not create false alerts', () => {
  const data=fixture(), original=capture(data,1,month,date);
  data.merchants.push({id:2,dealerId:2,name:'다른 딜러'});
  data.installations.push({...data.installations[0],id:2,merchantId:2,unitCostSnapshot:999999});
  data.installations.push({...data.installations[0],id:3,contractInstallAt:'2026-10-01'});
  data.products[0].name='표시 이름 수정';data.merchants[0].name='가맹점 표시 수정';data.installations.reverse();
  assert.equal(key(original),key(capture(data,1,month,date)));
  data.installations=data.installations.filter(row=>row.id!==1);
  assert.equal(check(statusFor(original),capture(data,1,month,date)).state,'changed');
});
test('missing, corrupt and wrong-dealer baselines are never interpreted as historical payment amounts', () => {
  const current=capture(fixture(),1,month,date);
  for(const paidSnapshot of [null,'{}','broken',JSON.stringify({...current,dealerId:2}),JSON.stringify({...current,capturedAt:'invalid-date'})])
    assert.equal(check({...statusFor(current),paidSnapshot},current).state,'missing');
  assert.equal(parse(JSON.stringify({...current,totals:{}})),null);
  assert.equal(check({...statusFor(current),paid:false},current).state,'unpaid');
});
test('installment allocation is idempotent and does not alter same-month payment totals', () => {
  const data=fixture();data.installations[0]={...data.installations[0],transactionClassification:'할부구매',
    fixing:100000,fixingPaymentStatus:'입금완료',fixingPaymentDate:'2026-09-10'};
  const before=calculator(data,1).metricsFor(month,month);
  const allocated=project(data,1,month),after=calculator(allocated,1).metricsFor(month,month);
  assert.equal(allocated.installations[0].fixingSettlementMonth,month);
  assert.equal(after.finalSettlement,before.finalSettlement);
  assert.deepEqual(project(allocated,1,month),allocated);
  const saved=capture(allocated,1,month,date);
  assert.equal(check(statusFor(saved),capture(allocated,1,month,date)).state,'unchanged');
});
test('flat commissions, disabled VAN and payment-month penalties retain their existing calculation rules', () => {
  const data=fixture();data.dealers[0].flatCommissionEnabled=true;data.dealers[0].vanSettlementEnabled=false;
  data.dealerCommissionRules=[{id:1,dealerId:1,targetType:'product',productId:1,productCategory:'포스',condition:'신품',rentalAmount:100000,contractTermMonths:36,effectiveFrom:'2025-01-01',commissionAmount:30000}];
  data.vanSettlements=[{id:1,dealerId:1,settlementMonth:month,vanFee:999999}];
  data.cancellationPenalties=[{salesforceCaseId:'test-case',id:1,dealerId:1,merchantId:1,status:'해지완료',amount:10000,paymentDate:'2026-09-12'}];
  const result=capture(data,1,month,date);
  assert.equal(result.totals.dealerCost,0);assert.equal(result.totals.dealerProfit,35000);
  assert.equal(result.totals.finalSettlement,38500);assert.equal(result.totals.vanFeeRevenue,0);
});
test('payment status visibly distinguishes changes, unregistered baselines and unpaid months', () => {
  const data=fixture(),current=capture(data,1,month,date),status=statusFor(current);
  data.installations[0].unitCostSnapshot=70000;
  const html=renderToStaticMarkup(React.createElement(SettlementStatusBadge,{paid:true,check:check(status,capture(data,1,month,date))}));
  assert.match(html,/지급완료 · 재확인 필요/);
  assert.match(renderToStaticMarkup(React.createElement(SettlementStatusBadge,{paid:true,check:check({...status,paidSnapshot:null},current)})),/기준금액 미등록/);
  assert.match(renderToStaticMarkup(React.createElement(SettlementStatusBadge,{paid:false})),/미지급/);
});
