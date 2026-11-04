# SEO analyzer: port status and plan

Handoff for whoever continues porting `@cargo/payload-seo-analyzer`. Last updated 2026-11-04 (after P0 + P1, their leftovers, P2 items 9–13, the deployed check of 10–13, CI + the README rewrite, and `schemaBuilder` + `alerts` on a deployed Worker).

## TL;DR

- This package is a fork of [`@consilioweb/payload-seo-analyzer`](https://github.com/pOwn3d/payload-seo-analyzer) 4.2.2 (Payload 3 + Next.js), ported to **Payload 4 (4.0.0-beta.6)** and to our stack: **TanStack Start on Cloudflare Workers, D1 + R2**.
- **Done:** it compiles and runs on Payload 4, has no Next.js dependency, and its whole admin UI has been rebuilt on `@payloadcms/ui` and Payload 4 tokens.
- **P0 and P1 are done** (branch `feat/seo-analyzer-workers`, 2026-11-03). The core subset `apps/web` enables (editor sidebar, dashboard, redirects, sitemap audit, settings, sitemap/robots/llms.txt) is **verified in local workerd** (`pnpm web preview`) and on a deployed Worker.
  - The audit and the caches the UI depends on persist in R2 through the plugin's `cacheStore` option and build through `waitUntil`.
  - `seo-redirects` apply on the site, and `/sitemap.xml`, `/robots.txt` and `/llms.txt` are served at the root.
  - The admin UI has no hard-coded paths, and no `NEXT_*` env vars are left.
- **Verified on a deployed Worker** (2026-11-03, `cargo-template.pedrsntana.workers.dev`, 1,500 seeded pages): every enabled feature works. See "Deployed Worker check" below.
  - Admin login on Workers needed a Payload patch (`patches/payload@4.0.0-beta.6.patch`): Payload 4 hashes passwords with 600,000 PBKDF2 iterations, and deployed Workers reject anything above 100,000 (local workerd doesn't, so `pnpm web preview` hides it).
- **Background work runs as Payload jobs on a Cron Trigger** (P2 item 9, verified on the deployed Worker). The dashboard audit builds in steps, so big sites no longer need to fit one request.
- **Time-series data lives in a second D1 database** (P2 item 10): score history, Search Console imports, rank history and 404 logs go to `SEO_D1` through the plugin's `dataStore` option, with retention mandatory. **Verified on the deployed Worker** (2026-11-04, D1 `cargo-template-seo`).
- **The external links checker fits Workers limits** (P2 item 13) and **GSC token crypto is WebCrypto** (P2 item 12). Both verified on deployed Workers.
- `apps/web` now turns on `performance`, `scoreHistory`, `seoLogs`, `externalLinks`, `aiFeatures`, `schemaBuilder` and `alerts` (no delivery channel set yet). `gscApi` stays off until a Google OAuth client exists. The whole-site scans and `indexNow` are in the backlog until the real site exists.
- **AI features run on OpenRouter** (P2 item 11), DeepSeek V4.1 Flash by default. **Verified on the deployed Worker** with a real key (2026-11-04); that run also fixed the optimize prompt, which invented numbers in titles.

## Where things are

| What | Where |
|---|---|
| Plugin source | `packages/payload-seo-analyzer/src` (`plugin.ts` wires everything; `endpoints/`, `collections/`, `components/`, `views/`, `rules/`) |
| Admin UI conventions (mandatory) | [`src/ui/README.md`](src/ui/README.md): `@payloadcms/ui` + Payload 4 tokens only |
| Shared UI layer | `src/ui/` (`styles.css`, `tone.ts`, `primitives.tsx`) |
| How the app uses it | `apps/web/src/payload.config.ts` (`seoAnalyzerPlugin({...})`; the feature flags live there) |
| Its migration in the app | `apps/web/src/db/migrations/20261103_110003_seo_analyzer.ts` (`seo_redirects`, `seo_settings`, `pages.focus_keyword`, `pages.is_cornerstone`, `pages_focus_keywords`) |
| Docs | `README.md` (rewritten for Payload 4 + Workers, with the per-feature Workers status), `docs/THREAT-MODEL.md` (updated, with a Workers section). `CHANGELOG.md` is upstream's history up to 4.2.2; `docs/*-2026*.md` are upstream product notes |
| CI | `.github/workflows/ci.yml` (lint, typecheck, unit + int tests, build, migration/generated-files drift, Playwright). PR reviews: Pullfrog, `.github/pullfrog/` |
| History | Imported with `git subtree`. `git log -- packages/payload-seo-analyzer` covers upstream v1.20.0 → 4.2.2 plus the port commits |

Port commits, oldest first (`git log --oneline 4cc80c2`):
- `cf90f4f` Payload 4 + Workers port
- `6988ad0` `versions: false`
- `60fa279` keep `xlsx` out of the bundle
- `e8fe4eb` / `6d53fb0` UI foundation
- `4cc80c2` full UI rebuild

After that, in this repo:
- `d4322b5` made it a workspace package
- `1de8408` added it to `apps/web`
- `feat/seo-analyzer-workers`: P0 + P1 (see "Done on 2026-11-03" below)
- `fix/seo-analyzer-deployed-worker`: deployed Worker check, PBKDF2 patch
- `fix/seo-analyzer-p1-leftovers`: the P0/P1 leftovers (see "Done on 2026-11-03 (P0/P1 leftovers)")
- `feat/seo-analyzer-p2` (PR #10): P2 item 9, background jobs and chunked audit builds
- `feat/seo-analyzer-p2-items-10-12-13` (PR #12): P2 items 10, 12 and 13 (SEO_D1 data store, GSC on WebCrypto, external links checker)
- `feat/seo-analyzer-seo-d1-deploy` (PR #13): the production SEO_D1 database, the deployed check of items 10, 12 and 13, and those features on in `apps/web`
- `feat/seo-analyzer-ai-openrouter`: P2 item 11, the AI features on OpenRouter
- `feat/ci-pullfrog-readme`: CI, the SEO e2e specs, Pullfrog reviews, the README and threat-model rewrite (P3 items 16 and 17)
- `feat/seo-analyzer-ai-deployed`: P2 item 11's deployed check, `aiFeatures` on in `apps/web`, the optimize prompt fix
- `feat/seo-analyzer-schema-alerts`: `schemaBuilder` and `alerts` checked on the deployed Worker and on in `apps/web`, with their fixes; `indexNow` to the backlog

## Working on it

```sh
pnpm dev                                                 # root: tsup --watch for the plugin + the app on :3000
pnpm --filter @cargo/payload-seo-analyzer test           # ~800 vitest tests (jsdom for components)
pnpm --filter @cargo/payload-seo-analyzer typecheck
pnpm build                                               # plugin, then the production Worker
PAYLOAD_SECRET=test-secret pnpm web test:int             # app integration tests (varlock exits without the secret)
pnpm web generate:importmap                              # after adding/removing admin components or views
pnpm web migrate:create <name>                           # after enabling a feature that adds a collection
pnpm web seo-store:migrate                               # apply the SEO_D1 store's SQL locally (remote: seo-store:migrate:remote, part of `pnpm web run deploy`)
```

Ground rules:
- **Versions:** `payload`, `@payloadcms/*`, React and TypeScript come from the catalog in the root `pnpm-workspace.yaml`. Never pin them in this package. Two copies of `payload` or `@payloadcms/ui` break the admin's React contexts. That already happened once, when this package was on TS 5.9 and the app on TS 6.0.
- **Payload 4 changes that bite:**
  - Collections are versioned by default. Every plugin collection sets `versions: false`, and `src/__tests__/collectionsVersions.test.ts` enforces it.
  - `admin.group: false` hides a collection from the sidebar.
  - The Local API no longer bypasses access by default, so scripts must pass `overrideAccess: true`.
  - Server views redirect with `props.server.redirect()`, not `next/navigation`.
  - `DefaultTemplate` comes from `@payloadcms/ui/rsc`.
- **Styles:** the CSS ships as `dist/client.css`. tsup's `onSuccess` hook re-adds `import "./client.css"` to the ESM client bundle. Co-located `components/*.css` files are bundled automatically.
- **Optional dependencies** must never be a literal dynamic `import('pkg')`. Vite's optimizer resolves it at build time and breaks the whole admin bundle. See `optionalImports.test.ts` and the `xlsx` import in `PerformanceView.tsx`.
- **Tests that mock `@payloadcms/ui`** spread `src/__tests__/helpers/payloadUiStub.tsx`. Add a stub there when a component starts using a new Payload component.
- **SEO store migrations** (`SEO_STORE_MIGRATIONS` in `src/store/`) are append-only, and every statement must be safe to run twice. Applied ones are recorded in `seo_store_migrations`.
- **Token crypto is async:** `encryptToken` / `decryptToken` return promises.

Gotchas:
- **Dev-push data-loss prompt:** while the plugin's tables exist in your local D1 (`apps/web/.wrangler/state`), any branch or config without them makes Payload's dev push stop at an interactive "data loss" prompt. Tests and scripts then hang until they time out.
- **First request after adding collections:** the first dev request sometimes fails with `index payload_locked_documents_rels_order_idx already exists`. That's a drizzle/SQLite push quirk; the next request works.
- **Rate limiting:** the plugin rate-limits its expensive endpoints per user (10/min), so automated checks that load many views quickly get HTTP 429.
- **e2e port:** `pnpm web test:e2e` starts `vite dev --strictPort` on `E2E_PORT` (default 3000) and, outside CI, reuses a server already on that port. Use another port if a different app holds 3000. `E2E_BASE_URL` tests a running server instead. The dev server and the test process share the local D1, so the odd `SQLITE_BUSY` shows up in the log (and, rarely, fails a seed/cleanup step that a retry passes).
- **workerd preview:**
  - `pnpm web preview` doesn't take `--port` cleanly. Run `pnpm web build`, then `CLOUDFLARE_RUNTIME=true vite preview --port 4310` from `apps/web`.
  - A local D1 created by Payload's dev push makes `pnpm web migrate` stop at the "data loss" prompt. Back up `.wrangler/state` and migrate a fresh copy.
  - The build writes the secret to `dist/server/.dev.vars`. It's gitignored, but it's on disk.
  - `/cdn-cgi/local/explorer/api` lists R2 objects and request traces. It shows no CPU time.
- **Env vars on Workers:** varlock only passes variables declared in `apps/web/.env.schema` to workerd. A plugin `SEO_*` variable does nothing there until it's declared (today: `SEO_LLMS_TXT`, `SEO_AUDIT_MAX_DOCS`, `SEO_AUDIT_STEP_DOCS`, `SEO_FETCH_MAX_DOCS`, `SEO_EXTERNAL_LINKS_MAX`, `SEO_EXTERNAL_LINKS_MAX_SUBREQUESTS`, `GSC_OAUTH_CLIENT_ID`, `GSC_OAUTH_CLIENT_SECRET`, `SEO_GSC_ENCRYPTION_KEY`, the `OPENROUTER_API_KEY` / `SEO_AI_*` set, and `SEO_ALERT_WEBHOOK_URL`, `SEO_ALERT_EMAIL`, `SEO_ALERT_SCORE_DROP`, `SEO_ALERT_POSITION_DROP`, `SEO_ALERT_WINDOW_HOURS`).
  - To override a declared variable for one deploy, set it in the shell: `SEO_AUDIT_STEP_DOCS=1 varlock-wrangler deploy`. `--var SEO_AUDIT_STEP_DOCS:1` is silently replaced by the schema's value (empty here). An undeclared variable does pass through `--var`.
- **Cron Triggers after a deploy:** a new or changed schedule can take a few minutes to start firing. On 2026-11-03 the first tick after deploying came at 23:05; the 23:00 tick never fired. Ticks land a few seconds after the minute (`:52` there).
- **`vite preview`** needs `PAYLOAD_SECRET` in the shell env. Enabling features in a local config regenerates `importMap.js` on build; revert it before committing.
- **One site per SEO_D1:** the SQL store uses one table set per database, so don't point two sites at the same SEO_D1.
- **`node:dns` in workerd** returns CNAME targets mixed into the answers (`www.wikipedia.org` gives `["dyna.wikimedia.org.", "185.15.58.224"]`), so never treat resolver output as addresses without parsing it. `resolve4` rejects IP literals. Cloudflare documents `lookup` as not implemented, though it works in local workerd 1.20261023.1.
- **Scheduled jobs have no request origin:** the rank snapshot job needs the `siteUrl` option or `SITE_URL`, and the alerts digest sent by its job carries no `siteUrl` without one (`/alerts-run` falls back to the request origin).
- **A Worker can't fetch another Worker on the same account's `workers.dev`:** the request never reaches it and comes back 404. An alerts webhook (or any outbound URL) pointing at a sibling Worker needs a custom domain or a service binding. Found with a throwaway receiver on 2026-11-04.
- **Live tests of chunked builds:** the dashboard's "force refresh" (`?nocache=1`) is refused for 5 minutes after the last build (`SEO_AUDIT_MIN_REFRESH_MS`) and returns the cached audit. To make a small site pause between steps, deploy with `SEO_AUDIT_STEP_DOCS=1` and `SEO_AUDIT_BATCH_SIZE=1`. Steps stop between DB pages, so a page holding every doc never pauses.

### Visual check (what was used for the UI rebuild)

1. Copy `apps/web` (without `node_modules`) to a scratch directory.
2. Enable every feature there except `gscApi` / `indexNow`.
3. `pnpm install`, then `vite dev --port 3020`.
4. Create a user with `payload run` (pass `overrideAccess: true`).
5. Screenshot each view in both themes with Playwright. Set the `payload-theme` cookie to `dark` / `light` and log in through `POST /api/users/login`.

Nothing from that run is kept; recreate it as needed.

### Workers check (what was used for P0)

1. Seed 300–1500 published pages, each about 550 words with internal and external links, through `payload run` or REST.
2. Exercise every enabled endpoint and admin view with curl and Playwright against the workerd preview.
3. Time the uncached scans. Local workerd enforces no CPU limit, so use the process's CPU time as an upper bound.

Results are in "Done on 2026-11-03".

## Feature matrix

**Port status** means the code compiles and runs on Payload 4 and the UI is rebuilt. **Verified** means exercised in the Node dev server (API calls and/or screenshots). **Workers** is the status in workerd: the enabled features passed in local workerd (`pnpm web preview`), and a deployed Worker passed the same checks on 2026-11-03 (see "Deployed Worker check").

| Feature flag | What it is | In `apps/web` | Port status | Verified (Node) | Workers concerns |
|---|---|---|---|---|---|
| `analyzer` (always on) | Score sidebar on Pages, 50+ rules, Lexical parsing | on | done | yes, live editing and `POST /validate` | none known |
| `dashboard` | `/admin/seo` site audit, filters, bulk actions, CSV/PDF export | on | done | yes | **deployed: pass.** Persisted in R2 and built via `waitUntil` in steps of 800 docs, with the Cron Trigger finishing paused builds (P2 item 9); capped at 5000 docs |
| `redirects` | `seo-redirects` collection, `/admin/redirects`, auto-redirect on slug change, CSV import/export | on | done | yes | **local workerd: pass**, including the frontend 301/302 |
| `sitemapAudit` | `/admin/sitemap-audit`: orphans, weak pages, hubs, broken links (the 404 and External tabs follow `seoLogs` / `externalLinks`) | on | done | yes | **local workerd: pass.** ~0.4 ms per doc uncached, persisted in R2 |
| `settings` | `seo-settings` collection, `/admin/seo-config` | on | done | yes | **local workerd: pass**, including saving |
| *(always on)* | `GET /api/seo-plugin/sitemap.xml`, `robots.txt`, `llms.txt`, news/image/video sitemaps | on | done | yes | **local workerd: pass.** Served at `/sitemap.xml`, `/robots.txt` and `/llms.txt`; `llms.txt` needs `SEO_LLMS_TXT=1`. Without `SITE_URL` they use the request origin |
| `cannibalization` | `/admin/cannibalization` | off | UI done | renders (empty data) | whole-site scan; **backlog** (see Backlog) |
| `keywords` | `/admin/keyword-research` + AI content brief | off | UI done | renders (empty data) | whole-site scan, **backlog**; the brief runs on AI (`aiFeatures`, verified) |
| `linkGraph` | `/admin/link-graph`, crawl budget | off | UI done | renders with data | whole-site scan, **backlog**; client-side force simulation is fine |
| `schemaBuilder` | `/admin/schema-builder` JSON-LD builder, `GET /schema-generator` | on | done | renders | **deployed: pass** (2026-11-04). The view renders with a live preview; `/schema-generator` answers in ≤ 1.3 s and now uses the request origin and `collectionRoutes` (it printed `http://localhost:3000` URLs) |
| `duplicateContent` | duplicate content endpoint | off | compiles | no | whole-site scan; **backlog** |
| `externalLinks` | outbound link checker (SSRF-guarded) | on | done | no (workerd instead) | **deployed: pass** (P2 item 13). The guard uses `resolve4`/`resolve6` on Workers, `lookup` on Node. Capped at 100 links (`SEO_EXTERNAL_LINKS_MAX`) and 1000 subrequests per call (`SEO_EXTERNAL_LINKS_MAX_SUBREQUESTS`), 5 at a time; a scan that doesn't fit resumes from results saved in R2, and a finished scan is cached. The External tab doesn't show `capped`/`partial` yet |
| `aiFeatures` | generate meta, optimize, rewrite, alt text, content brief (OpenRouter Chat Completions via `fetch`) | on | done | yes, with a real key | **deployed: pass** (P2 item 11): all six endpoints, alt text on an R2 image, the sidebar's "Optimize with AI"; ≤ 0.2 s CPU per call. Needs `OPENROUTER_API_KEY` as a Worker secret, with a credit limit on the key as the spend cap. Alt text reads the image through Payload's file route in-process (R2), not over the network |
| `performance` | `seo-performance` collection, GSC CSV/JSON/XLSX import, `/admin/performance` + 9 panels (CWV, indexation, content grade, CTR, alt text, health…), `/indexation-audit` | on | UI done | renders with empty data | **deployed: pass.** Rows in SEO_D1 through `dataStore` (P2 item 10; CSV import + read), pruned after 490 days / 100k rows. XLSX import only works if the host maps `xlsx`. `/indexation-audit` is cached and capped |
| `scoreHistory` | score snapshot on every save + chart | on | done | no (workerd instead) | **deployed: pass.** Rows in SEO_D1 through `dataStore` (P2 item 10; snapshot on save + `/history`), pruned after 365 days / 50k rows. The snapshot write is kept alive with `waitUntil` |
| `seoLogs` | 404 log, admin 404 tab | on | done | no (workerd instead) | **deployed: pass.** Rows in SEO_D1 through `dataStore` (P2 item 10). `apps/web` records 404s in-process from `resolveRedirect` via `waitUntil`. Capped at 5k rows (`SEO_LOGS_MAX_ROWS`) and 90 days. Record, repeat count, list, ignore, delete pass |
| `gscApi` | Google Search Console OAuth, rank tracker (`seo-gsc-auth`, `seo-rank-history`) | off | compiles | no | token crypto is WebCrypto (AES-GCM + HKDF), **verified on a deployed Worker**; legacy `v1` tokens decrypt through a lazy `node:crypto`. The redirect URI uses `siteUrl`, then `SITE_URL`, then the request origin. Rank history rows go to SEO_D1 (400 days / 100k rows). `seo-gsc-auth` stays a collection in the main D1 and needs a migration when the feature is enabled. The endpoints haven't run on a deployed Worker, and the OAuth flow hasn't been run against Google (needs an OAuth client) |
| `alerts` | digest via webhook/email, panel on `/admin/performance` | on (no channel) | done | no (deployed instead) | **deployed: pass** (2026-11-04): preview, "send now" and the scheduled `seoAlertsDigest` job delivered to a webhook (96 ms CPU per run). Email needs a Payload email adapter (none in `apps/web`). Nothing is sent until `SEO_ALERT_WEBHOOK_URL` / `SEO_ALERT_EMAIL` is set |
| `indexNow` | ping search engines on publish | off | compiles | no | needs `SEO_INDEXNOW_KEY`; **backlog** (item 23) |
| `warmCache` | pre-builds the audit on startup | off | **skipped on Workers by design** | n/a | not meaningful on Workers |
| `retentionDays` (option) | daily purge of time-series data | not set (defaults apply) | done | no | **mandatory** for enabled time-series features (defaults in `RETENTION_DEFAULTS`, overridable with `retentionDays` / `retentionMaxRows`; an invalid value means the default, never "delete everything"). Runs as the daily `seoRetentionPurge` job against the store (04:00 UTC). Deployed: `POST /retention` deleted only the stale rows of each dataset, and the Cron Trigger queued the job |
| meta fields (`autoCreateMetaFields`) | the plugin's own meta title/description/image/overview/SERP preview fields | not used (`@payloadcms/plugin-seo` owns the SEO tab) | UI done | jsdom tests only | none |

## Missing compared to the original plugin

Upstream behaviour that doesn't work, or has no equivalent, in this fork today:

1. *(done, P2 item 9)* **Background schedulers.** Upstream starts `setInterval` jobs in `onInit`: cache warm-up, rank tracker, alerts digest, retention purge. With the `jobs` option they run as scheduled Payload jobs instead (a host Cron Trigger calls `runSeoJobs`). Without it they still run as timers under Node and are skipped on Workers. Cache warm-up has no job, since it isn't meaningful on Workers.
2. **Next.js frontend helpers.** `buildSeoMetadata()` still returns a Next.js `Metadata` object. `apps/web` builds its meta tags from `@payloadcms/plugin-seo` and its JSON-LD in `src/utilities/pageJsonLd.ts` (with `buildJsonLd` / `serializeJsonLd`). There's no generic TanStack `head()` adapter in the package.
3. *(done, P2 item 10)* **404 logging.** `apps/web` records 404s from `resolveRedirect` (`redirects.functions.ts`) with the exported `recordSeoNotFound`. It does nothing while `seoLogs` is off.
4. *(done)* Root sitemap/robots/llms.txt: `apps/web/src/app/{sitemap[.]xml,robots[.]txt,llms[.]txt}.ts` hand the request to Payload's API handler in-process (`servePluginFile.ts`).
5. **Build-time audit cache** (`auditCacheFile`, `buildAuditToFile()`): Node only. It's ignored with a warning when `cacheStore` is set or on Workers.
6. **E2E harness.** `e2e/` and `e2e/ui/` are upstream's Next.js 16 + Payload 3 test apps. They're not workspace members (only `packages/*` is) and don't run. Its package scripts were removed.
7. **Locales.** Analysis and UI strings are French and English only (`SeoLocale = 'fr' | 'en'`). Other admin languages fall back to English.
8. **Publishing.** The package is `private`. Upstream's npm release flow, `prepublishOnly`, CI and dependabot were removed.
9. **`scripts/uninstall.mjs`** (upstream `bin`): kept but not checked against Payload 4 / D1.

## Remaining work, prioritised

### Done on 2026-11-03 (P0 + P1)

1. **Ran in workerd.** Every enabled feature passed in local `pnpm web preview`: sidebar `/validate`, the dashboard audit (202 then 200, survives a restart, invalidated by saves), redirect CRUD and auto-redirect, frontend 301/302, sitemap audit, settings, root files, JSON-LD, and the admin views with no console errors. No Node API failures and no unhandled rejections showed up.
   - Fixes found during the run: the sitemap-audit tabs now follow `seoLogs` / `externalLinks`, `SEO_LLMS_TXT` is declared in `.env.schema`, and the bulk-301 buttons are translated.
   - Worker bundle: `dist/server` is about 19.7 MB raw, ~4.4 MB gzipped (fine on the paid plan). The AWS SDK chunks were removed later (see the leftovers section).
   - The deployed Worker check came later; see below.
2. **Dashboard audit on Workers.** There's a new `cacheStore` option (`get` / `put` / `delete` on strings) and a `waitUntil` option, both exported as types. `apps/web/src/plugins/seoCacheStore.ts` backs the store with R2 under `seo-analyzer/cache/`.
   - `SeoSharedCache` (`cache.ts`) persists `audit`, `sitemap-audit` and `redirect-chains` as `entry/<key>`. Keys include the locale and a hash of the config.
   - Invalidation is a random generation token per base (`gen/<base>`) that every isolate reads.
   - Single-flight across isolates is best effort, through a `build/<key>` marker that counts as dead after 2 min (`SEO_AUDIT_BUILD_STALE_MS`). With `waitUntil`, the build drops its throttling pauses.
   - Cache invalidation used to live inside the score-history hook, so it never ran with `scoreHistory: false`. It's now its own hook (`hooks/invalidateSeoCaches.ts`) on the target collections, redirects and settings.
   - Without `cacheStore`, Node hosts behave as before.
3. **Whole-site scans measured** in local workerd, as workerd process CPU (an upper bound):
   - The audit takes ~3.5 ms per doc: 1.25 s at 300 docs, 5.2 s at 1500, ~17 s extrapolated to 5000.
   - The uncached sitemap audit takes ~0.4 ms per doc, and `sitemap.xml` ~0.35 ms per doc. Cached reads take 10–25 ms.
   - The stored audit is 1.1 MB at 1500 docs.
   - **Verdict:** comfortable at the default caps (audit 1500, other scans 5000). An audit of more than ~3000 docs won't reliably fit one `waitUntil` (≈30 s of wall time in production). `SEO_AUDIT_MAX_DOCS` and `SEO_FETCH_MAX_DOCS` are declared so they can be tuned.
4. **Frontend redirects.** Redirects are looked up only when the page lookup misses, so existing pages never hit D1 for them.
   - The whole table is cached per isolate for 60 s.
   - Multi-segment paths go through a catch-all route.
   - Matching is case-insensitive and ignores trailing slashes. The query string is kept.
   - Targets follow the `redirectSafety.ts` policy.
5. **Root `/sitemap.xml`, `/robots.txt`, `/llms.txt`.** These fall back to the request origin when neither the `siteUrl` option nor `SITE_URL` is set.
6. **No hard-coded paths.**
   - `hooks/useSeoApi.ts` (`useSeoApi`, `usePayloadApi`, `useAdminRoute`) builds URLs from `routes.api` plus `endpointBasePath`, which is forwarded in `admin.custom.seoAnalyzer`.
   - Admin links use `formatAdminURL`.
   - `noHardCodedPaths.test.ts` guards both.
7. **Env vars.** `helpers/siteUrl.ts` resolves the site URL from the `siteUrl` option, then `SITE_URL`, then a fallback. No `NEXT_*` / `PAYLOAD_PUBLIC_*` reads are left, and a test guards that.
8. **JSON-LD in `head()`.** Pages get WebPage and BreadcrumbList; home gets WebSite, Organization and WebPage. `buildJsonLd`'s breadcrumb label defaults to "Home" (`homeLabel` / `locale` options).

### Next: left over from P0/P1

- **Deployed Worker check (done 2026-11-03).** Deployed with `pnpm web run deploy` to `cargo-template.pedrsntana.workers.dev` (D1 `cargo-template`, R2 `cargo-template-media`), then checked over REST with a user API key.
  - **Passed:** sidebar `/validate`, `check-keyword`, `suggest-links`, the dashboard audit (202, then 200 from R2), redirect CRUD, frontend 301 (query kept), `redirect-chains`, the sitemap audit, settings save, root `/sitemap.xml` and `/robots.txt` with absolute URLs, JSON-LD on pages, and every admin view. Startup is 17–26 ms and the bundle is 4.4 MB gzipped. `PAYLOAD_SECRET` is stored as `secret_text`.
  - **CPU at 1,500 pages** (from Workers Observability `cpuTimeMs`):

    | Request | CPU | Wall |
    |---|---|---|
    | Cold audit build (`waitUntil`) | 15.7 s | 22.7 s |
    | `indexation-audit` | 12.7 s | 17.5 s |
    | Uncached `sitemap-audit` | 1.2 s | 4.3 s |
    | Uncached `sitemap.xml` | 0.9 s | 2.8 s |
    | Cached reads, `/validate`, admin views | ≤ 0.2 s | — |

    The audit costs ~10 ms CPU per doc deployed, about 3× the local workerd estimate. With the default 30 s CPU limit it fails above roughly 2,800 docs. No request hit the memory limit.
  - **Fixed:** the `/breadcrumb` endpoint returned `http://localhost:3000` URLs; it now falls back to the request origin, and its default home label follows the locale.
- **Admin login on Workers (fixed outside the plugin).** Payload `4.0.0-beta.6` (and `canary.39`) hash passwords with PBKDF2-SHA256 at 600,000 iterations. Deployed Workers fail with `Pbkdf2 failed: iteration counts above 100000 are not supported`, and Payload swallows the error, so every login looked like a wrong password.
  - `patches/payload@4.0.0-beta.6.patch` (pnpm `patchedDependencies`, same patch as our other Payload 4 Workers apps) writes new hashes as `pbkdf2-sha256-v2-i100000-l32:` (the format proposed in payloadcms/payload#18461). It still verifies v1 (600,000) hashes where the runtime allows it, and rehashes them on login.
  - v1 hashes can't be verified on Workers. Reset such passwords from Node (Local API with `PAYLOAD_MIGRATE_REMOTE=true`) or log in once through the Node dev server against the same database.
  - Verified on the deployed Worker: password login, wrong-password 401, a password changed through the Worker, and the full SEO check over a cookie session.
### Done on 2026-11-03 (P0/P1 leftovers)

Branch `fix/seo-analyzer-p1-leftovers`. Checked in local workerd (`vite preview`) on a fresh D1 with 620 seeded pages, plus unit and integration tests.

- **`indexation-audit`** is registered with `performance` (the only view that calls it), cached like the audit (persisted base `indexation-audit`, invalidated with content and settings), capped at `SEO_AUDIT_MAX_DOCS` (the response says `capped`), and only runs the `technical` rule group on slug/canonical/robots at depth 0. A test checks that the technical checks match a full analysis. The panel's Refresh asks for a rescan (`?nocache=1`, SEO admins only).
- **Trailing slashes:** `apps/web/src/start.ts` adds a request middleware that answers `/foo/` with a 308 to `/foo` (query kept) before TanStack's hard-coded 307. `/admin` and `/api` are left alone. A `/foo/` that has a `seo-redirect` takes two permanent hops (308, then 301), because pages still win over redirects. Defining a start instance replaces TanStack's default CSRF middleware for server functions, so `start.ts` adds it back (checked: a cross-site server-fn POST still gets 403).
- **Dashboard paging:** the dashboard requests 500 results per page and fetches the remaining pages of the cached audit (`noBuild=1`). Verified: "620 results displayed".
- **Readability:** the audit uses the analysis locale's Flesch formula, like the sidebar. The 620-page local seed averages 94 with the English formula. The persisted audit key moved to `v: 2`, so old scores aren't served after deploy.
- **"View pages" link:** `check-keyword` returns document ids; links go to `/collections/<slug>/<id>`, or `/globals/<slug>`.
- **`homeLabel`:** no default. Empty means the locale's label ("Home" / "Accueil") in `/breadcrumb`, `buildJsonLd` and the settings preview. Migration `20261103_162036_seo_breadcrumb_home_label` drops the column default and clears stored `Accueil` values (this app is English; a custom label is kept).
- **Rate limiting:** new `rateLimit` plugin option (`SeoRateLimit`, buckets and limits in the exported `SEO_RATE_LIMITS`). `apps/web` backs `expensive`, `audit-poll` and `ai-interactive` with Workers Rate Limiting bindings (`ratelimits` in `wrangler.jsonc`, `src/plugins/seoRateLimit.ts`). A bucket without a binding, or a binding that throws, falls back to the in-memory limiter, and a throw is logged once. Other per-isolate caches (rendered sitemaps, the suggest-links index, disabled features' caches) stay per isolate, bounded by their TTL.
- **R2 hygiene:** `pnpm web r2:lifecycle` adds a rule that expires `seo-analyzer/cache/` objects after 7 days. Applied to `cargo-template-media` on 2026-11-03 (rule `seo-analyzer-cache`, next to the default multipart-abort rule). An expired key that's still in use (a generation marker on a site with no edits for a week) only costs a rebuild.
- **Bundle:** the AWS SDK came from `@payloadcms/storage-r2`'s `copyFile`, which lazily imports `@aws-sdk/client-s3` and only runs with `copyCredentials`. The Workers build resolves both imports to a stub (`vite.config.ts`). Server JS went from 19.2 MB to 18.0 MB raw, with no AWS chunks left. Remove the stub if you pass `copyCredentials`.
- **Shared entry:** `@cargo/payload-seo-analyzer/shared` exports `buildJsonLd`, `serializeJsonLd`, `validateRedirectTarget` and `normalizeFromPath` with no package imports (`sharedEntry.test.ts` guards it). `apps/web` imports the JSON-LD helpers statically and reuses the redirect policy instead of mirroring it.

### Next

- **Deployed Worker check (done 2026-11-03, version `eb5638d3`).** Deployed with `pnpm web run deploy` (plain `pnpm web deploy` runs pnpm's built-in `deploy` command and fails). The site had 2 pages, so paging was checked with `limit=1`.
  - **Passed:**
    - The remote migration ran and `breadcrumb_home_label` is `NULL`. `/breadcrumb` says "Home".
    - The trailing-slash 308 keeps the query and works for GET and HEAD. `/admin/` keeps Payload's own 307, and `/api/` is left alone. A cross-site server-fn POST gets 403.
    - `indexation-audit` is a 404 (`performance` is off).
    - The audit rebuilt once under the `v: 2` key (202, then 200), with readability 77 and 81. Paging ends on an empty page.
    - `check-keyword` returns ids.
    - A redirect at `/old/` takes 308, then 301, with the query kept.
    - `sitemap.xml`, `robots.txt` and JSON-LD (WebPage, BreadcrumbList) are fine.
    - The Worker bundle is 4.1 MB gzipped (was 4.4 MB), and startup is 14 ms.
  - **Rate limits are approximate.** The bindings work, with no fallback warning in the logs: over one kept-alive connection, the expensive bucket returned 429 from the ninth call on. But 42 calls over separate connections in a minute all got 200, because Workers Rate Limiting counts per machine and syncs those counts eventually ("permissive, eventually consistent"). That's still stricter than per-isolate counters, but treat `SEO_RATE_LIMITS` as a brake on runaway clients, not a hard cap. Hard caps on spend (AI, P2 item 11) have to come from somewhere else, such as a daily budget stored in D1 or KV.
- **Chunked audit builds for big sites:** done in P2 item 9.

### P2: before enabling the off-by-default features

Order agreed on 2026-11-03: foundations first: 9 (done) → 10 → 12 → 13 → 11. Items 10, 12 and 13 shipped together in one PR (2026-11-04), then 11 (OpenRouter).

9. **Schedulers → Payload jobs + Cron Triggers. Done (PR #10, merged as `dfc8165`).**
   - New `jobs` plugin option (`src/jobs.ts`). It registers Payload tasks with schedules on the `seo` queue: `seoAuditContinue` (every 5 min), plus `seoRankSnapshot`, `seoAlertsDigest` and `seoRetentionPurge` (daily, only when their feature is on). With `jobs`, `onInit` starts no timers; without it, the Node `setInterval` path is unchanged. `runSeoJobs(payload)` queues the due tasks and runs the queue without access checks.
   - **Chunked audit builds:** with `waitUntil`, a build step stops after `SEO_AUDIT_STEP_DOCS` docs (800) or `SEO_AUDIT_STEP_MS` (20 s), checked between DB pages. It then saves its cursor and partial results at `progress/<key>` in the cache store and marks the build paused (`pausedAt`, `processed`). A paused build counts as building, so each dashboard poll (and each `noBuild=1` peek) runs the next step, and the 202 says how many docs are done. `seoAuditContinue` only resumes paused builds and never starts one. A pause with no new step for 1 h (`SEO_AUDIT_PAUSED_STALE_MS`) is abandoned. Pages are read with `sort: 'id'` so they line up across steps. Without `waitUntil` (Node) a build is one step, as before.
   - Caps: the dashboard audit's `SEO_AUDIT_MAX_DOCS` default went from 1500 to 5000. `/indexation-audit` still scans in one request, so it got its own `SEO_INDEXATION_MAX_DOCS` (default 1500).
   - `apps/web`: `src/server.ts` is the Worker entry (`main` in `wrangler.jsonc`). It wraps TanStack Start's `fetch` and adds `scheduled`, which calls `runSeoJobs`. Pointing `main` at `@tanstack/react-start/server-entry` bypasses `src/server.ts`. Cron Trigger `*/5 * * * *`. Migration `20261103_201707_seo_jobs` adds `payload_jobs`, `payload_jobs_log` and `payload_jobs_stats`. `deleteJobOnComplete` keeps them near-empty.
   - Payload queues a scheduled task for the cron's next run time (counted from `lastScheduledRun` in `payload_jobs_stats`). So the first tick only queues, the second runs, and from then on each tick queues and runs in one go.
   - Known limit: a save during a multi-step build makes the finished audit stale (same generation rule as before), so on a site edited every few minutes a big audit may keep rebuilding. See P3 item 21.
   - Verified in local workerd (620 pages, `SEO_AUDIT_STEP_DOCS=200`): dashboard polls went 200 → 400 → 600 → 620 done. With no requests, one Cron tick (`/cdn-cgi/handler/scheduled`) ran `seoAuditContinue` and moved a paused build from 400 to 600 docs, and the finished job was deleted.
   - **Verified on the deployed Worker** (2026-11-03, master `dfc8165`, versions `2304ec72` and `f7b34497`): the remote migration added the three jobs tables, and the deploy registered `schedule: */5 * * * *`. From the `wrangler tail` logs:

     | Tick (UTC) | Log | CPU | Wall |
     |---|---|---|---|
     | 23:00 | none: the new schedule wasn't firing yet | – | – |
     | 23:05 | `queued 1, ran 0` | 58 ms | 2.4 s |
     | 23:10 | `queued 0, ran 1` | 158 ms | 3.5 s |
     | 23:15 | `queued 1, ran 1` | 147 ms | 8.5 s |
     | 23:20 | `queued 1, ran 1` (finished the paused build below) | 173 ms | 7.1 s |

     No exceptions. Wall time is mostly Payload start-up. Paused build: the site has 2 pages, so a temporary deploy set `SEO_AUDIT_STEP_DOCS=1` and `SEO_AUDIT_BATCH_SIZE=1`. One `?nocache=1` request returned 202, and the step stopped after 1 doc (`pausedAt`, `processed: 1`, progress at page 2 in R2). No requests followed. The 23:20 tick finished it: the marker kept only `lastBuildAt`, `progress/` was deleted, and a `noBuild=1` peek returned both pages (200). The master build was then redeployed without the test variables.
10. **Keep D1 small. Done (2026-11-04, verified on the deployed Worker).** Time-series data goes to a second D1 database (`SEO_D1`), never the main one.
    - **`dataStore` option** (`SeoDataStore`, `src/store/`): domain sub-stores `scoreHistory`, `performance`, `rankHistory`, `notFound`, plus `prune`. `createSqlSeoDataStore(db)` takes anything shaped like D1 (`prepare`/`bind`/`all`/`run`/`batch`); `apps/web` passes `cloudflare.SEO_D1`. Bulk writes are multi-row inserts under D1's 100-parameter cap, sent in batches.
    - With `dataStore` set, the four `seo-*` time-series collections aren't registered. Without it, the plugin falls back to them (`createPayloadSeoDataStore`), so Node hosts keep working unchanged; on Workers `onInit` logs a warning.
    - Every reader and writer goes through the store: the score hooks, `/history`, `/performance`, `/rank-snapshot`, `/rank-history`, `/seo-logs`, the alerts digest, the audit trend, cannibalization, `/health` and retention. Endpoints get the store explicitly; deep audit code and the host's 404 recorder find it through server-only `config.custom.seoAnalyzer.store` (a test checks it isn't in `admin.custom`).
    - **Schema:** append-only SQL migrations in the plugin (`SEO_STORE_MIGRATIONS`), recorded in `seo_store_migrations`. The store applies pending ones on its first query per isolate; `migrateSeoStore(db)` applies them ahead of time (`pnpm web seo-store:migrate[:remote]`, the remote one part of `deploy:database`).
    - **Retention is mandatory** for enabled features: rank history 400 days / 100k rows, score history 365 / 50k, performance 490 / 100k, 404 logs 90 / 5k. A dataset whose feature is on is pruned with the defaults even if `retentionDays` doesn't name it; hosts can only lengthen the window. The purge job, timer and `/retention` routes exist whenever one of these features is on.
    - **404s stay in SQL**, not Analytics Engine: the admin needs to upsert, ignore, delete and sort by count.
    - Verified: 831 plugin tests at the time (14 new ones run the SQL store on `node:sqlite` behind a wrapper with D1's limits), app int tests, and `migrate:create --skip-empty` finds no main-D1 changes with `performance`, `scoreHistory` and `seoLogs` on. In local workerd, one write and one read per feature passed, the main D1 got none of the four tables, and a Cron tick queued the jobs without errors. Rank history rows were written with the store's `insertDaily` from Node, because `/rank-snapshot` needs a GSC account.
    - **Open:** the 404 recorder bypasses the `seo-logs` rate limit (growth is bounded by the row cap; each new URL costs one `COUNT(*)` over ≤5k rows). Consider filtering bots.
    - **Production database:** `cargo-template-seo` (`bf11c24a-599f-42c8-b700-de5f56c3a377`, WEUR, no jurisdiction, like the main D1), created with `cf d1 create` on 2026-11-04. `pnpm web run deploy` applied the store's schema remotely (`seo_logs`, `seo_performance`, `seo_rank_history`, `seo_score_history`, `seo_store_migrations`).
    - **Verified on the deployed Worker** (2026-11-04, versions `06d69b4b` with the four features on, then `42c48bb1` from this branch). Checked over REST with a temporary API-key user, deleted afterwards. All test rows were cleared.
      - `scoreHistory`: a page save wrote a snapshot through `waitUntil`, and `/history` returned it.
      - `seoLogs`: two frontend 404s were recorded (query stripped, referrer and user agent kept), a repeat hit raised the count to 2, and ignore and delete worked.
      - `performance`: a CSV import (`imported: 2`) read back with its summary through `GET /performance`.
      - The rows were in SEO_D1 (checked with `cf d1 query`). The main D1 has only the `seo_settings*` and `seo_redirects*` tables, and `migrate:create --skip-empty` finds no main-D1 changes with the four features on.
      - Retention: stale rows inserted directly (2024 score and performance rows, a January 404) were the only ones `POST /retention` deleted, one per dataset. The first Cron tick queued `seoRetentionPurge` for 04:00 UTC, so the scheduled run itself wasn't observed.
      - `/admin/performance`, `/admin/seo` and `/admin/sitemap-audit` return 200. Over the whole session `wrangler tail` showed no exceptions, errors or warnings (other than Payload's "no email adapter"). The new endpoints used at most 9 ms CPU, and Cron ticks 72–118 ms.
11. **AI features on OpenRouter. Done (2026-11-04; verified on the deployed Worker with a real key).** The Anthropic Messages API calls are replaced by OpenRouter's OpenAI-compatible Chat Completions, so any OpenRouter model works; Claude stays reachable as `anthropic/…`.
    - **One client:** `helpers/aiClient.ts` (`aiChat`) is used by `/ai-optimize`, `/ai-optimize-bulk`, `/ai-rewrite`, `/ai-alt-text` and `/ai-content-brief` (`/ai-generate` stays heuristic). `helpers/aiModel.ts` is gone. `/ai-rewrite` no longer pins Haiku and now accepts numeric ids (D1).
    - **Default model** `deepseek/deepseek-v4.1-flash` (`DEFAULT_AI_MODEL`): open weights, ~40 providers on OpenRouter, image input (alt text) and structured outputs, $0.045 / $0.50 per M tokens in/out at the time. Any override (`SEO_AI_MODEL`) must support structured outputs, and image input for alt text.
    - **Request:** system + user messages; `reasoning: { enabled: false }` by default (`SEO_AI_REASONING` raises it, for models that can't turn it off); `provider.data_collection: 'deny'` by default (`SEO_AI_DATA_COLLECTION=allow` lifts it), since prompts carry page content, drafts included. Optimize and brief send a strict `json_schema` `response_format` with `provider.require_parameters: true`; the defensive parsers and the server-side clamps stay.
    - **No usable answer** (refusal, `content_filter`, `length`, empty content) is `null`: meta endpoints fall back to the heuristics, alt text and briefs answer 502. HTTP and error-body failures throw `AiRequestError` (status kept, body truncated, never the key).
    - **Alt text** reads the image through Payload's own `/<collection>/file/<filename>` route in-process (`handleEndpoints`, with the caller's cookie/authorization), so it comes from R2 on Workers and from disk on Node, never over the network (subrequests to the Worker's own origin are unreliable). Only when that route has no file does it fetch the URL, behind the origin allowlist, which now falls back to the request's origin. The image goes as an `image_url` data URL.
    - **Bulk** runs 4 pages at a time (`BULK_CONCURRENCY`) instead of one by one; results keep the request's order. 100 pages at ~2 s per call is about a minute.
    - **Spend cap:** the plugin's rate limits are approximate on Workers (see the deployed check above). The hard cap is a credit limit on the OpenRouter key, set in OpenRouter.
    - **Env** (declared in `apps/web/.env.schema`): `OPENROUTER_API_KEY` (`@sensitive`), `SEO_AI_MODEL`, `SEO_AI_BASE_URL` (e.g. Cloudflare AI Gateway's OpenRouter endpoint, for logs and caching), `SEO_AI_REASONING`, `SEO_AI_DATA_COLLECTION`. UI strings, `/health` and the README/threat model now name OpenRouter.
    - **Verified:** 17 new tests (`aiClient.test.ts`: config, request body, response parsing, errors, optimize fallback, alt text in-process read and fallback, bulk concurrency and order), 947 plugin tests in all. In local workerd (fresh D1, `aiFeatures` on, `SEO_AI_BASE_URL` pointed at a mock OpenRouter in Node): all five endpoints returned `method: "ai"` / model answers; alt text sent the full 7,858-byte PNG read from local R2 as a data URL with no network fetch of the image; optimize and brief sent their schemas with `require_parameters`; `/health` reported the key and model; `/admin/seo` and `/admin/performance` returned 200; no errors in the log. No `migrate:create` change: the feature adds no collections.
    - **First live run** (Node dev server, real OpenRouter key, 2026-11-04): "Optimize with AI" got a DeepSeek V4.1 Flash answer through `data_collection: 'deny'` + `require_parameters`. Fixed from that run:
      - "Generate meta" (`/ai-generate`) never calls the model: it's the template generator, whose templates were French only. `helpers/metaGeneration.ts` now has English templates, and `/ai-generate`, `/ai-rewrite` and the `/ai-optimize` fallback follow the analysis locale (default `fr`, like the analyzer).
      - The prompts asked for "the page's language", and a four-word page came back with an Italian rationale. Every prompt now names the analysis locale's language (`aiLanguageName`).
      - "Optimize with AI" was always disabled: the sidebar read the document id from the form state, which Payload 4 doesn't fill. It now uses `useDocumentInfo()` (id and collection), which also fixes the duplicate-keyword check and internal-link suggestions excluding the current page.
      - With `aiFeatures` off, the sidebar's AI buttons and the dashboard's "Optimize site" / bulk "Optimize meta" stayed visible and answered 404. They now follow `features.aiFeatures`.
    - **Verified on the deployed Worker** (2026-11-04, versions `28a9c37f`, then `af15d6ba` with the prompt fix). `aiFeatures` is on in `apps/web`. `varlock-wrangler deploy` uploads `OPENROUTER_API_KEY` from `apps/web/.env` as a `secret_text`; the key has a $5 credit limit in OpenRouter. Checked over REST with a temporary API-key user and a 960×720 JPEG uploaded to R2, both deleted afterwards:
      - `/health` reports the key and the model. `/ai-generate` (templates), `/ai-optimize`, `/ai-rewrite` (title and description), `/ai-content-brief` and `/ai-optimize-bulk` (2 pages) all answered `method: "ai"`. `/ai-alt-text` described the photo correctly ("White cup of black coffee on a saucer with a spoon…"), reading it from R2 in-process, and `apply: true` saved it.
      - In the admin, the page sidebar shows "Generate meta" and "Optimize with AI", and the suggestions panel fills in. `/admin/seo`, `/admin/performance` and `/admin/sitemap-audit` return 200, with no page errors.
      - From `wrangler tail`: 8–192 ms CPU per call (the high end is a cold start), 0.9–4.6 s wall (the model). No exceptions.
      - Routing: with `data_collection: 'deny'` (+ `require_parameters` for schemas) the calls went to Relace, an fp4 endpoint, the cheapest of 40. The whole check, probes included, cost about $0.0025.
    - **Fixed from that run: the optimize prompt invented numbers.** The engine's issues ("No number in the title…") were passed as "fix these", against the rule "never invent numbers". On the 2-sentence demo page, 7 of 8 direct runs (and the deployed optimize and bulk calls) titled it "5 Essential Tips/Steps", and half the rationales argued for a focus-keyword change that `sanitizeSuggestions` then dropped. The prompt now calls the issues hints, allows a number or a question title only when the content supports it, and pins an editor's focus keyword. After: 0 of 12 invented numbers, no keyword talk; a page with "3 steps" still gets "3 Simple Steps"; French output reads naturally (0 of 4). A test in `aiClient.test.ts` guards the rules.
    - **Open:**
      - Titles still lean on the power words the engine asks for ("The Ultimate Guide…") on thin pages. Fine on real content; revisit if editors complain.
      - fp4 endpoints served everything and the output was good. If quality drops on long pages, pin providers or quantizations through `provider` (not exposed yet).
      - The alt-text system prompt only knows French and English (`seoConfig.locale`).
12. **GSC on Workers. Done (2026-11-04; the crypto is verified on a deployed Worker, the endpoints aren't).**
    - `node:crypto` `scryptSync` and AES-GCM work in local workerd (22 ms CPU per scrypt at N=16384, r=8, 16 MiB). They were dropped anyway: deployed limits can't be checked locally (see the PBKDF2 patch), and scrypt costs CPU on every call.
    - `helpers/tokenCrypto.ts` is WebCrypto: AES-256-GCM with a key from HKDF-SHA-256, format `v2:<salt>:<iv>:<ct+tag>`. The key comes from `SEO_GSC_ENCRYPTION_KEY` (32 bytes, hex or base64) or Payload's secret. Legacy `v1:` tokens decrypt through a lazy `import('node:crypto')`; without it, the error says to reconnect GSC. Wrong keys and tampering throw explicit errors, and `getGscAccessToken` logs the cause (never the token or key). The `v1` reader can go in a later major version.
    - `safeEqual` is a pure constant-time compare, and the OAuth state uses `crypto.getRandomValues`.
    - Redirect URI: `siteUrl` option → `SITE_URL` → the request origin (`resolveGscSiteUrl` / `getGscOAuthConfig` take an optional `req`), with paths from `routes.api` plus the plugin base path. There were no `NEXT_*` reads left.
    - `GSC_OAUTH_CLIENT_ID`, `GSC_OAUTH_CLIENT_SECRET` and `SEO_GSC_ENCRYPTION_KEY` are declared in `apps/web/.env.schema`.
    - **Token crypto on a deployed Worker** (2026-11-04): a throwaway Worker (`seo-check-token-crypto`, same compatibility date and `nodejs_compat` as the app, deleted afterwards) bundled `tokenCrypto.ts` and ran:
      - v2 round trips with `SEO_GSC_ENCRYPTION_KEY` (read from `process.env`, populated from a Worker var) and with the secret.
      - v2 tokens encrypted in Node decrypting on the Worker, both keyed and secret-derived.
      - Wrong secret and tampered ciphertext throwing the explicit error.
      - A legacy `v1` token (scrypt + `node:crypto`) decrypting through the lazy import, and its wrong-secret error.
      - `safeEqual`.

      Everything passed at 60–80 ms CPU for the whole set, including two scrypt derivations. Deployed Workers don't reject scrypt the way they reject PBKDF2 above 100k.
    - **Open:** turning on `gscApi` needs a main-D1 migration for `seo-gsc-auth`. Deferred until a Google OAuth client exists. Then run `GET /gsc/status`, `GET /gsc/auth` and a real connect on a deployed Worker. With the origin fallback, the callback may store a request-derived origin as the default `propertyUrl`; a Search Console property may need `sc-domain:` or a trailing slash.
13. **`externalLinks`. Done (2026-11-04, verified on the deployed Worker).**
    - `helpers/ssrfGuard.ts` has a pluggable resolver: `resolve4` + `resolve6` on Workers (documented as supported; `lookup` is documented as not implemented), `lookup` on Node. No direct DoH `fetch`: `node:dns` already does DoH on Workers and costs the same subrequests. If either query fails with anything but "no such record", the lookup fails, so a flaky AAAA can't hide a private IPv6 address.
    - Fixed in the guard: non-IP answer entries (CNAME targets) used to count as public; IP literals skip DNS (workerd's `resolve4` rejected them, so `https://1.1.1.1` failed closed). Every block carries a reason (`private-address`, `dns-not-found`, `dns-timeout`, `dns-error`, `dns-no-address`, `invalid-url`). Hosts resolve once per scan.
    - `helpers/linkChecker.ts`: 5 concurrent links (clamped to 6), HEAD then GET (bodies cancelled), 5 s per request, 12 s per link, 5 redirect hops, no new links after 25 s. Each call checks what fits its budget and saves results under `external-link-checks`; the next call resumes. A finished scan is cached as `external-links` and invalidated on saves. `forceRefresh` now bypasses the cache (SEO admins only). The response has `capped`, `totalFound`, `maxLinks`, `pending`, `partial`, `stoppedBy` and `subrequests`.
    - Verified in local workerd with 20 pages and 50 external links: private/odd addresses blocked (`localtest.me`, `*.nip.io`, decimal/octal/IPv6-mapped loopback, metadata IP), the dead domain reported as `dns`, a capped run, and a budget-limited scan finishing over three calls.
    - **Verified on the deployed Worker** (2026-11-04) with a temporary page of 50 external links, deleted afterwards:
      - Blocked as `blocked-private-ip`: `localhost`, `127.0.0.1`, `localtest.me`, `127.0.0.1.nip.io`, `[::ffff:127.0.0.1]`, `[::1]`, `169.254.169.254`, `10.0.0.1` and `192.168.1.1`.
      - Decimal (`2130706433`) and octal (`0177.0.0.1`) loopback normalise to `127.0.0.1` before the check, so 48 unique links were found.
      - The dead domain was reported as `dns`. A public IP literal (`https://1.1.1.1/`), a 2-hop redirect and normal sites returned 200, and real 404s were broken.
      - A full scan took 92 subrequests and 1.4 s. The next call was `cached: true`. After a save it was rescanned from saved checks with 0 subrequests.
      - A temporary deploy with `SEO_EXTERNAL_LINKS_MAX=20` and `SEO_EXTERNAL_LINKS_MAX_SUBREQUESTS=12` gave `capped: true` (48 found, 20 kept). It stopped at exactly 12 subrequests per call (`stoppedBy: "budget"`) and finished over 7 calls, then was cached.
      - At most 65 ms CPU per call.
    - **Stats gap:** `stats.ok`, `broken` and `timeout` don't count blocked and DNS failures, so they don't add up to `total` (5 + 33 + 0 of 48 in the run above). Add a `blocked` / `error` count.
    - **Open:** whether a slow 25 s step fits through the edge (no slow hosts in the deployed test). Show `capped`/`partial`/`pending` in the External tab and continue partial scans from the button; treat 429/999 as unverified, not broken. On Node the guard can't pin the resolved IP for `fetch` (DNS rebinding gap); on Workers `fetch` can't reach private networks anyway.

### Done on 2026-11-04 (`schemaBuilder`, `alerts`)

Branch `feat/seo-analyzer-schema-alerts`. Both are on in `apps/web`. Checked on the deployed Worker (final version `2165265c`) with a temporary API-key user and seeded `SEO_D1` rows, all removed afterwards.

- **`schemaBuilder`:** `/admin/schema-builder` renders (7 schema types, live JSON-LD preview, copy buttons, no page errors). `GET /schema-generator` returns JSON-LD for both pages, honours `type`, and answers 401 / 403 / 400 / 404 for anonymous callers, other collections, unknown types and missing docs.
  - **Fixed:** without a configured site URL, every `@id` / `url` was `http://localhost:3000/...` (the `/breadcrumb` bug again). The endpoint now falls back to the request origin and passes the plugin's `collectionRoutes`.
  - **Fixed in `buildJsonLd`:** the BreadcrumbList trail was built from the raw slug, so the home page got a second "Home" item at `/home`, and a routed collection lost its prefix (`/my-post` for `/posts/my-post`). It now follows the same public path as every other node. This also feeds the page `head()` JSON-LD in `apps/web` (unchanged for its pages).
  - **Follow-ups:** auto-detection calls every page an `Article` (the home page included); `FAQPage` on a page without Q&A content returns an empty `mainEntity`, which Google rejects; headlines carry the meta title's suffix (same cause as item 19); the builder's example placeholders are French ("Ma Boulangerie") in the English admin.
- **`alerts`:** a digest seeded with a score drop (88 → 61), two 404 URLs and a ranking drop (#4 → #11) came back from `GET /alerts-digest` with 4 issues and shows in the `/admin/performance` panel. `POST /alerts-run` and the `seoAlertsDigest` job both delivered it to a throwaway webhook.site URL: the job ran on the second Cron tick after a temporary deploy that set `dailyCron` to every 5 minutes (96 ms CPU, 5.2 s wall). `SEO_ALERT_*` are now declared in `.env.schema` (the URL and recipients `@sensitive`).
  - **Fixed:** a webhook that answered 4xx/5xx counted as delivered. It's now `delivery_failed` with the status in the log (checked live: a 404 was reported, not swallowed), the request times out after 10 s, the panel shows the failure instead of "Nothing to send", and an `SEO_ALERT_EMAIL` without an email adapter logs a warning.
  - **Fixed:** the webhook payload had no `siteUrl` without `SITE_URL`. `/alerts-run` now uses the request origin; the scheduled digest still needs `SITE_URL` (set it in production).
  - **Fixed:** with the feature on and no channel, the panel said to "enable features.alerts".
  - **Open:** the payload is plain JSON (`{ type, siteUrl, digest }`), which Discord and Slack webhooks reject (they need `content` / `text`). Point it at a relay, or add a Discord/Slack format if that's where it should land.

### Backlog

22. **Whole-site scans** (`cannibalization`, `keywords`, `linkGraph`, `duplicateContent`). Deferred on 2026-11-04 until there's a real site with real content to measure against, planned for the next sprint. The demo site has 2 pages, and a seeded one says little about real link graphs or duplicate rates. Each scan reads every doc in one request, like `/indexation-audit` (12.7 s CPU at 1,500 docs deployed, against a 30 s limit). On the real site: measure each scan's CPU on a deployed Worker, then cap it (`SEO_FETCH_MAX_DOCS`), chunk it like the dashboard audit (P2 item 9), or mark it unsupported on Workers. `duplicateContent` has never run, even on Node.

23. **`indexNow`.** Deferred on 2026-11-04 until the real site exists: once on, every publish pings Bing, Yandex and the other IndexNow engines for the live domain, which is pointless for the demo site. Then: set `SEO_INDEXNOW_KEY` (declare it in `.env.schema`), check `/indexnow-key.txt` at the site root and a submit on publish from a deployed Worker.

### P3: quality and cleanup

14. **Bulk-preview dialog** in `SeoView.tsx`: still a custom overlay without a focus trap or Escape to close. Move it to Payload `Modal` / `useModal`, then drop the last exception in `a11yContract.test.ts`.
15. **PDF export** (`SeoView.tsx`, `handleExportPdf`): builds a standalone HTML document with hard-coded print colours (the only hex left outside the third-party mock-ups). Fine to keep; move it to a template file if it grows.
16. **E2E coverage. Mostly done (2026-11-04).** `apps/web/tests/e2e/seo.e2e.spec.ts` renders the five enabled SEO views (header, admin shell, no error boundary, no page error) and checks the root `sitemap.xml` / `robots.txt`; the base URL and port are configurable (`E2E_PORT`, `E2E_BASE_URL`); CI runs the suite on a D1 built from the migrations. Left: delete upstream's `e2e/` (the dead Next.js harness), and add specs as features get turned on (sidebar score on a page edit, a redirect round trip through the UI).
17. **Docs. Done (2026-11-04).** `README.md` is rewritten for Payload 4 + Workers (setup, options, data store, jobs, env vars without `NEXT_*`, the Workers status of every flag); `docs/THREAT-MODEL.md` got the WebCrypto, resolver and rate-limit changes plus a Workers section (R2 cache contents, in-process 404 recording, data placement). `CHANGELOG.md` stays upstream's history; fork changes are tracked here and in git. Start a fork changelog only if the package is ever published.
18. **Payload UI notes:**
    - `Button` has no `small` size.
    - `Tabs` has no `aria-label`; it's wrapped in `role="group"`.
    - Payload's `Chip` hard-codes its remove label; the settings view uses its own chip for that reason.
    - Revisit these when Payload 4 leaves beta.
19. **Breadcrumb names** (`endpoints/breadcrumb.ts`): items prefer `meta.title` over `title`, so names carry the meta title's suffix ("Coffee brewing basics | Cargo Template"). Prefer `title`, or strip a configured site-name suffix.
20. **Upstream sync:** `git subtree pull --prefix=packages/payload-seo-analyzer https://github.com/pOwn3d/payload-seo-analyzer.git main`. Expect conflicts in `components/*` (rewritten), `views/*`, `plugin.ts`, `rateLimiter.ts` and the collections. The old fork `0xZ0uk/payload-seo-analyzer` is archived; don't push there.
21. **Serve the stale audit while rebuilding.** A save bumps the audit's generation, so the dashboard shows "building" until a full rebuild finishes. A save during a multi-step build also makes that build's result stale on arrival. On a big site edited every few minutes, the audit can keep rebuilding without ever being served. Keep the last finished audit, serve it (marked stale) while the next build runs, and let a finished build count even if a save landed meanwhile.

## Definition of done for "fully ported"

- Every feature flag is either verified in a deployed Worker or explicitly marked unsupported on Workers in this file and in `README.md`. *(Enabled features: done, including the leftovers, P2 item 9, and `performance` / `scoreHistory` / `seoLogs` / `externalLinks` on 2026-11-04. `README.md` has the per-flag status table; `aiFeatures`, `schemaBuilder` and `alerts` are verified too (2026-11-04). Only `gscApi` is still "not checked" (waiting on a Google OAuth client). The whole-site scans and `indexNow` are in the backlog until the real site exists (items 22 and 23).)*
- No unpersisted background work and no module-level caches the UI depends on. *(Done for the enabled features.)*
- No time-series data in the main D1. *(Done: `apps/web` uses `dataStore` with the production SEO_D1, verified on 2026-11-04.)*
- No hard-coded `/api/seo-plugin` or `/admin` paths. *(Done.)*
- No `NEXT_*` environment variables. *(Done in code and `README.md`; only upstream's dead `e2e/` harness still mentions them.)*
- Redirects, `sitemap.xml` and `robots.txt` work on the live site. *(Done on the deployed Worker.)*
- Unit tests, typecheck, lint and an e2e pass over the SEO views run in CI from the repo root. *(Done: `.github/workflows/ci.yml`, 2026-11-04.)*
