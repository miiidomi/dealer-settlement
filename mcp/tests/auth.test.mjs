import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { handleAuth, accessEndpoints } from '../src/auth.ts';
import { testEnv, identity } from './fixture.mjs';
const keys=await generateKeyPair('RS256');const jwk={...await exportJWK(keys.publicKey),kid:'fixture-key',alg:'RS256',use:'sig'};

async function flow() {
  const env=testEnv();let completed=null;
  env.OAUTH_PROVIDER={async parseAuthRequest(){return {clientId:'test-client',redirectUri:'https://chatgpt.com/callback',scope:['settlement:read'],state:'client-state',responseType:'code'}},
    async lookupClient(){return {clientName:'<img src=x>'}},async completeAuthorization(value){completed=value;return {redirectTo:'https://chatgpt.com/callback?code=sample'}}};
  const response=await handleAuth(new Request(env.PUBLIC_BASE_URL+'/authorize'),env);
  const html=await response.text();assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x>'));
  const cookie=response.headers.get('set-cookie').split(';')[0];
  const record=env.MCP_META.sqlite.prepare('SELECT * FROM mcp_oauth_flows').get();
  const consent=csrf=>new Request(env.PUBLIC_BASE_URL+'/authorize',{method:'POST',headers:{origin:env.PUBLIC_BASE_URL,cookie},body:new URLSearchParams({flow:record.id,csrf,decision:'allow'})});
  const callback=()=>new Request(env.PUBLIC_BASE_URL+`/callback?state=${record.id}&code=sample`,{headers:{cookie}});
  return {env,html,cookie,record,consent,callback,completed:()=>completed};
}
async function mockIdentity(f,claims,body) {
  const idToken=await new SignJWT({email:identity.email,nonce:f.record.nonce,...claims}).setProtectedHeader({alg:'RS256',kid:'fixture-key'})
    .setIssuer(claims.iss??f.env.ACCESS_ISSUER).setAudience(claims.aud??f.env.ACCESS_CLIENT_ID).setSubject('fixture-admin').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
  const original=globalThis.fetch;globalThis.fetch=async url=>{
    if(String(url)===accessEndpoints(f.env).token)return Response.json({id_token:idToken});
    if(String(url)===accessEndpoints(f.env).jwks)return Response.json({keys:[jwk]});
    throw new Error('Unexpected external request');
  };
  try{return await body()}finally{globalThis.fetch=original}
}
test('consent requires correct CSRF, browser cookie and origin; retries resume the same login',async()=>{
  const f=await flow();await assert.rejects(()=>handleAuth(f.consent('bad'),f.env));
  const wrongOrigin=f.consent(f.record.csrf);wrongOrigin.headers.set('origin','https://evil.example');
  await assert.rejects(()=>handleAuth(wrongOrigin,f.env));
  const response=await handleAuth(f.consent(f.record.csrf),f.env);
  assert.equal(response.status,200);
  const url=new URL(response.headers.get('refresh').replace(/^0; url=/,''));
  assert.equal(response.headers.get('location'),null);
  assert.match(response.headers.get('content-security-policy'),/form-action 'self'/);
  assert.ok((await response.text()).includes(`href="${url.href.replaceAll('&','&amp;')}"`));
  assert.equal(url.searchParams.get('nonce'),f.record.nonce);assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.get('redirect_uri'),f.env.PUBLIC_BASE_URL+'/callback');
  const retry=await handleAuth(f.consent(f.record.csrf),f.env);
  assert.equal(retry.status,200);
  assert.equal(retry.headers.get('refresh'),response.headers.get('refresh'));
  await assert.rejects(()=>handleAuth(f.consent('bad'),f.env));
  const noCookie=f.consent(f.record.csrf);noCookie.headers.delete('cookie');
  await assert.rejects(()=>handleAuth(noCookie,f.env));
});
test('signed OIDC admin identity grants only read scope; state replay cannot grant twice',async()=>{
  const f=await flow();await handleAuth(f.consent(f.record.csrf),f.env);
  await mockIdentity(f,{},async()=>{
    const response=await handleAuth(f.callback(),f.env);assert.equal(response.status,302);
    assert.equal(f.completed().userId,'1');assert.deepEqual(f.completed().scope,['settlement:read']);
    assert.deepEqual(f.completed().props,{...identity,name:identity.email});assert.ok(response.headers.get('set-cookie').includes('Max-Age=0'));
    await assert.rejects(()=>handleAuth(f.callback(),f.env));
  });
});
test('wrong nonce, issuer, audience and email cannot grant access even with a valid signature',async()=>{
  for(const claims of [{nonce:'wrong'},{iss:'https://evil.example'},{aud:'wrong-client'},{email:'outsider@example.test'},{email_verified:false}]){
    const f=await flow();f.env.ACCESS_CLIENT_ID=crypto.randomUUID();
    await handleAuth(f.consent(f.record.csrf),f.env);
    await mockIdentity(f,claims,async()=>{await assert.rejects(()=>handleAuth(f.callback(),f.env));assert.equal(f.completed(),null)});
  }
});
test('expired state and missing browser cookie cannot start an OIDC token exchange',async()=>{
  const f=await flow();await handleAuth(f.consent(f.record.csrf),f.env);
  await assert.rejects(()=>handleAuth(new Request(f.callback().url),f.env));
  f.env.MCP_META.sqlite.prepare('UPDATE mcp_oauth_flows SET expires_at=0').run();
  await assert.rejects(()=>handleAuth(f.callback(),f.env));assert.equal(f.completed(),null);
});
