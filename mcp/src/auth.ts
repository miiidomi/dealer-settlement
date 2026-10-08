import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { AppError, READ_SCOPE, type Env, publicBase } from "./env.ts";
import { escapeHtml, requireAdmin } from "./policy.ts";

type Flow = { id: string; auth_request: string; csrf: string; verifier: string; nonce: string; stage: string; expires_at: number };
const COOKIE = "__Host-mcp-flow";
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const now = () => Math.floor(Date.now() / 1000);
const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function cookieValue(request: Request) {
  const match = (request.headers.get("cookie") ?? "").split(";").map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`));
  return match?.slice(COOKIE.length + 1) ?? "";
}
function cookie(id: string, clear = false) {
  return `${COOKIE}=${id}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 600}`;
}
function page(body: string, status = 200, setCookie?: string) {
  const headers = new Headers({"content-type":"text/html; charset=utf-8", "cache-control":"no-store",
    "content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "referrer-policy":"same-origin", "x-content-type-options":"nosniff"});
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>딜러 정산 조회</title><style>body{font:16px/1.7 system-ui;max-width:540px;margin:70px auto;padding:24px;color:#192333}button{background:#1c4e93;color:white;border:0;border-radius:8px;padding:12px 20px;cursor:pointer}small{color:#536277}</style>${body}</html>`, {status,headers});
}

export function accessEndpoints(env: Env) {
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN) || !env.ACCESS_CLIENT_ID)
    throw new AppError(503, "관리자 로그인 설정이 필요합니다.");
  const base = `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/sso/oidc/${encodeURIComponent(env.ACCESS_CLIENT_ID)}`;
  return { authorization: `${base}/authorization`, token: `${base}/token`, jwks: `${base}/jwks` };
}

