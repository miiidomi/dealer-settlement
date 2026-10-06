# Dealer settlement on Cloudflare Workers

The application uses vinext/React, Cloudflare Workers and D1. Authentication uses Cloudflare Access signed JWTs. The migration is developed on `cloudflare-migration`; `main` is unchanged.

## Setup

Use Node.js 22.15 or newer (tests use `node:sqlite` and synchronous module hooks).

```sh
npm ci
npm run dev
npm test
npm run lint
npm run build
```

Copy `.dev.vars.example` to `.dev.vars` for local secrets. Authentication deliberately remains enabled locally: requests must carry a signed Access JWT. There is no identity-header or development-login bypass.

`wrangler.jsonc` is authoritative. D1 binding `DB` points to `59a55768-3c37-4942-89ee-807f8d37781a`. Vite emits the deployable Worker and generated configuration in `dist/server`, with frontend assets in `dist/client`.

## Access

Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, or put them in ignored `.env.cloudflare`. The API token needs Access Apps and Policies Write, Access Organizations Read, Access Identity Providers Write, and Workers Scripts Read. Wrangler login can be used separately for D1 and deployment; its default OAuth scopes do not grant Access management.

Complete Zero Trust organization setup in the Cloudflare account first. Then run:

```sh
npm run access:configure
```

The script creates an Access application covering `dealer-settlement.<account-subdomain>.workers.dev` (override with `APP_HOSTNAME`), an email OTP provider if needed, and an allow policy for `sinsinmnc.com` or `74@16612298.com`. It records the actual team domain, application audience and account ID in `wrangler.jsonc`. An existing application for the same name/domain causes the script to stop for inspection. For a custom domain, also configure its Worker route and protect every production hostname with this Access application.

Every HTTP request, including assets and API endpoints, verifies the `Cf-Access-Jwt-Assertion` signature against the team's JWKS, RS256 algorithm, issuer, audience, expiry and user identity. Missing Access configuration returns 503; missing or invalid JWTs return 401. A correctly configured Access application shows its login screen before requests reach the Worker. Preview URLs are disabled.

Verified email (case insensitive) connects to existing `dealer_members`. Existing admin/dealer roles and dealer assignments are retained; the legacy user ID is replaced after a successful match. Disabled users and duplicate email records are denied. Unregistered authenticated users are viewers. No arbitrary first visitor becomes administrator. The explicit administrator bootstrap SQL creates `74@16612298.com` only if no active administrator and no matching member already exist.

## D1 migration

Inspect the remote database before applying migrations:

```sh
npx wrangler d1 info DB --config wrangler.jsonc
npx wrangler d1 execute DB --remote --config wrangler.jsonc --command "SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY name"
npx wrangler d1 migrations list DB --remote --config wrangler.jsonc
```

For an empty database, or a database with a verified compatible Wrangler migration history:

```sh
npm run db:migrate:remote
npm run db:bootstrap:remote
```

Do not replay CREATE/ALTER statements against an existing Sites schema without reconciling its migration history. Export a backup before changing a populated database:

```sh
npx wrangler d1 export DB --remote --config wrangler.jsonc --output .tools/d1-before-migration.sql
```

The original repository ended at migration 0021 while code required additional penalty and settlement snapshot columns. `0022_normal_lyja.sql` adds those missing structures without deleting business records. A historical reconciliation test referenced a missing 0023 repair SQL; its narrow SQL fixture is now under `tests/fixtures` and is excluded from production migrations. Existing remote databases may already have these columns, so inspect them first.

Existing Sites business data is not copied by applying schema migrations. If this D1 is a new database, separately arrange a complete Sites data export/import, preserving IDs and relationships, before switching users to it.

## Salesforce and deployment

Required secrets/settings are `SF_LOGIN_URL`, `SF_CLIENT_ID`, `SF_CLIENT_SECRET`; `SF_API_VERSION` defaults to `66.0`. `AUTO_SYNC_SECRET` must be at least 24 characters. The OAuth integration uses the Salesforce client credentials flow; keep the original connected app and integration user configuration.

Register secrets with Wrangler (interactive input avoids command-line exposure):

```sh
npx wrangler secret put SF_LOGIN_URL --config wrangler.jsonc
npx wrangler secret put SF_CLIENT_ID --config wrangler.jsonc
npx wrangler secret put SF_CLIENT_SECRET --config wrangler.jsonc
npx wrangler secret put SF_API_VERSION --config wrangler.jsonc
npx wrangler secret put AUTO_SYNC_SECRET --config wrangler.jsonc
npx wrangler secret list --config wrangler.jsonc
npm test
npm run deploy
```

Production secrets are independent of local `.dev.vars`. `npm run deploy` uses the built `dist/server/wrangler.json`; rebuild after changing bindings or Access settings. Perform a signed-in smoke test after deployment: administrator dashboard, dealer scope, viewer restrictions and manual Salesforce sync.

The cron runs hourly from 09:00 through 18:00 Asia/Seoul. Scheduled execution calls the automatic sync handler internally; it calls each dealer's sync handler internally with the sync secret. This avoids Cloudflare Access blocking internal HTTP requests and removes the former hosted-site URL dependency. Public sync endpoints still require Access authentication in addition to their application permissions/secrets.