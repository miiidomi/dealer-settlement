import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  DB: D1Database;
  MCP_META: D1Database;
  OAUTH_KV: KVNamespace;
  PUBLIC_BASE_URL: string;
  SITE_BASE_URL: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_CLIENT_ID: string;
  ACCESS_CLIENT_SECRET: string;
  ACCESS_ISSUER: string;
  OAUTH_PROVIDER?: OAuthHelpers;
}

export type Identity = { email: string; memberId: number; name: string };
export const READ_SCOPE = "settlement:read";
export const VERSION = "1.0.0";

export class AppError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function publicBase(env: Env) {
  const u = new URL(env.PUBLIC_BASE_URL);
  if (u.protocol !== "https:" || u.pathname !== "/" || u.search || u.hash || u.username || u.password)
    throw new AppError(503, "MCP 주소 설정을 확인해 주세요.");
  return u.origin;
}

export function siteLink(env: Pick<Env, "SITE_BASE_URL">, merchantId?: number) {
  const base = new URL(env.SITE_BASE_URL);
  if (base.protocol !== "https:") throw new AppError(503, "사이트 주소 설정을 확인해 주세요.");
  return new URL(merchantId ? `/merchants/${merchantId}` : "/", base).href;
}