export async function handleAuth(request: Request, env: Env & {OAUTH_PROVIDER: OAuthHelpers}): Promise<Response> {
  const url = new URL(request.url), base = publicBase(env);
  if (url.pathname === "/" && request.method === "GET")
    return page("<h1>딜러 정산 조회</h1><p>ChatGPT에서 이 서버의 <b>/mcp</b> 주소를 연결해 사용하세요.</p><p>활성 관리자만 조회할 수 있습니다.</p><small>예: ‘이정수 9월 정산금액과 계산 근거 알려줘.’</small>");

  if (url.pathname === "/authorize" && request.method === "GET") {
    const auth = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    if (auth.scope.some(x => x !== READ_SCOPE)) throw new AppError(400, "조회 권한만 요청할 수 있습니다.");
    auth.scope = [READ_SCOPE];
    const client = await env.OAUTH_PROVIDER.lookupClient(auth.clientId);
    if (!client) throw new AppError(400, "연결할 앱을 확인해 주세요.");
    const flow: Flow = {id:crypto.randomUUID(), auth_request:JSON.stringify(auth), csrf:random(),
      verifier:random(), nonce:random(), stage:"consent", expires_at:now()+600};
    await env.MCP_META.prepare("DELETE FROM mcp_oauth_flows WHERE expires_at<?").bind(now()).run();
    await env.MCP_META.prepare("INSERT INTO mcp_oauth_flows(id,auth_request,csrf,verifier,nonce,stage,expires_at) VALUES(?,?,?,?,?,?,?)")
      .bind(flow.id,flow.auth_request,flow.csrf,flow.verifier,flow.nonce,flow.stage,flow.expires_at).run();
    const host = new URL(auth.redirectUri).hostname;
    return page(`<h1>딜러 정산 조회 연결</h1><p><b>${escapeHtml(client.clientName ?? "연결 앱")}</b>에서 정산 자료를 조회하도록 허용합니다.</p><p>대상: 관리자 권한으로 조회 가능한 전체 딜러.<br>자료의 수정·삭제 기능은 제공하지 않습니다.</p><small>로그인 후 돌아갈 주소: ${escapeHtml(host)}</small><form method="post" action="/authorize"><input type="hidden" name="flow" value="${flow.id}"><input type="hidden" name="csrf" value="${flow.csrf}"><p><button name="decision" value="allow">로그인하고 연결하기</button></p></form>`,200,cookie(flow.id));
  }

  if (url.pathname === "/authorize" && request.method === "POST") {
    if (request.headers.get("origin") !== base) throw new AppError(403, "연결 요청을 다시 시작해 주세요.");
    const form = await request.formData(), id = String(form.get("flow") ?? "");
    if (!id || id !== cookieValue(request) || form.get("decision") !== "allow")
      throw new AppError(403, "연결 요청을 다시 시작해 주세요.");
    const csrf = String(form.get("csrf") ?? "");
    // A retry may resume the same browser-bound login; the callback still
    // atomically consumes the flow before issuing exactly one OAuth grant.
    let flow = await env.MCP_META.prepare("UPDATE mcp_oauth_flows SET stage='upstream' WHERE id=? AND csrf=? AND stage='consent' AND expires_at>=? RETURNING *")
      .bind(id,csrf,now()).first<Flow>();
    if (!flow) flow = await env.MCP_META.prepare("SELECT * FROM mcp_oauth_flows WHERE id=? AND csrf=? AND stage='upstream' AND expires_at>=?")
      .bind(id,csrf,now()).first<Flow>();
    if (!flow) throw new AppError(400, "연결 요청이 만료되었습니다. 다시 연결해 주세요.");
    const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(flow.verifier)))))
      .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    const upstream = new URL(accessEndpoints(env).authorization);
    for (const [key,value] of Object.entries({client_id:env.ACCESS_CLIENT_ID,response_type:"code",
      redirect_uri:`${base}/callback`,scope:"openid email profile",state:flow.id,nonce:flow.nonce,
      code_challenge:challenge,code_challenge_method:"S256"})) upstream.searchParams.set(key,value);
    // Finish the same-origin form submission before starting an external
    // navigation. Chrome applies form-action to a form's HTTP redirect chain.
    const next = page(`<h1>관리자 로그인으로 이동합니다</h1><p>자동으로 이동하지 않으면 아래 링크를 눌러 주세요.</p><p><a href="${escapeHtml(upstream.href)}" referrerpolicy="no-referrer">로그인 계속하기</a></p>`);
    next.headers.set("refresh", `0; url=${upstream.href}`);
    return next;
  }

  if (url.pathname === "/callback" && request.method === "GET") {
    const id = url.searchParams.get("state");
    if (!id || id !== cookieValue(request)) throw new AppError(403, "로그인 요청을 다시 시작해 주세요.");
    const flow = await env.MCP_META.prepare("DELETE FROM mcp_oauth_flows WHERE id=? AND stage='upstream' AND expires_at>=? RETURNING *")
      .bind(id,now()).first<Flow>();
    if (!flow) throw new AppError(400, "로그인 요청이 만료되었습니다. 다시 연결해 주세요.");
    if (url.searchParams.has("error") || !url.searchParams.get("code"))
      throw new AppError(401, "로그인이 완료되지 않았습니다. 다시 연결해 주세요.");
    if (!env.ACCESS_CLIENT_SECRET || !env.ACCESS_ISSUER) throw new AppError(503,"관리자 로그인 설정이 필요합니다.");
    const endpoints = accessEndpoints(env);
    const tokenResponse = await fetch(endpoints.token,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({grant_type:"authorization_code",client_id:env.ACCESS_CLIENT_ID,
        client_secret:env.ACCESS_CLIENT_SECRET,code:url.searchParams.get("code")!,redirect_uri:`${base}/callback`,code_verifier:flow.verifier}),
      signal:AbortSignal.timeout(15000)});
    if (!tokenResponse.ok) throw new AppError(401,"로그인을 확인하지 못했습니다. 다시 연결해 주세요.");
    const token = await tokenResponse.json() as {id_token?:string};
    if (!token.id_token) throw new AppError(401,"로그인 정보를 확인하지 못했습니다.");
    let jwks = jwksCache.get(endpoints.jwks);
    if (!jwks) {jwks=createRemoteJWKSet(new URL(endpoints.jwks));jwksCache.set(endpoints.jwks,jwks);}
    let payload;
    try {
      ({payload} = await jwtVerify(token.id_token,jwks,{issuer:env.ACCESS_ISSUER,audience:env.ACCESS_CLIENT_ID,
        algorithms:["RS256"],requiredClaims:["exp","iat","sub","email","nonce"]}));
    } catch { throw new AppError(401,"로그인 정보를 확인하지 못했습니다. 다시 연결해 주세요."); }
    if (payload.nonce !== flow.nonce || typeof payload.email !== "string" || payload.email_verified === false)
      throw new AppError(401,"로그인 정보를 확인하지 못했습니다.");
    const identity = await requireAdmin(env.DB,payload.email);
    const authRequest = JSON.parse(flow.auth_request) as AuthRequest;
    const {redirectTo} = await env.OAUTH_PROVIDER.completeAuthorization({request:authRequest,
      userId:String(identity.memberId),scope:[READ_SCOPE],metadata:{label:"딜러 정산 조회"},props:identity});
    return new Response(null,{status:302,headers:{location:redirectTo,"set-cookie":cookie("",true),"cache-control":"no-store"}});
  }
  return new Response("Not Found",{status:404});
}
