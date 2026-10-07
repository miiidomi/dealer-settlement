// Verify the bundled Worker in the real workerd runtime, with isolated local bindings.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const base='https://mcp.example.test';
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-10-07',
  compatibilityFlags:['nodejs_compat','global_fetch_strictly_public'],kvNamespaces:['OAUTH_KV'],d1Databases:['DB','MCP_META'],
  bindings:{PUBLIC_BASE_URL:base,SITE_BASE_URL:'https://site.example.test',ACCESS_TEAM_DOMAIN:'dealer-settlement.cloudflareaccess.com',ACCESS_CLIENT_ID:'fixture-only'}}));
try {
  const meta=await runtime.dispatchFetch(base+'/.well-known/oauth-authorization-server');assert.equal(meta.status,200);
  const auth=await meta.json();assert.equal(auth.issuer,base);assert.ok(auth.code_challenge_methods_supported.includes('S256'));
  const resource=await runtime.dispatchFetch(base+'/.well-known/oauth-protected-resource/mcp');assert.equal(resource.status,200);
  assert.equal((await resource.json()).resource,base+'/mcp');
  const rpc={method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})};
  const unauth=await runtime.dispatchFetch(base+'/mcp',rpc);assert.equal(unauth.status,401);assert.match(unauth.headers.get('www-authenticate'),/resource_metadata/);
  const forged=await runtime.dispatchFetch(base+'/mcp',{...rpc,headers:{...rpc.headers,authorization:'Bearer forged-token'}});assert.equal(forged.status,401);
  const foreign=await runtime.dispatchFetch(base+'/mcp',{...rpc,headers:{...rpc.headers,origin:'https://evil.example'}});assert.equal(foreign.status,403);
  const registration=await runtime.dispatchFetch(base+'/register',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({client_name:'Fixture ChatGPT',redirect_uris:['https://chatgpt.com/callback'],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'})});
  assert.equal(registration.status,201);const client=await registration.json();assert.ok(client.client_id);
  const db=await runtime.getD1Database('MCP_META');
  const statements=readFileSync('schema.sql','utf8').replace(/^--.*$/gm,'').split(';').map(x=>x.trim()).filter(Boolean);
  await db.batch(statements.map(sql=>db.prepare(sql)));
  const url=new URL(base+'/authorize');for(const [key,value] of Object.entries({client_id:client.client_id,redirect_uri:'https://chatgpt.com/callback',response_type:'code',scope:'settlement:read',resource:base+'/mcp',state:'fixture',code_challenge:'a'.repeat(43),code_challenge_method:'S256'}))url.searchParams.set(key,value);
  const consent=await runtime.dispatchFetch(url);assert.equal(consent.status,200);assert.ok(consent.headers.get('set-cookie').includes('HttpOnly'));
  const text=await consent.text();assert.match(text,/로그인하고 연결하기/);
  console.log('Bundled Worker: discovery, token rejection, origin checks, DCR and consent passed.');
} finally {await runtime.dispose();}
