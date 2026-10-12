import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, testEnv, identity } from './fixture.mjs';
import { RECORD_SECTIONS, recordPage, savedSnapshot, syncStatus, COVERAGE } from '../src/records.ts';
import { captureSettlementSnapshot } from '../../app/settlement-snapshot.ts';
import { createServer } from '../src/server.ts';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';

test('every business table is queryable; dealer scope, raw values, pagination and unsupported filters are explicit',async()=>{
 const data=fixture();data.dealers.push({...data.dealers[0],id:2,name:'다른 딜러',bankName:'테스트은행',bankAccountNumber:'00001234'});
 data.merchants.push({...data.merchants[0],id:2,dealerId:2,name:'다른 가맹점'});
 data.installations.push({...data.installations[0],id:2,merchantId:2,isFromAsset:true});
 data.costs.push({id:1,productId:1,unitCost:0,condition:'신품',effectiveFrom:'2026-01-01'});
 data.advancePayments.push({id:1,dealerId:2,paymentDate:'2026-09-01',settlementMonth:'2026-10',amount:50000,memo:'선급금',createdAt:'2026-09-01'});
 data.monthlySettlementStatuses.push({id:1,dealerId:2,settlementMonth:'2026-09',paid:true,taxInvoiceIssuedAt:'2026-10-10',memo:'완료',paidSnapshot:'large payload',reviewedSnapshot:null});
 const {DB}=testEnv(data);DB.sqlite.exec("INSERT INTO payer_sync_controls VALUES(2,'00001',2,'deleted','2026-10-01')");
 for(const section of Object.keys(RECORD_SECTIONS)) {
  const page=await recordPage(DB,section,{},0,20);assert.ok(Array.isArray(page.rows));assert.equal(page.nextOffset,null);
 }
 const first=await recordPage(DB,'dealerSettings',{},0,1);assert.equal(first.totalRows,2);assert.equal(first.nextOffset,1);
 const settings=await recordPage(DB,'dealerSettings',{},1,1);assert.equal(settings.rows[0].bankAccountNumber,'00001234');
 const scoped=await recordPage(DB,'installations',{dealerId:2},0,20);assert.equal(scoped.totalRows,1);assert.equal(scoped.rows[0].merchantId,2);assert.equal(scoped.rows[0].ownershipTransfer,'Y');assert.equal(scoped.rows[0].productName,'테스트 제품');
 assert.equal((await recordPage(DB,'installations',{dealerId:1,merchantId:2},0,20)).totalRows,0);
 const status=await recordPage(DB,'monthlySettlementStatuses',{dealerId:2},0,20);assert.equal(status.rows[0].taxInvoiceIssuedAt,'2026-10-10');assert.equal(status.rows[0].hasPaidSnapshot,true);assert.ok(!('paidSnapshot' in status.rows[0]));
 assert.equal((await recordPage(DB,'costs',{dealerId:2,productId:1},0,20)).rows[0].unitCost,0);
 assert.equal((await recordPage(DB,'payerSyncControls',{dealerId:2},0,20)).rows[0].payerNumber,'00001');
 await assert.rejects(recordPage(DB,'advancePayments',{productId:1},0,20),/제품 필터/);
 await assert.rejects(recordPage(DB,'not_a_table; DELETE FROM dealers',{},0,20));
});
test('saved snapshots are paginated, immutable evidence, validated and never reconstructed when missing',async()=>{
 const data=fixture();const snapshot=captureSettlementSnapshot(data,1,'2026-09','2026-10-01T00:00:00Z');
 data.monthlySettlementStatuses.push({id:1,dealerId:1,settlementMonth:'2026-09',paid:true,paidSnapshot:JSON.stringify(snapshot),reviewedSnapshot:null});
 const {DB}=testEnv(data);
 const paid=await savedSnapshot(DB,1,'2026-09','paid',0,1);assert.equal(paid.totals.finalSettlement,27500);assert.equal(paid.rows.length,1);assert.equal(paid.nextOffset,1);
 assert.equal((await savedSnapshot(DB,1,'2026-09','reviewed',0,20)).status,'not_persisted');
 assert.equal((await savedSnapshot(DB,2,'2026-09','paid',0,20)).status,'not_persisted');
 DB.sqlite.prepare('UPDATE monthly_settlement_statuses SET paid_snapshot=?').run(JSON.stringify({...snapshot,dealerId:2}));
 await assert.rejects(savedSnapshot(DB,1,'2026-09','paid',0,20),/딜러·월/);
});
test('sync observations expose counts, not fabricated run history',async()=>{
 const {DB}=testEnv();const status=await syncStatus(DB,1);assert.equal(status.sources[0].total,1);assert.equal(status.sources[0].observed,1);assert.equal(status.sources[1].observed,0);
 assert.equal(status.runHistory.status,'not_persisted');assert.equal(COVERAGE.unavailable.length,3);
});
test('all new tools work through MCP and revoked administrators are denied',async()=>{
 const env=testEnv(),server=createServer(env,identity),transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await server.connect(transport);let id=0;
 const rpc=async(method,params)=>(await transport.handleRequest(new Request('https://mcp.example.test/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})}))).json();
 try {
 await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}});
 const cases=[['get_records',{section:'rules',dealer:1}],['get_settlement_snapshot',{dealer:1,month:'2026-09'}],['get_sync_status',{dealer:1}],['get_data_coverage',{}]];
 for(const [name,args] of cases){const result=await rpc('tools/call',{name,arguments:args});assert.ok(result.result.structuredContent);assert.ok(!result.result.isError);}
 env.DB.sqlite.exec('UPDATE dealer_members SET active=0');
 for(const [name,args] of cases){const result=await rpc('tools/call',{name,arguments:args});assert.ok(result.error||result.result?.isError);}
 }finally{await server.close();}
});
