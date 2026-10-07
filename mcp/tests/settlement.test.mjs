import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, testEnv, identity, month } from './fixture.mjs';
import { validateAdmin, validateRange, assertBrowserOrigin } from '../src/policy.ts';
import { normalizeDashboard, costOrigin, loadDashboard, searchMerchants } from '../src/data.ts';
import { settlementSummary, settlementIssues, calculationWarnings, explanationRows, paidChanges } from '../src/settlement.ts';
import { captureSettlementSnapshot } from '../../app/settlement-snapshot.ts';
import { createSettlementCalculator } from '../../app/settlement-calculation.ts';

test('inactive, dealer, duplicate and replaced members cannot gain administrator access',()=>{
  const row={id:1,email:' Admin@Example.Test ',role:'admin',active:1};
  assert.equal(validateAdmin([row],identity.email,1).memberId,1);
  for(const rows of [[],[{...row,active:0}],[{...row,role:'dealer'}],[row,row],[{...row,id:2}]])
    assert.throws(()=>validateAdmin(rows,identity.email,1));
});
test('invalid dates, reversed periods, more than 12 months and untrusted origins fail',()=>{
  assert.deepEqual(validateRange('2026-01','2026-12'),{start:'2026-01',end:'2026-12'});
  for(const [a,b] of [['2026-13',month],[month,'2026-08'],['2025-09',month],['2026-9',month]]) assert.throws(()=>validateRange(a,b));
  assert.throws(()=>assertBrowserOrigin(new Request('https://mcp.example.test',{headers:{origin:'https://evil.example'}}),'https://mcp.example.test'));
});
test('D1 normalization preserves real zero costs, precedence, effective date and CMS supply amount',()=>{
  const data=fixture();data.installations[0].source='salesforce';data.installations[0].lastSyncedAt=null;data.installations[0].salesAmount=110000;
  data.costs=[{productId:1,condition:'신품',effectiveFrom:'2025-01-01',unitCost:90000}];
  data.dealerCategoryCosts=[{dealerId:1,productCategory:'포스',condition:'신품',effectiveFrom:'2025-01-01',unitCost:80000}];
  data.dealerProductCosts=[{dealerId:1,productId:1,condition:'신품',effectiveFrom:'2026-10-01',unitCost:99999},{dealerId:1,productId:1,condition:'신품',effectiveFrom:'2025-01-01',unitCost:0}];
  data.payerAccounts[0].label='Salesforce CMS';data.payerAccounts[0].monthlyCharge=110000;
  const normalized=normalizeDashboard(data);
  assert.equal(normalized.installations[0].unitCostSnapshot,0);assert.equal(normalized.installations[0].unitCostRegistered,true);
  assert.equal(normalized.installations[0].salesAmount,100000);assert.equal(normalized.payerAccounts[0].monthlyCharge,100000);
  assert.equal(costOrigin(normalized,normalized.installations[0]),'딜러별 제품 원가 이력');
  assert.ok(!settlementIssues(normalized,1,month,month,testEnv()).issues.some(x=>x.code==='cost_unregistered'));
  assert.equal(data.installations[0].salesAmount,110000);
});
test('MCP SQL loader and explanation match the website amount; payment month uses payment date',async()=>{
  const env=testEnv();const data=await loadDashboard(env.DB,1,identity);
  const answer=settlementSummary(data,1,month,month,env);
  assert.equal(answer.totals.finalSettlement,27500);
  assert.equal(answer.totals.finalSettlement,createSettlementCalculator(data,1).metricsFor(month,month).finalSettlement);
  assert.equal(answer.calculationSteps.length,3);assert.match(answer.calculationBasis.payment,/납입일/);
  const rows=explanationRows(data,1,month,month,env,1);const payment=rows.find(x=>x.key==='payment:1');
  assert.equal(payment.billingMonth,'2026-08');assert.equal(payment.paymentDate,'2026-09-20');
  assert.equal(payment.fields['수익 배분율'],50);
  assert.ok(env.DB.queries.every(q=>/^SELECT/.test(q)));
});
test('LIKE wildcards and SQL-like input are literals, not extra queries',async()=>{
  const env=testEnv();assert.equal((await searchMerchants(env.DB,"%' OR 1=1 --",1,0,20)).rows.length,0);
  assert.equal((await searchMerchants(env.DB,'가맹점',1,0,20)).rows.length,1);
  assert.equal((await searchMerchants(env.DB,'%',1,0,20)).rows.length,0);
});
test('advance is deducted after VAT and cancellation penalties apply the actual 50% rule',()=>{
  const data=fixture();data.advancePayments=[{dealerId:1,settlementMonth:month,amount:5000}];
  data.cancellationPenalties=[{id:1,dealerId:1,merchantId:1,salesforceCaseId:'case-1',caseNumber:'0001',status:'해지완료',amount:20001,paymentDate:'2026-09-25'}];
  const result=settlementSummary(data,1,month,month,testEnv());
  assert.equal(result.totals.dealerProfit,60001);assert.equal(result.totals.finalSettlement,33501);
  assert.match(result.calculationBasis.penalty,/50%/);
});
test('unallocated past installments are visible as payment transition changes without altering data',()=>{
  const data=fixture();data.installations[0]={...data.installations[0],transactionClassification:'할부구매',contractInstallAt:'2026-08-01',fixing:100000,fixingPaymentStatus:'입금완료'};
  const before=JSON.stringify(data);const warnings=calculationWarnings(data,1,month,month);
  assert.ok(warnings.some(x=>x.code==='payment_transition_changes_total'&&x.impact===55000));assert.equal(JSON.stringify(data),before);
  assert.ok(explanationRows(data,1,month,month,testEnv()).some(x=>String(x.why).includes('과거 설치')));
});
test('period VAT rounding differences are disclosed with the exact impact',()=>{
  const data=fixture();data.installations=[];data.rules[0].profitShareRate=100;
  data.payments=[{...data.payments[0],supplyAmount:5,paymentDate:'2026-08-01'},{...data.payments[0],id:2,supplyAmount:5,paymentDate:'2026-09-01'}];
  assert.ok(calculationWarnings(data,1,'2026-08',month).some(x=>x.code==='period_rounding_difference'&&x.impact===-1));
});
test('missing paid snapshot cannot invent the original amount; later changes use the immutable payment snapshot',()=>{
  const data=fixture();data.monthlySettlementStatuses=[{dealerId:1,settlementMonth:month,paid:true,paidSnapshot:null}];
  assert.equal(paidChanges(data,1,month).originalAmount,null);assert.equal(paidChanges(data,1,month).state,'missing');
  data.monthlySettlementStatuses[0].paidSnapshot=JSON.stringify(captureSettlementSnapshot(data,1,month,'2026-10-06T05:00:00Z'));
  data.installations[0].unitCostSnapshot=70000;const result=paidChanges(data,1,month);
  assert.equal(result.state,'changed');assert.equal(result.differenceFromPayment,-11000);
});
test('duplicate payer numbers and disabled VAN are handled without inventing errors',()=>{
  const data=fixture();data.payerAccounts.push({...data.payerAccounts[0],id:2,payerNumber:'10000-50871'});
  const issues=settlementIssues(data,1,month,month,testEnv()).issues;
  assert.ok(issues.some(x=>x.code==='duplicate_payer'));assert.ok(!issues.some(x=>x.code==='van_data_not_recorded'));
});
