import { createRemoteJWKSet, jwtVerify } from "jose";

export type AccessUser = { id: string; email: string; displayName: string };
export type AccessConfig = { CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string };
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyAccessJwt(token: string, config: AccessConfig): Promise<AccessUser> {
  const domain = config.CF_ACCESS_TEAM_DOMAIN?.trim();
  const audience = config.CF_ACCESS_AUD?.trim();
  if (!domain || !audience) throw new Error("Cloudflare Access configuration is missing");
  const issuer = new URL(domain.startsWith("https://") ? domain : `https://${domain}`);
  if (issuer.protocol !== "https:" || !issuer.hostname.endsWith(".cloudflareaccess.com") ||
      issuer.username || issuer.password || issuer.port || issuer.pathname !== "/" || issuer.search || issuer.hash) {
    throw new Error("Invalid Cloudflare Access team domain");
  }
  let keys = keySets.get(issuer.origin);
  if (!keys) {
    keys = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
    keySets.set(issuer.origin, keys);
  }
  const { payload } = await jwtVerify(token, keys, {
    issuer: issuer.origin, audience, algorithms: ["RS256"],
    requiredClaims: ["sub", "email", "exp", "iat"],
  });
  if (typeof payload.sub !== "string" || !payload.sub || typeof payload.email !== "string" ||
      !/^[^\s@]+@[^\s@]+$/.test(payload.email)) throw new Error("Access user identity is missing");
  const email = payload.email.trim().toLowerCase();
  return { id: `cloudflare:${payload.sub}`, email,
    displayName: typeof payload.name === "string" && payload.name ? payload.name : email };
}
