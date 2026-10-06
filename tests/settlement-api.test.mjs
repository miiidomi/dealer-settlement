import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
const root=fileURLToPath(new URL('..',import.meta.url));
const vite=await createServer({appType:'custom',configFile:false,root,
  resolve:{alias:{'@':root}},server:{middlewareMode:true,hmr:false},plugins:[{
    name:'settlement-test-boundaries', enforce:'pre',
    resolveId(source,importer) {
      if(source==='cloudflare:workers') return '\0test-worker';
      if(source==='../access' && importer?.endsWith('/app/api/dashboard/route.ts'))return '\0test-access';
    },
    load(id) {
      if(id==='\0test-worker')return 'export const env = globalThis.__settlementTest.env;';
      if(id==='\0test-access')return `export class AccessError extends Error { constructor(status,message){super(message);this.status=status;} }
        export async function requireAppAccess(){return globalThis.__settlementTest.access;}
        export function assertAdmin(access){if(access.role!=='admin')throw new AccessError(403,'관리자만 변경할 수 있습니다.');}
        export async function requireMerchantAccess(){throw new AccessError(403,'test');}`;
    }
  }]});
after(()=>vite.close());
let sqlDb;
const binding={
  prepare(sql){return {
    sql,args:[],bind(...args){return {...this,args};},
    async run(){const r=sqlDb.prepare(this.sql).run(...this.args);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};},
    async all(){return {success:true,results:sqlDb.prepare(this.sql).all(...this.args).map(row=>({...row})),meta:{}};},
    async raw(options){const statement=sqlDb.prepare(this.sql),names=statement.columns().map(c=>c.name);
      const rows=statement.all(...this.args).map(row=>names.map(n=>row[n]));return options?.columnNames?[names,...rows]:rows;},
    async first(column){const row=sqlDb.prepare(this.sql).get(...this.args);return column?row?.[column]??null:row??null;},
  };},
  async batch(statements){
    if(this.beforeBatch){const action=this.beforeBatch;this.beforeBatch=null;action();}
    sqlDb.exec('BEGIN');
    try{const out=[];for(const statement of statements)out.push(/^(UPDATE|INSERT|DELETE)/i.test(statement.sql.trim())?await statement.run():await statement.all());sqlDb.exec('COMMIT');return out;}
    catch(error){sqlDb.exec('ROLLBACK');throw error;}
  }
};
globalThis.__settlementTest={env:{DB:binding},access:{userId:'test-admin',email:'test@example.test',displayName:'테스트',role:'admin',dealerId:null}};
const route=await vite.ssrLoadModule('/app/api/dashboard/route.ts');
const {captureSettlementSnapshot:capture,settlementCalculationKey:key,settlementCheck:check}=await vite.ssrLoadModule('/app/settlement-snapshot.ts');
function fixture(){
  sqlDb?.close();sqlDb=new DatabaseSync(':memory:');binding.beforeBatch=null;
  for(const name of readdirSync(root+'/drizzle').filter(n=>n.endsWith('.sql')).sort())sqlDb.exec(readFileSync(root+'/drizzle/'+name,'utf8'));
  sqlDb.exec(`INSERT INTO dealers (id,name,advance_enabled) VALUES (1,'테스트 딜러',1);
    INSERT INTO dealer_rules (dealer_id,effective_from,cost_share_rate,profit_share_rate) VALUES (1,'2025-01-01',50,50);
    INSERT INTO products (id,name,category) VALUES (1,'테스트 제품','포스');
    INSERT INTO product_costs (id,product_id,unit_cost,condition,effective_from) VALUES (1,1,50000,'신품','2025-01-01');
    INSERT INTO merchants (id,name,business_number,dealer_id,install_date) VALUES (1,'테스트 가맹점','TEST-001',1,'2026-09-10');
    INSERT INTO installations (id,merchant_id,product_id,quantity,unit_cost_snapshot,contract_install_at,condition,source,transaction_classification) VALUES (1,1,1,1,50000,'2026-09-10','신품','manual','임대');
    INSERT INTO payer_accounts (id,merchant_id,payer_number,monthly_charge,start_month) VALUES (1,1,'TEST-PAYER',100000,'2026-09');
    INSERT INTO payments (id,payer_account_id,merchant_id,billing_month,payment_date,gross_amount,supply_amount,vat_amount,source_file,external_key,created_at) VALUES (1,1,1,'2026-09','2026-09-20',110000,100000,10000,'test-fixture.xlsx','test-001','2026-09-20');`);
  globalThis.__settlementTest.access.role='admin';
}
after(()=>sqlDb?.close());
const getData=async()=>{const response=await route.GET();const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
async function post(body){const response=await route.POST(new Request('https://test.example/api/dashboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));return {status:response.status,data:await response.json()};}
const saveBody=(data,extra={})=>({action:'saveMonthlySettlementStatus',dealerId:1,settlementMonth:'2026-09',paid:true,
  expectedUpdatedAt:data.monthlySettlementStatuses[0]?.updatedAt??null,
  expectedCalculationKey:key(capture(data,1,'2026-09','')), ...extra});
test('administrator can register, list and update a viewer without assigning a dealer',async()=>{
  fixture();
  let response=await post({action:'saveMember',email:'Reader@Example.test',role:'viewer',dealerId:1});
  assert.equal(response.status,201,JSON.stringify(response.data));
  let member=response.data.members.find(member=>member.email==='reader@example.test');
  assert.ok(member);assert.equal(member.role,'viewer');assert.equal(member.dealerId,null);
  const memberId=member.id;
  response=await post({action:'saveMember',memberId,role:'dealer',dealerId:1});
  assert.equal(response.status,201);assert.equal(response.data.members.find(member=>member.id===memberId).dealerId,1);
  response=await post({action:'saveMember',memberId,role:'viewer',dealerId:1});
  assert.equal(response.status,201);member=response.data.members.find(member=>member.id===memberId);
  assert.equal(member.role,'viewer');assert.equal(member.dealerId,null);
  assert.equal((await post({action:'saveMember',email:'READER@example.test',role:'viewer'})).status,400);
  assert.equal((await post({action:'saveMember',email:'other@example.test',role:'owner'})).status,400);
  globalThis.__settlementTest.access.role='viewer';
  assert.equal((await post({action:'saveMember',memberId,role:'admin'})).status,403);
});
test('adding viewer role does not allow demoting the current or final administrator',async()=>{
  fixture();
  sqlDb.exec("INSERT INTO dealer_members (id,user_id,email,role) VALUES (1,'test-admin','test@example.test','admin')");
  assert.equal((await post({action:'saveMember',memberId:1,role:'viewer'})).status,400);
  sqlDb.exec("UPDATE dealer_members SET user_id='other-admin',email='other@example.test'");
  assert.equal((await post({action:'saveMember',memberId:1,role:'viewer'})).status,400);
  assert.equal(sqlDb.prepare('SELECT role FROM dealer_members WHERE id=1').get().role,'admin');
});
test('API saves the server-calculated amount, detects repricing, preserves it during metadata edits and acknowledgment',async()=>{
  fixture();const before=await getData();
  let response=await post(saveBody(before));assert.equal(response.status,201);
  const original=response.data.monthlySettlementStatuses[0].paidSnapshot;
  assert.equal(JSON.parse(original).totals.finalSettlement,27500);
  assert.equal(check(response.data.monthlySettlementStatuses[0],capture(response.data,1,'2026-09','')).state,'unchanged');
  response=await post({action:'updateCost',costId:1,productId:1,unitCost:70000,condition:'신품',effectiveFrom:'2025-01-01'});
  assert.equal(response.status,201);
  assert.equal(check(response.data.monthlySettlementStatuses[0],capture(response.data,1,'2026-09','')).difference,-11000);
  response=await post(saveBody(response.data,{memo:'메모만 수정',settlementDate:'2026-10-06'}));assert.equal(response.status,201);
  assert.equal(response.data.monthlySettlementStatuses[0].paidSnapshot,original);
  const status=response.data.monthlySettlementStatuses[0];
  response=await post({action:'acknowledgeSettlementChanges',dealerId:1,settlementMonth:'2026-09',expectedUpdatedAt:status.updatedAt,
    expectedCalculationKey:key(capture(response.data,1,'2026-09',''))});assert.equal(response.status,201);
  assert.equal(response.data.monthlySettlementStatuses[0].paidSnapshot,original);
  assert.equal(check(response.data.monthlySettlementStatuses[0],capture(response.data,1,'2026-09','')).state,'unchanged');
});
test('stale calculation and stale status are rejected instead of silently saving a different baseline',async()=>{
  fixture();const before=await getData();
  sqlDb.exec('UPDATE product_costs SET unit_cost=70000');
  assert.equal((await post(saveBody(before))).status,409);
  assert.equal(sqlDb.prepare('SELECT COUNT(*) AS n FROM monthly_settlement_statuses').get().n,0);
  const current=await getData();assert.equal((await post(saveBody(current))).status,201);
  assert.equal((await post(saveBody(current))).status,409);
});
test('older paid records get an explicitly marked current baseline only on administrator request',async()=>{
  fixture();sqlDb.exec(`INSERT INTO monthly_settlement_statuses (dealer_id,settlement_month,paid,created_at,updated_at) VALUES (1,'2026-09',1,'old','old');`);
  let data=await getData();assert.equal(check(data.monthlySettlementStatuses[0],capture(data,1,'2026-09','')).state,'missing');
  const response=await post({action:'acknowledgeSettlementChanges',dealerId:1,settlementMonth:'2026-09',expectedUpdatedAt:'old',expectedCalculationKey:key(capture(data,1,'2026-09',''))});
  assert.equal(response.status,201);assert.equal(JSON.parse(response.data.monthlySettlementStatuses[0].paidSnapshot).kind,'legacy');
});
test('dealer and viewer accounts cannot record or acknowledge payment snapshots',async()=>{
  fixture();const data=await getData();
  for(const role of ['dealer','viewer']){globalThis.__settlementTest.access.role=role;
    assert.equal((await post(saveBody(data))).status,403);
    assert.equal((await post({action:'acknowledgeSettlementChanges',dealerId:1,settlementMonth:'2026-09'})).status,403);
  }
});
test('lost status lease does not allocate installment components or overwrite the competing status',async()=>{
  fixture();sqlDb.exec(`UPDATE installations SET transaction_classification='할부구매',fixing=100000,fixing_payment_status='입금완료',fixing_payment_date='2026-09-10';
    INSERT INTO monthly_settlement_statuses (dealer_id,settlement_month,paid,created_at,updated_at) VALUES (1,'2026-09',0,'old','old');`);
  const data=await getData();binding.beforeBatch=()=>sqlDb.exec("UPDATE monthly_settlement_statuses SET updated_at='other-admin'");
  const response=await post(saveBody(data));assert.equal(response.status,409);
  assert.equal(sqlDb.prepare('SELECT fixing_settlement_month AS value FROM installations WHERE id=1').get().value,null);
  assert.equal(sqlDb.prepare('SELECT paid_snapshot AS value FROM monthly_settlement_statuses').get().value,null);
});

test('payment allocation and the stored installment baseline agree, and metadata edits do not allocate later components',async()=>{
  fixture();sqlDb.exec(`UPDATE installations SET transaction_classification='할부구매',fixing=100000,fixing_payment_status='입금완료',fixing_payment_date='2026-09-10';`);
  const before=await getData(), preview=capture(before,1,'2026-09','');
  let response=await post(saveBody(before));assert.equal(response.status,201);
  const original=response.data.monthlySettlementStatuses[0].paidSnapshot;
  assert.equal(response.data.installations[0].fixingSettlementMonth,'2026-09');
  assert.equal(JSON.parse(original).totals.finalSettlement,preview.totals.finalSettlement);
  assert.equal(check(response.data.monthlySettlementStatuses[0],capture(response.data,1,'2026-09','')).state,'unchanged');
  sqlDb.exec(`UPDATE installations SET incentive=10000,incentive_payment_status='입금완료',incentive_payment_date='2026-09-15';`);
  const changed=await getData();response=await post(saveBody(changed,{memo:'날짜/메모만 수정'}));assert.equal(response.status,201);
  assert.equal(response.data.monthlySettlementStatuses[0].paidSnapshot,original);
  assert.equal(response.data.installations[0].incentiveSettlementMonth,null);
  assert.equal(check(response.data.monthlySettlementStatuses[0],capture(response.data,1,'2026-09','')).state,'changed');
});
