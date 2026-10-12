import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, testEnv, identity } from './fixture.mjs';
import { normalizeDashboard, loadDashboard } from '../src/data.ts';
import { paymentStatusPage } from '../src/payment-status.ts';
import { createServer } from '../src/server.ts';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
test('billing-month receipts include late payments, exclude October bills, normalize VAT, preserve partial and unpaid distinction',()=>{
 const d=fixture();d.payerAccounts[0].startMonth='2026-08';d.payerAccounts[0].label='Salesforce CMS';d.payerAccounts[0].monthlyCharge=110000;
 d.payments=[{...d.payments[0],id:1,billingMonth:'2026-08',paymentDate:'2026-10-10',supplyAmount:40000,grossAmount:44000},{...d.payments[0],id:2,billingMonth:'2026-09',supplyAmount:130000,grossAmount:143000}];
 const data=normalizeDashboard(d),env=testEnv();
 const all=paymentStatusPage(data,1,'2026-08','2026-10',{excludeMonths:['2026-10'],groupBy:'billing'},0,1,env);
 assert.equal(all.totalRows,2);assert.equal(all.nextOffset,1);assert.equal(all.totals.unpaidAmount,60000);assert.equal(all.rows[0].expectedAmount,100000);assert.equal(all.rows[0].status,'일부납부');assert.equal(all.rows[0].paidAmount,40000);
 const unpaid=paymentStatusPage(data,1,'2026-08','2026-10',{status:'미납'},0,20,env);assert.equal(unpaid.totals.unpaidAmount,100000);assert.deepEqual(unpaid.rows[0].billingMonths,['2026-10']);
 d.payerAccounts[0].active=false;assert.equal(paymentStatusPage(normalizeDashboard(d),1,'2026-08','2026-10',{},0,20,env).totalRows,0);
});
test('dealer scope, installment exclusion, MCP call and revoked admin',async()=>{
 const d=fixture();d.payerAccounts[0].startMonth='2026-08';d.merchants.push({...d.merchants[0],id:2,dealerId:2});d.payerAccounts.push({...d.payerAccounts[0],id:2,merchantId:2},{...d.payerAccounts[0],id:3,billingType:'installment'});
 const env=testEnv(d),data=await loadDashboard(env.DB,1,identity);assert.throws(()=>paymentStatusPage(data,1,'2026-08','2026-09',{merchantId:2},0,20,env),/이 딜러/);
 const server=createServer(env,identity),transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await server.connect(transport);let id=0;
 const rpc=async(method,params)=>(await transport.handleRequest(new Request('https://mcp.example.test/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})}))).json();
 try {await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}});const args={dealer:1,startMonth:'2026-08',endMonth:'2026-10',excludeMonths:['2026-10'],status:'미납'};
 const res=await rpc('tools/call',{name:'get_payment_status',arguments:args});assert.equal(res.result.structuredContent.totals.unpaidAmount,100000);assert.equal(res.result.structuredContent.totals.billingCount,1);
 env.DB.sqlite.exec('UPDATE dealer_members SET active=0');const denied=await rpc('tools/call',{name:'get_payment_status',arguments:args});assert.ok(denied.error||denied.result?.isError);
 }finally{await server.close();}
});
