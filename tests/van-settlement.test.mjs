import assert from 'node:assert/strict';
import test from 'node:test';
import { vanSettlementBreakdown as calculate } from '../app/van-settlement.ts';
const rule={id:1,dealerId:1,effectiveFrom:'2026-07-01',profitShareRate:50,vanFixedAmount:100000,vanShareRate:50,vanCombineJulyAugust:true};
const row=(month,fee,id=1)=>({id,dealerId:1,settlementMonth:month,vanFee:fee});
const run=(months,rows,settings=rule,enabled=true,flat=false)=>calculate(months,rows,()=>settings,enabled,flat);

test('dealer-entered fixed amount and rate determine payout, with a guaranteed fixed floor',()=>{
  assert.equal(run(['2026-09'],[row('2026-09',500000)])[0].payout,300000);
  assert.equal(run(['2026-09'],[row('2026-09',70000)])[0].payout,100000);
  assert.equal(run(['2026-09'],[])[0].payout,100000);
  assert.equal(run(['2026-09'],[row('2026-09',500000)],{...rule,vanFixedAmount:80000,vanShareRate:30})[0].payout,206000);
});
test('zero fixed amount implements share-only, including zero and 100 percent',()=>{
  assert.equal(run(['2026-09'],[row('2026-09',500000)],{...rule,vanFixedAmount:0})[0].payout,250000);
  assert.equal(run(['2026-09'],[row('2026-09',500000)],{...rule,vanShareRate:0})[0].payout,100000);
  assert.equal(run(['2026-09'],[row('2026-09',500000)],{...rule,vanShareRate:100})[0].payout,500000);
});
test('July and August are combined across all VAN companies with one fixed payment in August',()=>{
  const rows=[row('2026-07',80000),row('2026-08',120000,2),row('2026-08',100000,3)];
  const [july,august]=run(['2026-07','2026-08'],rows);
  assert.equal(july.payout,0);assert.equal(july.deferred,true);
  assert.equal(august.revenue,300000);assert.equal(august.payout,200000);
  assert.equal(run(['2026-08'],rows)[0].payout,200000);
  assert.equal(july.payout+august.payout,run(['2026-08'],rows)[0].payout);
});
test('combination applies only to 2026 July/August, and can be disabled',()=>{
  assert.equal(run(['2026-07'],[],{...rule,vanCombineJulyAugust:false})[0].payout,100000);
  assert.equal(run(['2027-07'],[])[0].payout,100000);
  assert.equal(run(['2026-09'],[])[0].payout,100000);
});
test('effective settings preserve preceding months and do not combine incompatible rules',()=>{
  const rules=m=>m<'2026-08'?undefined:rule;
  const result=calculate(['2026-07','2026-08'],[row('2026-07',500000),row('2026-08',200000)],rules,true,false);
  assert.equal(result[0].payout,0);assert.equal(result[1].revenue,200000);assert.equal(result[1].payout,150000);
});
test('unconfigured legacy calculations retain per-row rounding and flat-commission exclusions',()=>{
  const legacy={...rule,vanFixedAmount:null,vanShareRate:null};
  assert.equal(run(['2026-07'],[row('2026-07',1),row('2026-07',1,2)],legacy)[0].payout,2);
  assert.equal(run(['2026-09'],[row('2026-09',100000)],legacy,true,true)[0].payout,0);
  assert.equal(run(['2026-09'],[row('2026-09',500000)],rule,true,true)[0].payout,300000);
  assert.deepEqual(run(['2026-09'],[],rule,false),[]);
});
