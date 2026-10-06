import assert from "node:assert/strict";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const db = new DatabaseSync(":memory:");
for (const file of readdirSync(root + "/drizzle").filter(name => name.endsWith(".sql")).sort())
  db.exec(readFileSync(root + "/drizzle/" + file, "utf8"));
const binding = { prepare(sql) { return {
  sql, args: [], bind(...args) { return { ...this, args }; },
  async raw() { const statement = db.prepare(this.sql); const names = statement.columns().map(column => column.name);
    return statement.all(...this.args).map(row => names.map(name => row[name])); },
}; } };
globalThis.__membershipTest = { env: { DB: binding }, user: null };
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: "membership-boundaries", enforce: "pre",
  resolveId(source) {
    if (source === "cloudflare:workers") return "\0test-env";
    if (source === "../cloudflare-auth") return "\0test-identity";
  },
  load(id) {
    if (id === "\0test-env") return "export const env = globalThis.__membershipTest.env;";
    if (id === "\0test-identity") return "export async function getAccessUser() { return globalThis.__membershipTest.user; }";
  },
}] });
after(async () => { await vite.close(); db.close(); });
const { requireAppAccess, assertAdmin, requireMerchantAccess } = await vite.ssrLoadModule("/app/api/access.ts");
function fixture() {
  db.exec("DELETE FROM dealer_members; DELETE FROM merchants; DELETE FROM dealers; INSERT INTO dealers (id,name) VALUES (1,'one'),(2,'two'); INSERT INTO merchants (id,name,business_number,dealer_id,install_date) VALUES (1,'one','test-1',1,'2026-10-01'),(2,'two','test-2',2,'2026-10-01');");
  globalThis.__membershipTest.user = { id: "cloudflare:new-sub", email: "member@example.test", displayName: "Member" };
}
test("existing Sites member keeps admin/dealer role by verified email and migrates identity id", async () => {
  for (const role of ["admin", "dealer"]) {
    fixture();
    db.prepare("INSERT INTO dealer_members (user_id,email,role,dealer_id) VALUES (?,?,?,1)").run("old-sites-id", "Member@Example.Test", role);
    const access = await requireAppAccess();
    assert.equal(access.role, role); assert.equal(access.dealerId, 1);
    assert.equal(db.prepare("SELECT user_id FROM dealer_members").get().user_id, "cloudflare:new-sub");
    if (role === "admin") assert.doesNotThrow(() => assertAdmin(access));
    else { assert.throws(() => assertAdmin(access)); await requireMerchantAccess(access, 1); await assert.rejects(requireMerchantAccess(access, 2), { status: 403 }); }
  }
});
test("unknown users remain viewers, even in an empty membership database", async () => {
  fixture();
  assert.equal((await requireAppAccess()).role, "viewer");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dealer_members").get().n, 0);
  await assert.rejects(requireMerchantAccess(await requireAppAccess(), 1), { status: 403 });
});
test("disabled members and ambiguous duplicate email records are rejected", async () => {
  fixture();
  db.exec("INSERT INTO dealer_members (user_id,email,role,active) VALUES ('old-id','member@example.test','admin',0)");
  await assert.rejects(requireAppAccess(), { status: 403 });
  assert.equal(db.prepare("SELECT user_id FROM dealer_members").get().user_id, "old-id");
  db.exec("UPDATE dealer_members SET active=1; INSERT INTO dealer_members (user_id,email,role) VALUES ('other-id','MEMBER@example.test','dealer')");
  await assert.rejects(requireAppAccess(), { status: 403 });
});
test("matching subject alone cannot inherit another email's role; anonymous users are rejected", async () => {
  fixture();
  db.exec("INSERT INTO dealer_members (user_id,email,role) VALUES ('cloudflare:new-sub','other@example.test','admin')");
  assert.equal((await requireAppAccess()).role, "viewer");
  globalThis.__membershipTest.user = null;
  await assert.rejects(requireAppAccess(), { status: 401 });
});
test("administrator bootstrap is explicit and idempotent", () => {
  fixture();
  const sql = readFileSync(root + "/scripts/bootstrap-admin.sql", "utf8");
  db.exec(sql); db.exec(sql);
  assert.deepEqual({ ...db.prepare("SELECT email,role,user_id FROM dealer_members").get() }, {
    email: "74@16612298.com", role: "admin", user_id: "pending:74@16612298.com",
  });
});
