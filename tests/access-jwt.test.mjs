import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { generateKeyPair, exportJWK, SignJWT } from "jose";

const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { verifyAccessJwt } = await vite.ssrLoadModule("/app/access-jwt.ts");
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...await exportJWK(publicKey), kid: "key-1", alg: "RS256", use: "sig" };
const config = { CF_ACCESS_TEAM_DOMAIN: "jwt-test.cloudflareaccess.com", CF_ACCESS_AUD: "app-1" };
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => {
  assert.equal(String(url), "https://jwt-test.cloudflareaccess.com/cdn-cgi/access/certs");
  return Response.json({ keys: [jwk] });
};
after(() => { globalThis.fetch = originalFetch; });
async function token(overrides = {}, key = privateKey) {
  return new SignJWT({ sub: "user-1", email: "Admin@Example.COM", iss: "https://jwt-test.cloudflareaccess.com",
    aud: "app-1", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600, ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "key-1" }).sign(key);
}
test("valid Access JWT normalizes verified email and namespaces the user id", async () => {
  assert.deepEqual(await verifyAccessJwt(await token(), config), {
    id: "cloudflare:user-1", email: "admin@example.com", displayName: "admin@example.com",
  });
});
test("wrong issuer, audience, expiry, future not-before and missing identity are rejected", async () => {
  for (const claims of [{ iss: "https://other.cloudflareaccess.com" }, { aud: "other" }, { exp: 1 },
    { nbf: Math.floor(Date.now()/1000)+3600 }, { email: null }, { sub: null }, { email: "bad" }, { iat: null }]) {
    await assert.rejects(verifyAccessJwt(await token(claims), config));
  }
});
test("forged signature, missing config and unsafe key domain are rejected", async () => {
  const { privateKey: attackerKey } = await generateKeyPair("RS256");
  await assert.rejects(verifyAccessJwt(await token({}, attackerKey), config));
  await assert.rejects(verifyAccessJwt(await token(), {}));
  await assert.rejects(verifyAccessJwt(await token(), { ...config, CF_ACCESS_TEAM_DOMAIN: "evil.test" }));
});
