import test from 'node:test';
import assert from 'node:assert/strict';
import { searchMerchants, installationDetails, normalizeDashboard } from '../src/data.ts';
import { fixture, testEnv, identity } from './fixture.mjs';
import { createServer } from '../src/server.ts';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';

test('merchant Y filtering uses effective override, deduplicates merchants and pages across dealers',async()=>{
 const data=fixture();
 data.merchants.push({...data.merchants[0],id:2,name:'일반'}, {...data.merchants[0],id:3,name:'수동 Y'});
 data.installations=[{...data.installations[0],isFromAsset:true}, {...data.installations[0],id:2,isFromAsset:true},
 {...data.installations[0],id:3,merchantId:2,isFromAsset:true,isFromAssetOverride:false},
 {...data.installations[0],id:4,merchantId:3,isFromAsset:false,isFromAssetOverride:true}];
 const {DB}=testEnv(data);
 const first=await searchMerchants(DB,'',undefined,0,1,'Y');
 assert.equal(first.rows[0].id,1);assert.equal(first.rows[0].ownershipTransfer,'Y');assert.equal(first.rows[0].ownershipTransferInstallationCount,2);assert.equal(first.nextOffset,1);
 const next=await searchMerchants(DB,'',1,1,1,'Y');assert.equal(next.rows[0].id,3);assert.equal(next.nextOffset,null);
 const ordinary=await searchMerchants(DB,'',1,0,20,'N');assert.deepEqual(ordinary.rows.map(x=>x.id),[2]);
 assert.equal((await searchMerchants(DB,'%',undefined,0,20)).rows.length,0);
 assert.equal((await searchMerchants(DB,'수동',1,0,20,'Y')).rows[0].id,3);
});
test('installation detail shows site asset status, transfer source and zero excluded cost',()=>{
 const data=fixture();data.installations[0]={...data.installations[0],isFromAsset:true,assetLifecycleOverride:'transferred'};
 const normalized=normalizeDashboard(data),row=installationDetails(normalized,normalized.installations[0]);
 assert.equal(row.ownershipTransfer,'Y');assert.equal(row.assetStatus,'명변됨');assert.equal(row.costExcluded,true);assert.equal(row.unitCostSnapshot,0);
 data.installations[0].isFromAssetOverride=false;
 assert.equal(installationDetails(normalizeDashboard(data),data.installations[0]).ownershipTransfer,'N');
});
test('MCP transfer filter and merchant details return all history and enforce dealer ownership',async()=>{
 const data=fixture();data.installations[0]={...data.installations[0],isFromAsset:true,contractInstallAt:'2025-01-01'};
 data.dealers.push({...data.dealers[0],id:2,name:'다른 딜러'});
 const env=testEnv(data),server=createServer(env,identity),transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
 await server.connect(transport);let id=0;
 const rpc=async(method,params)=> (await transport.handleRequest(new Request('https://mcp.example.test/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})}))).json();
 try {
 await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}});
 const call=async(name,args)=>(await rpc('tools/call',{name,arguments:args})).result;
 const found=await call('find_merchants',{ownershipTransfer:'Y'});assert.equal(found.structuredContent.rows[0].ownershipTransfer,'Y');
 const detail=await call('get_merchant_details',{merchantId:1});assert.equal(detail.structuredContent.rows[0].contractInstallAt,'2025-01-01');assert.equal(detail.structuredContent.rows[0].ownershipTransfer,'Y');
 const payer=await call('get_merchant_details',{merchantId:1,section:'payerAccounts'});assert.equal(payer.structuredContent.rows[0].payerNumber,'1000050871');
 const denied=await call('get_merchant_details',{merchantId:1,dealer:2});assert.equal(denied.isError,true);
 env.DB.sqlite.prepare('UPDATE dealer_members SET active=0').run();
 const blocked=await rpc('tools/call',{name:'get_merchant_details',arguments:{merchantId:1}});assert.ok(blocked.error||blocked.result?.isError);
 }finally{await server.close();}
});
