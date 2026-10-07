import test from 'node:test';
import assert from 'node:assert/strict';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.ts';
import { testEnv, identity } from './fixture.mjs';

test('actual MCP initialize, list, query and guidance calls work; every tool rechecks member status',async()=>{
  const env=testEnv(),server=createServer(env,identity);
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  await server.connect(transport);let id=0;
  const rpc=async(method,params)=>{
    const response=await transport.handleRequest(new Request('https://mcp.example.test/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})}));
    return response.json();
  };
  try {
    const initialized=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'integration-test',version:'1'}});
    assert.match(initialized.result.instructions,/계산 과정과 업무 배경을 숨기지/);
    const listed=await rpc('tools/list',{});assert.equal(listed.result.tools.length,9);
    assert.ok(listed.result.tools.every(t=>t.annotations.readOnlyHint&&!t.annotations.destructiveHint));
    const summary=await rpc('tools/call',{name:'get_settlement',arguments:{dealer:'테스트 딜러',startMonth:'2026-09',endMonth:'2026-09'}});
    assert.equal(summary.result.structuredContent.totals.finalSettlement,27500);
    const imports=await rpc('tools/call',{name:'get_payment_imports',arguments:{dealer:1}});
    assert.equal(imports.result.structuredContent.exceptionDetails.status,'not_persisted');
    const guide=await rpc('tools/call',{name:'guide_task',arguments:{task:'VAN등록',dealer:1,month:'2026-09'}});
    assert.equal(guide.result.structuredContent.currentState.enabled,false);assert.ok(guide.result.structuredContent.why);
    const failed=await rpc('tools/call',{name:'get_settlement',arguments:{dealer:1,startMonth:'2026-09',endMonth:'2026-08'}});
    assert.equal(failed.result.isError,true);assert.equal(failed.result.structuredContent.status,'unavailable');
    env.DB.sqlite.prepare("UPDATE dealer_members SET active=0 WHERE id=1").run();
    const denied=await rpc('tools/call',{name:'explain_term',arguments:{term:'VAT'}});
    assert.ok(denied.error||denied.result?.isError);
    assert.equal(env.MCP_META.sqlite.prepare("SELECT count(*) n FROM mcp_audit WHERE outcome='success'").get().n,3);
  } finally {await server.close();}
});
