# SEO analyzer: port status and plan

Handoff for whoever continues porting `@cargo/payload-seo-analyzer`. Last updated 2026-11-03.

## TL;DR

- This package is a fork of [`@consilioweb/payload-seo-analyzer`](https://github.com/pOwn3d/payload-seo-analyzer) 4.2.2 (Payload 3 + Next.js), ported to **Payload 4 (4.0.0-beta.6)** and to our stack: **TanStack Start on Cloudflare Workers, D1 + R2**.
- **Done:** it compiles and runs on Payload 4, has no Next.js dependency, and its whole admin UI has been rebuilt on `@payloadcms/ui` and Payload 4 tokens.
- **Verified in the Node dev server only.** `apps/web` enables the core subset: editor sidebar, dashboard, redirects, sitemap audit, settings.
- **Not verified in the Workers runtime** (`pnpm web preview` or a deployed Worker). The background audit and the in-memory caches are known to be unsafe there (see P0).
- Everything that grows D1, needs background timers, or calls third-party APIs is **turned off** in `apps/web` and only partly ported.

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

## Working on it

```sh
pnpm dev                                                 # root: tsup --watch for the plugin + the app on :3000
pnpm --filter @cargo/payload-seo-analyzer test           # 728 vitest tests (jsdom for components)
pnpm --filter @cargo/payload-seo-analyzer typecheck
pnpm build                                               # plugin, then the production Worker
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

### Visual check (what was used for the UI rebuild)

1. Copy `apps/web` (without `node_modules`) to a scratch directory.
2. Enable every feature there except `gscApi` / `indexNow`.
3. `pnpm install`, then `vite dev --port 3020`.
4. Create a user with `payload run` (pass `overrideAccess: true`).
5. Screenshot each view in both themes with Playwright. Set the `payload-theme` cookie to `dark` / `light` and log in through `POST /api/users/login`.

Nothing from that run is kept; recreate it as needed.

## Feature matrix

**Port status** means the code compiles and runs on Payload 4 and the UI is rebuilt. **Verified** means exercised in the Node dev server (API calls and/or screenshots). **Workers** is the status in workerd, where none has been run.

| Feature flag | What it is | In `apps/web` | Port status | Verified (Node) | Workers concerns |
|---|---|---|---|---|---|
| `analyzer` (always on) | Score sidebar on Pages, 50+ rules, Lexical parsing | on | done | yes, live editing and `POST /validate` | none known |
| `dashboard` | `/admin/seo` site audit, filters, bulk actions, CSV/PDF export | on | done | yes, the audit built and rendered | **P0**: background build + in-memory cache |
| `redirects` | `seo-redirects` collection, `/admin/redirects`, auto-redirect on slug change, CSV import/export | on | done | yes, CRUD via REST | none in the admin. **Redirects aren't applied on the frontend** (see P1) |
| `sitemapAudit` | `/admin/sitemap-audit`: orphans, weak pages, hubs, broken links, 404 logs tab | on | done | yes | Whole-site scan per request: CPU limits on large sites |
| `settings` | `seo-settings` collection, `/admin/seo-config` | on | done | yes, renders; saving not exercised | none known |
| *(always on)* | `GET /api/seo-plugin/sitemap.xml`, `robots.txt`, `llms.txt`, news/image/video sitemaps | on | done | `sitemap.xml` and `robots.txt` return 200 | Not served at the root (`/sitemap.xml`): see P1. Needs `SITE_URL` |
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
2. **Next.js frontend helpers.**
   - `buildSeoMetadata()` returns a Next.js `Metadata` object.
   - `buildJsonLd` / `serializeJsonLd` and the breadcrumb helpers are framework-agnostic, but nothing in `apps/web` uses them.
   - There's no TanStack `head()` adapter.
3. **Middleware-based redirects and 404 logging.** Upstream's README has hosts wire Next middleware to apply `seo-redirects` and to POST 404s to `seo-logs`. There's no TanStack equivalent yet.
4. **Root sitemap/robots.** Upstream suggests Next route handlers that re-export the endpoints at `/sitemap.xml` and `/robots.txt`. Missing in `apps/web`.
5. **Build-time audit cache** (`auditCacheFile`, `buildAuditToFile()`). It reads and writes the filesystem, which Workers don't have. It's guarded by a dynamic import plus try/catch, so it fails silently. It needs an R2/KV replacement or removal.
6. **E2E harness.** `e2e/` and `e2e/ui/` are upstream's Next.js 16 + Payload 3 test apps. They're not workspace members (only `packages/*` is) and don't run. Its package scripts were removed.
7. **Locales.** Analysis and UI strings are French and English only (`SeoLocale = 'fr' | 'en'`). Other admin languages fall back to English.
8. **Publishing.** The package is `private`. Upstream's npm release flow, `prepublishOnly`, CI and dependabot were removed.
9. **`scripts/uninstall.mjs`** (upstream `bin`): kept but not checked against Payload 4 / D1.

## Remaining work, prioritised

### P0: required before enabling more features or relying on the dashboard in production

1. **Run the plugin in workerd.**
   - Run `pnpm web preview` (local workerd + local D1/R2), then a deployed Worker.
   - Exercise the sidebar, dashboard, redirects, sitemap audit, settings, `sitemap.xml` and `robots.txt`.
   - Watch for Node APIs, CPU-time limits and script size. The Worker already needs the paid plan.
2. **Redesign the dashboard audit for Workers.**
   - Today: `endpoints/audit.ts` starts `void buildAuditCache(...)` (fire-and-forget, with `setTimeout` throttling) and keeps the result in the in-memory `seoCache` (`src/cache.ts`). The browser polls `GET /audit` until the cache is filled.
   - Problem: on Workers, unawaited work after the response is cancelled (no `ctx.waitUntil`), and each isolate has its own memory. Polls can land on isolates that never built anything.
   - Options:
     - (a) For small sites, build within the request and stream or return it.
     - (b) Persist the result (R2 object or a KV namespace keyed by locale and config hash), and run the build through `waitUntil` or a Payload job.
     - (c) Payload jobs (`jobs.tasks`) plus a Cron Trigger.
   - Same issue for every module-level `Map` cache: `endpoints/performance.ts`, `externalLinks.ts`, `rankTracking.ts`, `alerts.ts`, `cannibalization.ts`, `llmsTxt.ts`, `redirectChains.ts`.
   - The rate limiter (`rateLimiter.ts`) is per-isolate too. That's acceptable but weak; Workers' Rate Limiting binding is the proper fix.
3. **Decide on whole-site scans.** Sitemap audit, link graph, cannibalization, keywords and duplicate content load every document per request (`fetchAllDocs`, `SEO_FETCH_MAX_DOCS`, default 5000). Measure CPU time on a realistic site, then cap with the existing env vars, paginate, or precompute (ties into item 2).

### P1: needed for the enabled features to be complete

4. **Apply redirects on the frontend.** In `apps/web`, look up `seo-redirects` for unmatched paths (TanStack `beforeLoad` / `notFound`, or a server middleware) and return 301/302. Include multi-segment paths: today only `/$slug` exists. The plugin already exposes chain detection and redirect safety helpers (`helpers/redirectSafety.ts`). Cache lookups so they don't hit D1 on every request.
5. **Serve `/sitemap.xml`, `/robots.txt` (and `/llms.txt`) at the site root** as TanStack server routes that proxy the plugin endpoints. Set `SITE_URL` in `.env.production`: with `SITE_URL` empty, `robots.txt` currently prints `Sitemap: /sitemap.xml`.
6. **Remove hard-coded paths in the admin UI.**
   - 57 `'/api/seo-plugin/...'` fetches across 21 components ignore both the `endpointBasePath` option and a custom `routes.api`. Build URLs from `useConfig().config.routes.api` plus a base path forwarded through `admin.custom.seoAnalyzer` (that's where the feature flags already travel).
   - Two `/admin/collections/...` links remain (`SeoAnalyzer.tsx` ~L1278, `LinkGraphView.tsx` ~L490). Use `formatAdminURL` like the other views.
7. **Rename env vars.** `NEXT_PUBLIC_SERVER_URL` / `PAYLOAD_PUBLIC_SERVER_URL` fallbacks for the site URL (about 26 uses) are Next-isms. Prefer `seoConfig.siteUrl`, then `SITE_URL`. Declare any variable the app enables in `apps/web/.env.schema` (secrets `@sensitive`) and run `pnpm web cf-typegen`.
8. **TanStack `head()` integration (optional).** Either map `buildSeoMetadata()` output to TanStack `head()` meta/links, or emit JSON-LD (`buildJsonLd`) from `apps/web/src/utilities/pageHead.ts`. `@payloadcms/plugin-seo` fields remain the source of the meta tags.

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

- Every feature flag is either verified in a deployed Worker or explicitly marked unsupported on Workers in this file and in `README.md`.
- No unpersisted background work and no module-level caches the UI depends on.
- No time-series data in the main D1.
- No hard-coded `/api/seo-plugin` or `/admin` paths.
- No `NEXT_*` environment variables.
- Redirects, `sitemap.xml` and `robots.txt` work on the live site.
- Unit tests, typecheck, lint and an e2e pass over the SEO views run in CI from the repo root.
