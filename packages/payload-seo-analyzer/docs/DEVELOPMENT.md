# Developing the SEO analyzer

Ground rules, gotchas and how to check a change, for anyone working on `@shipment/payload-seo-analyzer`. Commands are in the [README](../README.md#development). Planned work is in GitHub issues; the old `PLAN.md` (port history, per-item verification notes) is in git history, last at commit `265a4bf`.

## Ground rules

- **Versions:** `payload`, `@payloadcms/*`, React and TypeScript come from the catalog in the root `pnpm-workspace.yaml`. Never pin them in this package. Two copies of `payload` or `@payloadcms/ui` break the admin's React contexts. That already happened once, when this package was on TS 5.9 and the app on TS 6.0.
- **Payload 4 changes that bite:**
  - Collections are versioned by default. Every plugin collection sets `versions: false`, and `src/__tests__/collectionsVersions.test.ts` enforces it.
  - `admin.group: false` hides a collection from the sidebar.
  - The Local API no longer bypasses access by default, so scripts must pass `overrideAccess: true`.
  - Server views redirect with `props.server.redirect()`, not `next/navigation`.
  - `DefaultTemplate` comes from `@payloadcms/ui/rsc`.
- **Admin UI:** follow [`src/ui/README.md`](../src/ui/README.md) (`@payloadcms/ui` and Payload 4 tokens only).
- **Styles:** the CSS ships as `dist/client.css`. tsup's `onSuccess` hook re-adds `import "./client.css"` to the ESM client bundle. Co-located `components/*.css` files are bundled automatically.
- **Optional dependencies** must never be a literal dynamic `import('pkg')`. Vite's optimizer resolves it at build time and breaks the whole admin bundle. See `optionalImports.test.ts` and the `xlsx` import in `PerformanceView.tsx`.
- **Tests that mock `@payloadcms/ui`** spread `src/__tests__/helpers/payloadUiStub.tsx`. Add a stub there when a component starts using a new Payload component.
- **SEO store migrations** (`SEO_STORE_MIGRATIONS` in `src/store/`) are append-only, and every statement must be safe to run twice. Applied ones are recorded in `seo_store_migrations`.
- **No hard-coded paths or `NEXT_*` env vars.** Admin URLs come from `useSeoApi` / `formatAdminURL`, the site URL from `helpers/siteUrl.ts`. `noHardCodedPaths.test.ts` guards both.
- **Token crypto is async:** `encryptToken` / `decryptToken` return promises.
- **English only:** strings live in one English dictionary each (`i18n.ts`, `dashboard-i18n.ts`, the panels' local `s` tables). Don't reintroduce a locale switch. `translations.ts` (the plugin's admin labels in Payload's other admin languages) is the exception and is kept on purpose.
- **Workers limits:** anything that loops over every document needs a cap or a step budget (see [Performance](../README.md#performance)). The default CPU limit is 30 s per invocation, and deployed Workers cost about 3× the CPU that local workerd suggests.

## Gotchas

### Local development

- **Dev-push data-loss prompt:** while the plugin's tables exist in your local D1 (`apps/web/.wrangler/state`), any branch or config without them makes Payload's dev push stop at an interactive "data loss" prompt. Tests and scripts then hang until they time out.
- **First request after adding collections:** the first dev request sometimes fails with `index payload_locked_documents_rels_order_idx already exists`. That's a drizzle/SQLite push quirk; the next request works.
- **Local D1 and `pnpm web migrate`:** any `payload` command (`generate:types`, `migrate:create`) dev-pushes the local D1, after which `pnpm web migrate` stops at the data-loss prompt. Wipe `apps/web/.wrangler/state` and run `NODE_ENV=production pnpm migrate`, then `NODE_ENV=production pnpm seo-store:migrate` (from `apps/web`).
- **Rate limiting:** the plugin rate-limits its expensive endpoints per user (10/min), so automated checks that load many views quickly get HTTP 429.
- **External links locally:** the SSRF guard blocks loopback, so a local mock server can't be a link target. Use `httpbin.org/status/<code>` and `/delay/<s>` (httpbin caps delays at 10 s and answers 400 above that).
- **One site per SEO_D1:** the SQL store uses one table set per database, so don't point two sites at the same SEO_D1.

### workerd preview (`pnpm web preview`)

- It doesn't take `--port` cleanly. Run `pnpm web build`, then `CLOUDFLARE_RUNTIME=true vite preview --port 4310` from `apps/web`. `vite preview` needs `PAYLOAD_SECRET` in the shell env.
- A local D1 created by Payload's dev push makes `pnpm web migrate` stop at the "data loss" prompt. Back up `.wrangler/state` and migrate a fresh copy.
- The build writes the secret to `dist/server/.dev.vars`. It's gitignored, but it's on disk.
- Enabling features in a local config regenerates `importMap.js` on build; revert it before committing.
- `/cdn-cgi/local/explorer/api` lists R2 objects and request traces. It shows no CPU time.
- Local workerd doesn't enforce deployed limits (PBKDF2 iterations, CPU), so a pass there isn't a pass on a deployed Worker.
- **Cron ticks:** ticks within the same 5-minute window only queue `seoAuditContinue`; a tick after the next `*/5` mark runs it. Dashboard peeks also advance paused builds, so test the Cron path with no peeks in between.
- **`node:dns`** returns CNAME targets mixed into the answers (`www.wikipedia.org` gives `["dyna.wikimedia.org.", "185.15.58.224"]`), so never treat resolver output as addresses without parsing it. `resolve4` rejects IP literals. Cloudflare documents `lookup` as not implemented, though it works in local workerd.

### Deployed Workers

- **Env vars:** varlock only passes variables declared in `apps/web/.env.schema` to the Worker. A plugin `SEO_*` variable does nothing there until it's declared. To override a declared variable for one deploy, set it in the shell: `SEO_AUDIT_STEP_DOCS=1 varlock-wrangler deploy`. `--var SEO_AUDIT_STEP_DOCS:1` is silently replaced by the schema's value; an undeclared variable (such as `SEO_AUDIT_BATCH_SIZE`) does pass through `--var`.
- **Deploy** with `pnpm web run deploy`. Plain `pnpm web deploy` runs pnpm's built-in `deploy` command and fails.
- **Cron Triggers after a deploy:** a new or changed schedule can take a few minutes to start firing. Ticks land a few seconds after the minute. Payload queues a scheduled task for the cron's next run time, so the first tick only queues and the second runs it.
- **Scheduled jobs have no request origin:** the rank snapshot job needs the `siteUrl` option or `SITE_URL`, and the alerts digest sent by its job carries no `siteUrl` without one (`/alerts-run` falls back to the request origin).
- **A Worker can't fetch another Worker on the same account's `workers.dev`:** the request never reaches it and comes back 404. An alerts webhook (or any outbound URL) pointing at a sibling Worker needs a custom domain or a service binding.
- **Chunked builds:** the dashboard's "force refresh" (`?nocache=1`) is refused for 5 minutes after the last build (`SEO_AUDIT_MIN_REFRESH_MS`). To make a small site pause between steps, deploy with `SEO_AUDIT_STEP_DOCS=1` and `--var SEO_AUDIT_BATCH_SIZE:1`. Steps stop between DB pages, so a page holding every doc never pauses.
- **Rate limits are approximate:** Workers Rate Limiting counts per machine and syncs eventually, so `SEO_RATE_LIMITS` is a brake on runaway clients, not a hard cap.

### e2e

- `pnpm web test:e2e` starts `vite dev --strictPort` on `E2E_PORT` (default 3000) and, outside CI, reuses a server already on that port. `E2E_BASE_URL` tests a running server instead.
- Playwright runs with `workers: 1` everywhere: each spec file deletes and recreates the same admin user.
- A dev server Playwright starts itself sometimes dies mid-suite locally (`ERR_CONNECTION_REFUSED`, workerd `SQLITE_BUSY`). Start `pnpm dev --port N` first and point `E2E_PORT` at it for reliable local runs.
- Specs create pages through REST as the logged-in admin, not the Local API, which raced the dev server's autosaves for the SQLite file. SEO_D1 rows they leave are removed with `apps/web/tests/helpers/seoStore.ts`.
- Frontend redirects apply on the next request (the app compares the shared `gen/frontend-redirects` marker), so the redirect spec only polls for a few seconds.

## Checking a change

### Visual check (both themes)

1. Copy `apps/web` (without `node_modules`) to a scratch directory and enable every feature there except `gscApi` / `indexNow`.
2. `pnpm install`, then `vite dev --port 3020`.
3. Create a user with `payload run` (pass `overrideAccess: true`).
4. Screenshot each view with Playwright. Set the `payload-theme` cookie to `dark` / `light` and log in through `POST /api/users/login`.

### Scale check in workerd

1. Seed 300–1,500 published pages, each about 550 words with internal and external links, through `payload run` or REST.
2. Exercise every enabled endpoint and admin view with curl and Playwright against the workerd preview.
3. Time the uncached scans. Local workerd enforces no CPU limit, so use the process's CPU time as an upper bound.

### Deployed Worker check

1. Deploy with `pnpm web run deploy` (it applies both databases' migrations first).
2. Create a temporary admin with an API key in the production D1 from Node: a throwaway `payload run` script with `APP_ENV=production NODE_ENV=production PAYLOAD_MIGRATE_REMOTE=true`. Don't override `PAYLOAD_SECRET`: API-key lookups are keyed with it, so the key only works on the Worker with the production secret (`.env.production.local`). The password hash doesn't depend on it, so the same user can also log in to the admin through `POST /api/users/login` for Playwright.
3. Call endpoints with `Authorization: users API-Key <key>` (use `curl -g` for `?select[...]` queries). Read CPU from Workers Observability (`cpuTimeMs`) or `wrangler tail`.
4. For paused builds or tight external-links budgets, redeploy the same build with the overrides above (`varlock-wrangler deploy`, no rebuild), then redeploy without them.
5. Clean up: delete test pages, then the SEO_D1 rows the check wrote (`seo_score_history` for saved pages, `seo_logs` for 404s, including the one any request to a deleted test page records) with `wrangler d1 execute SEO_D1 --remote`, then the temporary user. R2 cache entries expire on their own after 7 days.
