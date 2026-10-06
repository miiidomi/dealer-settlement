import { readFile, writeFile } from "node:fs/promises";

// Uses an API token with Access: Apps and Policies Write, Access: Organizations
// Read, Access: Identity Providers Write and Workers Scripts Read permissions.
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) throw new Error("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID");
async function api(path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(`Cloudflare ${path}: ${JSON.stringify(data.errors)}`);
  return data.result;
}

const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const organization = await api("/access/organizations");
if (!organization?.auth_domain) throw new Error("Complete Zero Trust organization setup first");
const subdomain = await api("/workers/subdomain");
const hostname = process.env.APP_HOSTNAME || `${config.name}.${subdomain.subdomain}.workers.dev`;
if (!/^[a-z0-9.-]+$/i.test(hostname) || !hostname.includes(".")) throw new Error("Invalid APP_HOSTNAME");
const apps = await api("/access/apps?per_page=1000");
if (apps.some(app => app.name === config.name || app.domain === hostname ||
    app.destinations?.some(destination => destination.uri === hostname))) {
  throw new Error("An Access application already exists for this name/domain; inspect it instead of creating another");
}
const providers = await api("/access/identity_providers");
let otp = providers.find(provider => provider.type === "onetimepin");
if (!otp) otp = await api("/access/identity_providers", { name: "Dealer settlement email OTP", type: "onetimepin", config: {} });
const app = await api("/access/apps", {
  name: config.name,
  type: "self_hosted",
  domain: hostname,
  destinations: [{ type: "public", uri: hostname }],
  session_duration: "24h",
  allowed_idps: [otp.id],
  auto_redirect_to_identity: true,
  policies: [{
    name: "Employees and settlement administrator", decision: "allow", precedence: 1,
    include: [{ email_domain: { domain: "sinsinmnc.com" } }, { email: { email: "74@16612298.com" } }],
  }],
});
if (!app.aud) throw new Error(`Created Access application ${app.id}, but the API did not return AUD`);
config.account_id = account;
config.vars = { ...config.vars, CF_ACCESS_TEAM_DOMAIN: organization.auth_domain, CF_ACCESS_AUD: app.aud };
await writeFile(new URL("../wrangler.jsonc", import.meta.url), JSON.stringify(config, null, 2) + "\n");
console.log(JSON.stringify({ application_id: app.id, hostname, team_domain: organization.auth_domain, aud: app.aud }, null, 2));
