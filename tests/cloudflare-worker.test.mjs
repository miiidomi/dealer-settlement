import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { readdir, readFile } from "node:fs/promises";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers") return { url: "test:cloudflare", shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "test:cloudflare") return { format: "module", source: "export const env = globalThis.__workerTestEnv;", shortCircuit: true };
    return next(url, context);
  },
});
const config = { CF_ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com", CF_ACCESS_AUD: "test-app" };
globalThis.__workerTestEnv = config;
const { default: worker } = await import("../dist/server/index.js");
const env = { ...config, ASSETS: { fetch: async request => {
  const path = new URL(request.url).pathname;
  try {
    const content = await readFile(new URL(`../dist/client${path}`, import.meta.url));
    return new Response(content, { headers: { "content-type": path.endsWith('.js') ? 'application/javascript' : 'text/css' } });
  } catch { return new Response('Not found', { status: 404 }); }
} } };
const ctx = { waitUntil() {}, passThroughOnException() {} };

test("built Worker fails closed when Access is unconfigured", async () => {
  assert.equal((await worker.fetch(new Request("https://app.test/"), {}, ctx)).status, 503);
});
test("built Worker rejects anonymous and forged identity on pages, assets and APIs", async () => {
  for (const path of ["/", "/assets/framework.js", "/favicon.svg", "/api/dashboard", "/api/salesforce/auto-sync"]) {
    const response = await worker.fetch(new Request(`https://app.test${path}`, {
      headers: { "oai-authenticated-user-email": "admin@test.test", "oai-authenticated-user-id": "admin", "Cf-Access-Authenticated-User-Email": "admin@test.test" },
    }), env, ctx);
    assert.equal(response.status, 401);
  }
});
test("built Worker renders the application with a signed Access user", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256", use: "sig" };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), "https://test.cloudflareaccess.com/cdn-cgi/access/certs");
    return Response.json({ keys: [jwk] });
  };
  try {
    const token = await new SignJWT({ email: "viewer@example.test" }).setProtectedHeader({ alg: "RS256", kid: jwk.kid })
      .setIssuer("https://test.cloudflareaccess.com").setAudience("test-app").setSubject("user-1")
      .setIssuedAt().setExpirationTime("1h").sign(privateKey);
    const response = await worker.fetch(new Request("https://app.test/", {
      headers: { accept: "text/html", "Cf-Access-Jwt-Assertion": token },
    }), env, ctx);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/html/);
    assert.match(await response.text(), /딜러 정산 관리/);
    for (const file of (await readdir(new URL('../dist/client/assets/', import.meta.url))).filter(file => /\.(js|css)$/.test(file))) {
      const asset = await worker.fetch(new Request(`https://app.test/assets/${file}`, {
        headers: { "Cf-Access-Jwt-Assertion": token },
      }), env, ctx);
      assert.equal(asset.status, 200, `Authenticated asset /assets/${file} must be served`);
      assert.equal(asset.headers.get('content-type'), file.endsWith('.js') ? 'application/javascript' : 'text/css');
      assert.ok((await asset.text()).length > 0);
    }
  } finally { globalThis.fetch = originalFetch; }
});
test("scheduled sync runs internally without an Access browser token", async t => {
  const now = new Date("2026-10-06T01:00:00Z").getTime();
  t.mock.timers.enable({ apis: ["Date"], now });
  const secret = "test-scheduled-secret-at-least-24-characters";
  config.AUTO_SYNC_SECRET = secret;
  config.DB = { prepare() { return { bind() { return this; }, async raw() { return []; } }; } };
  const pending = [];
  try {
    await worker.scheduled({ scheduledTime: now, cron: "0 0-9 * * *" }, { ...env, AUTO_SYNC_SECRET: secret }, {
      ...ctx, waitUntil(promise) { pending.push(promise); },
    });
    assert.equal(pending.length, 1);
    await Promise.all(pending);
  } finally { delete config.AUTO_SYNC_SECRET; delete config.DB; t.mock.timers.reset(); }
});
