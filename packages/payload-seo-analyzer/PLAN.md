# SEO analyzer: port status and plan

Handoff for whoever continues porting `@cargo/payload-seo-analyzer`. Last updated 2026-11-03 (after P0 + P1).

## TL;DR

- This package is a fork of [`@consilioweb/payload-seo-analyzer`](https://github.com/pOwn3d/payload-seo-analyzer) 4.2.2 (Payload 3 + Next.js), ported to **Payload 4 (4.0.0-beta.6)** and to our stack: **TanStack Start on Cloudflare Workers, D1 + R2**.
- **Done:** it compiles and runs on Payload 4, has no Next.js dependency, and its whole admin UI has been rebuilt on `@payloadcms/ui` and Payload 4 tokens.
- **P0 and P1 are done** (branch `feat/seo-analyzer-workers`, 2026-11-03). The core subset `apps/web` enables (editor sidebar, dashboard, redirects, sitemap audit, settings, sitemap/robots/llms.txt) is **verified in local workerd** (`pnpm web preview`).
  - The audit and the caches the UI depends on persist in R2 through the plugin's `cacheStore` option and build through `waitUntil`.
  - `seo-redirects` apply on the site, and `/sitemap.xml`, `/robots.txt` and `/llms.txt` are served at the root.
  - The admin UI has no hard-coded paths, and no `NEXT_*` env vars are left.
- **Verified on a deployed Worker** (2026-11-03, `cargo-template.pedrsntana.workers.dev`, 1,500 seeded pages): every enabled feature works. See "Deployed Worker check" below.
  - Admin login on Workers needed a Payload patch (`patches/payload@4.0.0-beta.6.patch`): Payload 4 hashes passwords with 600,000 PBKDF2 iterations, and deployed Workers reject anything above 100,000 (local workerd doesn't, so `pnpm web preview` hides it).
- Everything that grows D1, needs background timers, or calls third-party APIs is **turned off** in `apps/web` and only partly ported (P2).

## Where things are

| What | Where |
|---|---|
| Plugin source | `packages/payload-seo-analyzer/src` (`plugin.ts` wires everything; `endpoints/`, `collections/`, `components/`, `views/`, `rules/`) |
| Admin UI conventions (mandatory) | [`src/ui/README.md`](src/ui/README.md): `@payloadcms/ui` + Payload 4 tokens only |
| Shared UI layer | `src/ui/` (`styles.css`, `tone.ts`, `primitives.tsx`) |
| How the app uses it | `apps/web/src/payload.config.ts` (`seoAnalyzerPlugin({...})`; the feature flags live there) |
| Its migration in the app | `apps/web/src/db/migrations/20261103_110003_seo_analyzer.ts` (`seo_redirects`, `seo_settings`, `pages.focus_keyword`, `pages.is_cornerstone`, `pages_focus_keywords`) |
| Upstream docs (Next.js-centric, partly stale) | `README.md` (below the fork notice), `docs/`, `CHANGELOG.md` |
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

## Working on it

```sh
pnpm dev                                                 # root: tsup --watch for the plugin + the app on :3000
pnpm --filter @cargo/payload-seo-analyzer test           # 728 vitest tests (jsdom for components)
pnpm --filter @cargo/payload-seo-analyzer typecheck
pnpm build                                               # plugin, then the production Worker
PAYLOAD_SECRET=test-secret pnpm web test:int             # app integration tests (varlock exits without the secret)
pnpm web generate:importmap                              # after adding/removing admin components or views
pnpm web migrate:create <name>                           # after enabling a feature that adds a collection
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

Gotchas:
- **Dev-push data-loss prompt:** while the plugin's tables exist in your local D1 (`apps/web/.wrangler/state`), any branch or config without them makes Payload's dev push stop at an interactive "data loss" prompt. Tests and scripts then hang until they time out.
- **First request after adding collections:** the first dev request sometimes fails with `index payload_locked_documents_rels_order_idx already exists`. That's a drizzle/SQLite push quirk; the next request works.
- **Rate limiting:** the plugin rate-limits its expensive endpoints per user (10/min), so automated checks that load many views quickly get HTTP 429.
- **e2e port:** `apps/web` e2e specs hard-code `localhost:3000` with `reuseExistingServer`. Any other app on that port gets tested instead.
- **workerd preview:**
  - `pnpm web preview` doesn't take `--port` cleanly. Run `pnpm web build`, then `CLOUDFLARE_RUNTIME=true vite preview --port 4310` from `apps/web`.
  - A local D1 created by Payload's dev push makes `pnpm web migrate` stop at the "data loss" prompt. Back up `.wrangler/state` and migrate a fresh copy.
  - The build writes the secret to `dist/server/.dev.vars`. It's gitignored, but it's on disk.
  - `/cdn-cgi/local/explorer/api` lists R2 objects and request traces. It shows no CPU time.
- **Env vars on Workers:** varlock only passes variables declared in `apps/web/.env.schema` to workerd. A plugin `SEO_*` variable does nothing there until it's declared (today: `SEO_LLMS_TXT`, `SEO_AUDIT_MAX_DOCS`, `SEO_FETCH_MAX_DOCS`).

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
| `dashboard` | `/admin/seo` site audit, filters, bulk actions, CSV/PDF export | on | done | yes | **local workerd: pass.** Persisted in R2 and built via `waitUntil`; fine up to the 1500-doc default cap (~6 s). Larger sites need chunked builds (see "Next") |
| `redirects` | `seo-redirects` collection, `/admin/redirects`, auto-redirect on slug change, CSV import/export | on | done | yes | **local workerd: pass**, including the frontend 301/302 |
| `sitemapAudit` | `/admin/sitemap-audit`: orphans, weak pages, hubs, broken links (the 404 and External tabs follow `seoLogs` / `externalLinks`) | on | done | yes | **local workerd: pass.** ~0.4 ms per doc uncached, persisted in R2 |
| `settings` | `seo-settings` collection, `/admin/seo-config` | on | done | yes | **local workerd: pass**, including saving |
| *(always on)* | `GET /api/seo-plugin/sitemap.xml`, `robots.txt`, `llms.txt`, news/image/video sitemaps | on | done | yes | **local workerd: pass.** Served at `/sitemap.xml`, `/robots.txt` and `/llms.txt`; `llms.txt` needs `SEO_LLMS_TXT=1`. Without `SITE_URL` they use the request origin |
| `cannibalization` | `/admin/cannibalization` | off | UI done | renders (empty data) | whole-site scan |
| `keywords` | `/admin/keyword-research` + AI content brief | off | UI done | renders (empty data) | whole-site scan; the brief needs AI |
| `linkGraph` | `/admin/link-graph`, crawl budget | off | UI done | renders with data | whole-site scan; client-side force simulation is fine |
| `schemaBuilder` | `/admin/schema-builder` JSON-LD builder | off | UI done | renders | none (mostly client-side) |
| `duplicateContent` | duplicate content endpoint | off | compiles | no | whole-site scan |
| `externalLinks` | outbound link checker (SSRF-guarded) | off | compiles | no | uses `node:dns` lookup (workerd implements it over DoH); fetch fan-out and subrequest limits |
| `aiFeatures` | generate meta, optimize, rewrite, alt text, content brief (Anthropic API via `fetch`) | off | compiles, UI done | no; buttons render, without a key it falls back to heuristics | needs `ANTHROPIC_API_KEY` as a Worker secret. **Default model `claude-sonnet-4-6` is outdated** (P2) |
| `performance` | `seo-performance` collection, GSC CSV/JSON/XLSX import, `/admin/performance` + 9 panels (CWV, indexation, content grade, CTR, alt text, health…) | off | UI done | renders with empty data | grows D1. XLSX import only works if the host maps `xlsx` |
| `scoreHistory` | `seo-score-history` collection + hook on every save + chart | off | compiles, chart UI done | no | **grows D1 on every save** (P2) |
| `seoLogs` | `seo-logs` collection, 404 logging endpoint | off | compiles | no | **logs in the main D1 break AGENTS.md** (P2) |
| `gscApi` | Google Search Console OAuth, rank tracker (`seo-gsc-auth`, `seo-rank-history`) | off | compiles | no | token crypto uses `scryptSync` (`node:crypto`, unverified in workerd); daily snapshots need a scheduler (P2) |
| `alerts` | digest via webhook/email | off | compiles | no | needs a scheduler (P2) |
| `indexNow` | ping search engines on publish | off | compiles | no | needs `SEO_INDEXNOW_KEY` |
| `warmCache` | pre-builds the audit on startup | off | **skipped on Workers by design** | n/a | not meaningful on Workers |
| `retentionDays` (option) | daily purge of time-series collections | not set | compiles | no | scheduler skipped on Workers (P2) |
| meta fields (`autoCreateMetaFields`) | the plugin's own meta title/description/image/overview/SERP preview fields | not used (`@payloadcms/plugin-seo` owns the SEO tab) | UI done | jsdom tests only | none |

## Missing compared to the original plugin

Upstream behaviour that doesn't work, or has no equivalent, in this fork today:

1. **Background schedulers.** Upstream starts `setInterval` jobs in `onInit`: cache warm-up, rank tracker, alerts digest, retention purge. They're skipped on Workers (`isServerlessIsolate()` in `plugin.ts`) and have no replacement yet. They still run under Node.
2. **Next.js frontend helpers.** `buildSeoMetadata()` still returns a Next.js `Metadata` object. `apps/web` builds its meta tags from `@payloadcms/plugin-seo` and its JSON-LD in `src/utilities/pageJsonLd.ts` (with `buildJsonLd` / `serializeJsonLd`). There's no generic TanStack `head()` adapter in the package.
3. **404 logging.** Redirects are applied in `apps/web` (`_frontend/$slug.tsx`, `_frontend/$.tsx`, `redirects.functions.ts`). Nothing posts 404s anywhere, because `seoLogs` is off (P2).
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
   - Worker bundle: `dist/server` is about 19.7 MB raw, ~4.4 MB gzipped (fine on the paid plan). AWS SDK chunks are bundled: see "Next".
   - **A deployed Worker is still unverified.**
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

- **Deployed Worker check (done 2026-11-03).** Deployed with `pnpm web deploy` to `cargo-template.pedrsntana.workers.dev` (D1 `cargo-template`, R2 `cargo-template-media`), then checked over REST with a user API key.
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
- **`indexation-audit` is uncached and uncapped.** It's registered with `dashboard` but only the Performance view calls it, and it costs ~8.5 ms CPU per doc deployed. Cache it like the audit and apply `SEO_AUDIT_MAX_DOCS`, or register it only with `performance`.
- **Chunked audit builds for big sites.** Use Payload jobs or Queues that save progress to R2 with a cursor, triggered on save and by a Cron Trigger. This ties into P2 item 9. Until then, keep `SEO_AUDIT_MAX_DOCS` at or below ~2000 (measured on a deployed Worker), or raise `limits.cpu_ms` in `wrangler.jsonc`.
- **Trailing slashes:** TanStack answers `/foo/` with a 307 to `/foo` before any redirect lookup, so it takes two hops and the first one is temporary. Make it a permanent 308/301.
- **Dashboard paging:** at 1500 docs it shows "1500 pages analyzed" but "300 results displayed" (the endpoint pages by 300). Check whether the UI loads the rest.
- **Readability:** the audit always uses `calculateFleschFR`, so English sites score low (an average of 22 on the seed corpus). Use the locale-appropriate formula.
- **`SeoAnalyzer.tsx` "view pages" link** builds `/collections/<collection>/<slug>`, but Payload needs the document id there. `check-keyword` returns no id.
- **`seo-settings.breadcrumb.homeLabel`** still defaults to `Accueil`. Changing it means a migration, because the column has a DB default.
- **Per-isolate caches remain**, each limited by its TTL: rendered sitemap XMLs, the suggest-links index, the caches of disabled features, and the rate limiter. The Workers Rate Limiting binding is the proper fix for the last one.
- **R2 hygiene:** old config hashes leave orphaned keys under `seo-analyzer/cache/`. Add an R2 lifecycle rule on that prefix.
- **Bundle:** find out why AWS SDK chunks (`sts`, `sso-oidc`) end up in the Worker.
- **Optional cleanups:**
  - Export `validateRedirectTarget` / `normalizeFromPath` from the package, so `apps/web/src/utilities/redirects.ts` can drop its mirrored target policy.
  - Add a server-safe package entry for `buildJsonLd` / `serializeJsonLd`, so the frontend can import them statically.

### P2: before enabling the off-by-default features

9. **Schedulers → Payload jobs + Cron Triggers.** Port `rankTracker.ts`, `alertsScheduler.ts`, `retentionScheduler.ts` (and possibly the audit build) to `jobs.tasks`. Run them from a `scheduled` handler (Cron Trigger in `wrangler.jsonc`) or an authenticated endpoint. Keep the Node `setInterval` path for non-Workers hosts.
10. **Keep D1 small (see AGENTS.md).**
    - `seoLogs`: send 404 events to Workers Analytics Engine or R2, or at least a separate D1 database. Never the main one.
    - `scoreHistory`, `performance`, rank history: require `retentionDays` once retention runs as a job, cap rows, or move them to Analytics Engine / R2.
    - Every feature that adds a collection needs `pnpm web migrate:create` and a committed migration.
11. **AI features.**
    - Update `DEFAULT_AI_MODEL` (`src/helpers/aiModel.ts`, currently `claude-sonnet-4-6`) to a current Claude model.
    - Check the request shapes against the current Messages API (`aiGenerate`, `aiOptimize`, `aiRewrite`, `aiAltText`, `aiContentBrief`, `aiOptimizeBulk`).
    - Declare `ANTHROPIC_API_KEY` / `SEO_AI_MODEL` in `.env.schema`.
12. **GSC on Workers.** Check that `scryptSync` / `createCipheriv` from `node:crypto` work in workerd (`helpers/tokenCrypto.ts`), or move to WebCrypto. OAuth redirect URLs currently derive from `NEXT_PUBLIC_SERVER_URL`-style vars (`helpers/gscClient.ts`).
13. **`externalLinks`:** check `node:dns` behaviour in workerd (`helpers/ssrfGuard.ts` fails closed, so a broken DNS lookup blocks every link) and subrequest limits.

### P3: quality and cleanup

14. **Bulk-preview dialog** in `SeoView.tsx`: still a custom overlay without a focus trap or Escape to close. Move it to Payload `Modal` / `useModal`, then drop the last exception in `a11yContract.test.ts`.
15. **PDF export** (`SeoView.tsx`, `handleExportPdf`): builds a standalone HTML document with hard-coded print colours (the only hex left outside the third-party mock-ups). Fine to keep; move it to a template file if it grows.
16. **E2E coverage:**
    - Replace `e2e/` with Playwright specs in `apps/web/tests/e2e` covering the SEO views, or delete it.
    - Make the app's e2e base URL configurable (no hard-coded `localhost:3000`).
17. **Docs:** rewrite the upstream README sections for TanStack/Workers, update `docs/THREAT-MODEL.md` for the Workers deployment, and decide whether to keep `CHANGELOG.md` (upstream history) or start a fork changelog.
18. **Payload UI notes:**
    - `Button` has no `small` size.
    - `Tabs` has no `aria-label`; it's wrapped in `role="group"`.
    - Payload's `Chip` hard-codes its remove label; the settings view uses its own chip for that reason.
    - Revisit these when Payload 4 leaves beta.
19. **Upstream sync:** `git subtree pull --prefix=packages/payload-seo-analyzer https://github.com/pOwn3d/payload-seo-analyzer.git main`. Expect conflicts in `components/*` (rewritten), `views/*`, `plugin.ts`, `rateLimiter.ts` and the collections. The old fork `0xZ0uk/payload-seo-analyzer` is archived; don't push there.

## Definition of done for "fully ported"

- Every feature flag is either verified in a deployed Worker or explicitly marked unsupported on Workers in this file and in `README.md`. *(Enabled features: local workerd only.)*
- No unpersisted background work and no module-level caches the UI depends on. *(Done for the enabled features.)*
- No time-series data in the main D1.
- No hard-coded `/api/seo-plugin` or `/admin` paths. *(Done.)*
- No `NEXT_*` environment variables. *(Done in code; `README.md` and `e2e/` still mention them.)*
- Redirects, `sitemap.xml` and `robots.txt` work on the live site. *(Done in local workerd.)*
- Unit tests, typecheck, lint and an e2e pass over the SEO views run in CI from the repo root.
