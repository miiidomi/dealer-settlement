import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ appType: 'custom', configFile: false, root,
  resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { lifecycleKind, latestAssetEvents, installationLifecycle, assetLifecycleLabel, installationCostUnit } = await vite.ssrLoadModule('/app/asset-lifecycle.ts');
const { createSettlementCalculator } = await vite.ssrLoadModule('/app/settlement-calculation.ts');
const transfer = (overrides = {}) => ({ Id:'transfer', Status:'종결(성공)', FirstType__c:'명의변경',
  RecordType:{DeveloperName:'BusinessInquiry'}, ClosedSuccess_Dt__c:'2026-09-01', LastModifiedDate:'2026-09-01T00:00:00Z', ...overrides });
const termination = (overrides = {}) => transfer({ Id:'termination', Status:'해지완료', FirstType__c:'일반해지',
  RecordType:{DeveloperName:'TerminationInquiry'}, ClosedDate:'2026-10-01T00:00:00Z', ...overrides });
const asset = (id, extra = {}) => ({Id:id, AccountId:'old-account', Quantity:1, EachLineItem__r:{CaseLineItem__c:'original-product'}, ...extra});
test('only successful ownership cases and the two completed termination statuses count', () => {
  assert.equal(lifecycleKind(transfer()), 'transferred');
  assert.equal(lifecycleKind(transfer({Status:'계약 및 설치'})), null);
  assert.equal(lifecycleKind(transfer({FirstType__c:'본사설치'})), null);
  assert.equal(lifecycleKind(termination()), 'terminated');
  assert.equal(lifecycleKind(termination({Status:'해지완료(미회수)'})), 'terminated');
  assert.equal(lifecycleKind(termination({Status:'진행중'})), null);
  assert.equal(lifecycleKind(transfer({RecordType:{DeveloperName:'Other'}})), null);
});
test('exact asset IDs, duplicate references, partial quantity and two different outcomes', () => {
  const events=latestAssetEvents([{assetId:'a',case:transfer()}, {assetId:'a',case:transfer()}, {assetId:'b',case:termination()}]);
  const status=installationLifecycle([asset('a'),asset('a'),asset('b'),asset('c')],events);
  assert.deepEqual(JSON.parse(status),{transferred:1,terminated:1,linked:3});
  assert.equal(assetLifecycleLabel({quantity:3,assetLifecycle:status}),'명변됨 (1/3) · 해지됨 (1/3)');
  assert.equal(assetLifecycleLabel({quantity:1,assetLifecycle:installationLifecycle([asset('a')],events)}),'명변됨');
  assert.equal(assetLifecycleLabel({quantity:1,assetLifecycle:installationLifecycle([asset('unrelated')],events)}),'-');
});
test('latest completed event wins; a reverted inquiry is removed on the next complete sync', () => {
  const events=latestAssetEvents([{assetId:'a',case:termination()}, {assetId:'a',case:transfer()}]);
  assert.equal(assetLifecycleLabel({quantity:1,assetLifecycle:installationLifecycle([asset('a')],events)}),'해지됨');
  const next=latestAssetEvents([{assetId:'a',case:termination({Status:'진행중'})}]);
  assert.equal(assetLifecycleLabel({quantity:1,assetLifecycle:installationLifecycle([asset('a')],next)}),'-');
});
test('a legacy self-reference cannot mark the incoming asset as an outgoing transfer', () => {
  const events=latestAssetEvents([{assetId:'new',case:transfer()}]);
  assert.equal(assetLifecycleLabel({quantity:1,assetLifecycle:installationLifecycle([asset('new',{Case__c:'transfer'})],events)}),'-');
});
test('mixed products exclude reused direct cost, retain shipped cost and income', () => {
  const row={id:1,merchantId:1,productId:1,quantity:2,condition:'신품',contractInstallAt:'2026-09-01',
    transactionClassification:'구매',salesAmount:100000,unitCostSnapshot:60000,unitCostOverridden:true,isFromAsset:true};
  const data={dealers:[{id:1}],merchants:[{id:1,dealerId:1}],products:[{id:1}],
    installations:[row,{...row,id:2,quantity:1,isFromAsset:false}],
    rules:[{dealerId:1,effectiveFrom:'2025-01-01',profitShareRate:50,costShareRate:50}],
    payerAccounts:[],payments:[],advancePayments:[],vanSettlements:[],cancellationPenalties:[],dealerCommissionRules:[]};
  assert.equal(installationCostUnit(row),0);
  const result=createSettlementCalculator(data,1).metricsFor('2026-09','2026-09');
  assert.equal(result.cost,60000);assert.equal(result.dealerCost,30000);assert.equal(result.purchaseRevenue,300000);
  data.dealers[0].flatCommissionEnabled=true;
  assert.equal(createSettlementCalculator(data,1).metricsFor('2026-09','2026-09').dealerCost,60000);
});
test('all migrations and real sync upsert preserve originals and overwrite reused costs with zero', () => {
  const db=new DatabaseSync(':memory:');
  const dir=new URL('../drizzle/',import.meta.url);
  for(const name of readdirSync(dir).filter(x=>x.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(name,dir),'utf8'));
  db.exec('PRAGMA foreign_keys=OFF');
  const source=readFileSync(new URL('../app/api/salesforce/sync/route.ts',import.meta.url),'utf8');
  const sql=source.match(/`(INSERT INTO installations[^`]+)`/)[1];
  const values=[1,1,2,36,60000,'line','case','123','2026-09-01','신품',null,'구매',0,0,null,null,null,null,100000,0,'{}','2026-10-08T00:00:00Z'];
  db.prepare(sql).run(...values);
  db.exec('UPDATE installations SET unit_cost_overridden=1');
  values[19]=1;values[4]=0;db.prepare(sql).run(...values);
  assert.deepEqual({...db.prepare('SELECT unit_cost_snapshot,is_from_asset FROM installations').get()},{unit_cost_snapshot:0,is_from_asset:1});
  const zeroGuard=readFileSync(new URL('../app/api/dashboard/route.ts',import.meta.url),'utf8').match(/`(UPDATE installations\s+SET unit_cost_snapshot = CASE WHEN is_from_asset = 1[^`]+)`/)[1].replaceAll('${installedAt}', 'substr(contract_install_at, 1, 10)');
  db.prepare(zeroGuard).run(1);
  assert.equal(db.prepare('SELECT unit_cost_snapshot FROM installations').get().unit_cost_snapshot,0);
  values[19]=0;values[4]=60000;db.prepare(sql).run(...values);
  assert.equal(db.prepare("SELECT unit_cost_snapshot FROM installations").get().unit_cost_snapshot,60000);
  assert.equal(db.prepare("SELECT unit_cost_overridden FROM installations").get().unit_cost_overridden,0);
  db.close();
});
