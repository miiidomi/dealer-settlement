import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { AppError, READ_SCOPE, type Env, type Identity, publicBase } from "./env.ts";
import { assertBrowserOrigin, requireAdmin } from "./policy.ts";
import { handleAuth } from "./auth.ts";
import { createServer } from "./server.ts";

export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response> {
    try {
      const base=publicBase(env),url=new URL(request.url);
      if (url.origin!==base) throw new AppError(403,"허용되지 않은 주소입니다.");
      assertBrowserOrigin(request,base);
      const provider=new OAuthProvider<Env>({
        apiRoute:"/mcp",authorizeEndpoint:"/authorize",tokenEndpoint:"/token",clientRegistrationEndpoint:"/register",
        scopesSupported:[READ_SCOPE],requiredScopes:[READ_SCOPE],
        resourceMetadata:{resource:`${base}/mcp`,authorization_servers:[base],bearer_methods_supported:["header"]},
        accessTokenTTL:900,refreshTokenTTL:604800,
        apiHandler:{async fetch(req,bindings,context) {
          const props=context.props as Identity;
          if (!props || typeof props.email!=="string" || !Number.isInteger(props.memberId)) throw new AppError(401,"다시 로그인해 주세요.");
          const identity=await requireAdmin(bindings.DB,props.email,props.memberId);
          return createMcpHandler(()=>createServer(bindings,identity),{route:"/mcp",responseMode:"json",
            allowedHostnames:[new URL(base).hostname],allowedOriginHostnames:[new URL(base).hostname,"chatgpt.com","chat.openai.com"]})(req,bindings,context);
        }},
        defaultHandler:{async fetch(req,bindings) {
          return handleAuth(req,bindings as Env & {OAUTH_PROVIDER:NonNullable<Env["OAUTH_PROVIDER"]>});
        }},
      });
      return await provider.fetch(request,env,ctx);
    } catch (error) {
      const known=error instanceof AppError;
      return Response.json({error:known?error.message:"연결을 처리하지 못했습니다. 관리자에게 설정 확인을 요청해 주세요."},
        {status:known?error.status:503,headers:{"cache-control":"no-store"}});
    }
  },
  async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext) {
    ctx.waitUntil(env.MCP_META.batch([
      env.MCP_META.prepare("DELETE FROM mcp_oauth_flows WHERE expires_at<?").bind(Math.floor(Date.now()/1000)),
      env.MCP_META.prepare("DELETE FROM mcp_audit WHERE created_at<?").bind(new Date(Date.now()-90*86400000).toISOString()),
    ]));
  },
} satisfies ExportedHandler<Env>;
