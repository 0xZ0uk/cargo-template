# @cargo/payload-seo-analyzer

An SEO toolkit for **Payload 4** that runs on **Cloudflare Workers** (D1 + R2) as well as on Node. It scores pages in the editor sidebar as you type (100+ checks, offline, no API key). It also adds a site-wide admin dashboard, redirects, generated `sitemap.xml` / `robots.txt` / `llms.txt` and JSON-LD, plus opt-in Search Console, AI and monitoring features.

It's a fork of [`@consilioweb/payload-seo-analyzer`](https://github.com/pOwn3d/payload-seo-analyzer) 4.2.2 by ConsilioWEB (MIT), which targets Payload 3 + Next.js. This fork:

- Requires Payload 4 and has **no Next.js dependency**. Admin views render through `DefaultTemplate` from `@payloadcms/ui/rsc` and redirect through Payload's server adapter, so they work under any Payload 4 adapter. The Cargo app uses TanStack Start.
- Runs on **Workers**:
  - The audit and the admin's caches persist in a store you provide (R2) and build in steps through `waitUntil`.
  - Background work runs as Payload jobs on a Cron Trigger.
  - Time-series data goes to a second D1 database (`SEO_D1`), with mandatory retention.
  - Token crypto is WebCrypto, and the SSRF guard uses Workers DNS.
- Has an admin UI rebuilt on `@payloadcms/ui` and Payload 4 design tokens. Its conventions are in [`src/ui/README.md`](src/ui/README.md) and are mandatory.

It lives in the Cargo monorepo (`packages/payload-seo-analyzer`). `apps/web` consumes it as `"@cargo/payload-seo-analyzer": "workspace:*"`. It isn't published to npm. Port status, verification notes and the remaining work are in [`PLAN.md`](PLAN.md).

## Contents

- [Features](#features)
- [Status on Cloudflare Workers](#status-on-cloudflare-workers)
- [Install](#install)
- [Quick start (Node)](#quick-start-node)
- [Cloudflare Workers setup](#cloudflare-workers-setup)
- [Frontend helpers](#frontend-helpers)
- [Configuration](#configuration)
- [API endpoints](#api-endpoints)
- [Admin views](#admin-views)
- [Collections](#collections)
- [Package exports](#package-exports)
- [Database and migrations](#database-and-migrations)
- [Performance](#performance)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Development](#development)
- [Uninstall](#uninstall)
- [License](#license)

## Features

- **Offline analysis:** 110 rule ids across 20 groups (title, meta description, URL, headings, content, images, linking, social, schema, readability, quality, secondary keywords, cornerstone, freshness, technical, accessibility, e-commerce, E-E-A-T, GEO, hreflang).
- **Live editor score:** a sidebar field analyses the document, including Lexical rich text and layout blocks. It gives a 0–100 score plus an AI-readiness indicator built from the GEO, E-E-A-T and schema checks.
- **Admin views:** site audit with CSV/PDF export and bulk actions, sitemap and link audit, settings, redirect manager, Search Console performance, cannibalization, keyword research, schema builder and link graph. Each one follows its feature flag.
- **Generated output:**
  - `robots.txt`, `sitemap.xml`, news/image/video sitemaps and an opt-in `llms.txt`.
  - JSON-LD (`buildJsonLd`) and the same URL rules for your frontend.
- **Bilingual analysis:** French and English, with a locale-adapted readability formula (Kandel-Moles for French, Flesch for English). Dashboard strings can be extended to other admin languages.
- **Opt-in integrations:** Google Search Console (OAuth), AI assists through OpenRouter (meta rewriting, alt text, content briefs), a monitoring digest over webhook or email, and IndexNow.

## Status on Cloudflare Workers

The Cargo app (`apps/web`) runs this plugin on a deployed Worker. Each feature is either verified there or still off, as listed below. Details and CPU numbers are in [`PLAN.md`](PLAN.md).

| Feature | In `apps/web` | On Workers |
|---|---|---|
| `analyzer` (sidebar, `/validate`) | on | **Verified** on a deployed Worker |
| `dashboard` | on | **Verified.** Persisted in R2, built in steps of 800 docs, capped at 5,000 |
| `redirects` (+ the frontend 301/302) | on | **Verified** |
| `sitemapAudit` | on | **Verified** |
| `settings` | on | **Verified** |
| `sitemap.xml`, `robots.txt`, `llms.txt` | on | **Verified**, served at the site root |
| `performance` | on | **Verified.** Rows in `SEO_D1`. XLSX import needs `xlsx` mapped by the host |
| `scoreHistory` | on | **Verified.** Rows in `SEO_D1` |
| `seoLogs` (404 log) | on | **Verified.** Rows in `SEO_D1` |
| `externalLinks` | on | **Verified.** Budgeted scans (100 links, 1,000 subrequests per call) that resume across calls. Each link is `ok`, `broken`, `timeout`, `error` (DNS, TLS, connection, redirect loop), `blocked` (SSRF guard) or `unverified` (401, 403, 429, 451 and 999: login walls, bot protection and rate limits, not broken links); `stats` add up to `total`. The External tab shows capped and partial scans and continues them |
| `schemaBuilder` | on | **Verified.** URLs use `siteUrl`, then `SITE_URL`, then the request origin |
| `alerts` | on | **Verified**: preview, send now and the scheduled `seoAlertsDigest` job, to a webhook. Nothing is sent until a channel is set. The webhook can't be another Worker on the same account's `workers.dev`, and email needs a Payload email adapter |
| `aiFeatures` | on | **Verified** against OpenRouter (DeepSeek V4.1 Flash): all six endpoints, alt text read from R2, the sidebar's "Optimize with AI". Needs `OPENROUTER_API_KEY`; cap spend with a credit limit on the key |
| `gscApi` | off | Token crypto verified on a deployed Worker. The endpoints and the OAuth flow aren't checked yet |
| `indexNow` | off | Not checked on Workers yet (deferred until there's a real site: it pings search engines on publish) |
| `cannibalization`, `keywords`, `linkGraph`, `duplicateContent` | off | Whole-site scans in one request, not measured against Workers CPU limits yet (deferred until there's a real site to measure) |
| `warmCache` | off | **Unsupported on Workers** (skipped by design) |
| `auditCacheFile` / `buildAuditToFile()` | n/a | **Node only.** Ignored with a warning when `cacheStore` is set or on Workers |

## Install

Inside this monorepo, add the workspace dependency:

```json
{ "dependencies": { "@cargo/payload-seo-analyzer": "workspace:*" } }
```

`payload` and `@payloadcms/ui` are peer dependencies (`>=4.0.0-beta.6 <5.0.0`, and `react ^19`). The app supplies them from the pnpm catalog in `pnpm-workspace.yaml`. Never pin them in this package: two copies of `payload` or `@payloadcms/ui` break the admin's React contexts.

The package ships `dist/`. Build it with `pnpm --filter @cargo/payload-seo-analyzer build`, or `pnpm dev` from the root, which also watches it.

## Quick start (Node)

On a long-lived Node server the defaults work as-is:

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { seoAnalyzerPlugin } from '@cargo/payload-seo-analyzer'

export default buildConfig({
  // ...db, collections, admin
  plugins: [
    seoAnalyzerPlugin({
      collections: ['pages', 'posts'],
      siteUrl: 'https://example.com',
      locale: 'en',
    }),
  ],
})
```

The plugin adds admin components, so regenerate the import map (`payload generate:importmap`) and create a migration for the fields and collections it adds (`payload migrate:create`). Open `/admin/seo`, or edit a page to see the score in the sidebar.

On Node, the caches live in memory, background work runs on timers, and the time-series data lives in Payload collections in your main database.

## Cloudflare Workers setup

None of the Node defaults hold on Workers. Isolates share no memory, un-awaited work is cancelled, there are no timers, and D1 is capped at 10 GB. The plugin has an option for each of these. `apps/web` is the reference setup; its files are named below.

### 1. Bindings (`wrangler.jsonc`)

| Binding | Used for |
|---|---|
| `D1` | Payload's database: plugin collections (`seo-settings`, `seo-redirects`) and the fields it adds to your collections |
| `SEO_D1` | A **second** D1 database for time-series data (score history, Search Console imports, rank history, 404 log). One site per database |
| `R2` | The plugin's cache store, under `seo-analyzer/cache/` (expire it after 7 days with an R2 lifecycle rule; see `pnpm web r2:lifecycle`) |
| `ratelimits` (optional) | Workers Rate Limiting bindings for the `expensive`, `audit-poll` and `ai-interactive` buckets |
| `triggers.crons` | `*/5 * * * *`, to run the plugin's jobs |

Run `pnpm web cf-typegen` after editing it.

### 2. Plugin options

```ts
import { createSqlSeoDataStore, seoAnalyzerPlugin } from '@cargo/payload-seo-analyzer'
import { cloudflareEnv as cloudflare, waitUntil } from '#cloudflare-runtime'
import { r2SeoCacheStore } from './plugins/seoCacheStore'
import { workersSeoRateLimit } from './plugins/seoRateLimit'

seoAnalyzerPlugin({
  collections: ['pages'],
  collectionRoutes: { pages: '' },
  locale: 'en',
  siteUrl: process.env.SITE_URL || undefined, // falls back to SITE_URL, then the request origin
  cacheStore: r2SeoCacheStore(cloudflare.R2), // get/put/delete of strings
  waitUntil, // undefined under the Node dev server, which is fine
  rateLimit: workersSeoRateLimit(cloudflare), // optional; falls back to in-memory per isolate
  dataStore: createSqlSeoDataStore(cloudflare.SEO_D1),
  jobs: true,
  features: { warmCache: false /* plus the flags you want, see the status table */ },
})
```

- **`cacheStore`** persists the dashboard audit, the indexation audit, the sitemap audit, redirect chains and external-link scans. Invalidation is a generation token per cache that every isolate reads. `apps/web/src/plugins/seoCacheStore.ts` is a 20-line R2 implementation.
- **`waitUntil`** builds the audit in the background, in steps that fit the CPU limit (`SEO_AUDIT_STEP_DOCS`, 800 by default). The dashboard's polls run the next step, and the `seoAuditContinue` job finishes builds nobody is watching.
- **`dataStore`** keeps time-series rows out of the main D1. With it set, the four time-series collections aren't registered. The SQL store creates and migrates its own tables (`SEO_STORE_MIGRATIONS`, recorded in `seo_store_migrations`). It applies pending migrations on first use; `migrateSeoStore(db)` applies them ahead of time (`pnpm web seo-store:migrate[:remote]`).
- **`rateLimit`** maps the plugin's buckets (`SEO_RATE_LIMITS`) to Workers Rate Limiting. Those counts are eventually consistent, so treat them as a brake, not a hard cap. The hard cap on AI spend is a credit limit on the OpenRouter key.
- **`jobs`** registers Payload tasks on the `seo` queue instead of starting timers. See [Background jobs](#background-jobs).

`onInit` warns on Workers when `dashboard` lacks `cacheStore` or `waitUntil`, or when time-series features lack `dataStore`. It also warns when scheduled work lacks `jobs`.

### 3. Worker entry: run the jobs on the Cron Trigger

```ts
// src/server.ts (wrangler's `main`)
import { runSeoJobs } from '@cargo/payload-seo-analyzer'

export default {
  ...entry, // TanStack Start's fetch handler
  scheduled(controller, _env, ctx) {
    ctx.waitUntil(
      (async () => {
        const { getPayload } = await import('payload')
        const payload = await getPayload({ config: (await import('@payload-config')).default })
        await runSeoJobs(payload) // queues the due tasks, then runs the queue
      })(),
    )
  },
}
```

Jobs add Payload's `payload-jobs` collection, so run `migrate:create` once. A new or changed cron schedule can take a few minutes to start firing after a deploy.

### 4. Root files, redirects and 404s

- **`/sitemap.xml`, `/robots.txt`, `/llms.txt`:** the plugin serves them under `/api/seo-plugin/…`. `apps/web` re-serves them at the root by passing the request to Payload's API handler in-process (`src/utilities/servePluginFile.ts`). Never fetch them from the Worker's own origin, because those subrequests are unreliable.
- **Redirects:** the app reads `seo-redirects` only when the page lookup misses, caches the table per isolate for 60 s, and checks targets with `validateRedirectTarget` from `@cargo/payload-seo-analyzer/shared` (`src/app/_frontend/redirects.functions.ts`).
- **404 log:** call `recordSeoNotFound(payload, { url, referrer, userAgent })` from your not-found path and pass the promise to `waitUntil`. It never throws, and does nothing while `seoLogs` is off.

### 5. Environment variables

Varlock passes workerd only the variables declared in `apps/web/.env.schema`. A plugin variable does nothing on Workers until it's declared there; mark secrets `@sensitive`. `apps/web` declares `SITE_URL`, `SEO_LLMS_TXT`, the audit caps, the external-link caps, the GSC, OpenRouter and alert variables. The full list is under [Environment variables](#environment-variables).

## Frontend helpers

The URL rules the sitemap uses are exported as pure functions, so the frontend produces the same canonical and JSON-LD URLs. `@cargo/payload-seo-analyzer/shared` has no package imports, which makes it safe in a route's `head()`:

```ts
import { buildJsonLd, serializeJsonLd } from '@cargo/payload-seo-analyzer/shared'

const { jsonLd } = buildJsonLd(page, {
  collection: 'pages',
  collectionRoutes: { pages: '' }, // the same map you gave the plugin
  siteUrl: 'https://example.com',
  locale: 'en', // breadcrumb label "Home"; `homeLabel` overrides it
})

// TanStack Start route
head: () => ({
  scripts: [{ type: 'application/ld+json', children: serializeJsonLd(jsonLd) }],
})
```

Use `serializeJsonLd`, not `JSON.stringify`. It escapes `<`, `>`, `&`, U+2028 and U+2029. `apps/web/src/utilities/pageJsonLd.ts` builds WebPage and BreadcrumbList for pages, and WebSite and Organization for home.

| Function | Entry | Purpose |
|---|---|---|
| `buildJsonLd` | root, `/shared` | Schema.org object for a document; type auto-detected from the collection unless forced |
| `serializeJsonLd` | root, `/shared` | XSS-safe JSON for a `<script type="application/ld+json">` |
| `renderJsonLdScript` | root | The complete, escaped `<script>` tag as a string |
| `validateRedirectTarget`, `normalizeFromPath` | root, `/shared` | The redirect policy the plugin enforces (no `//host`, dangerous schemes or CRLF) |
| `buildDocPath`, `buildDocUrl` | root | The exact public path or URL the sitemap, canonical and JSON-LD use |
| `buildSeoMetadata` | root | Title, description, canonical, robots, Open Graph and Twitter tags. The shape is Next.js `Metadata`; with TanStack Start, map it into `head().meta` yourself |
| `analyzeSeo` | root | The whole analysis engine, outside Payload |

There's no TanStack `head()` adapter for `buildSeoMetadata`. `apps/web` takes its meta tags from `@payloadcms/plugin-seo` instead.

## Configuration

### Plugin options

Every field of `SeoPluginConfig`. All are optional.

| Option | Type | Default | Description |
|---|---|---|---|
| `collections` | `string[]` | `['pages', 'posts']` | Collections that get the SEO fields and are analyzed. |
| `globals` | `string[]` | `[]` | Globals that get the SEO fields and are analyzed. |
| `siteUrl` | `string` | `SITE_URL`, then the request origin | Base URL for canonicals, sitemaps, JSON-LD and the GSC redirect URI. Scheduled jobs have no request, so the rank snapshot needs this or `SITE_URL`. |
| `siteName` | `string` | — | Used by the "brand duplicated in title" check. |
| `locale` | `'fr' \| 'en'` | `'fr'` | Language of the analysis (readability, stop words, messages) and of the AI prompts. The plugin's interface follows the Payload admin language instead. |
| `localeMapping` | `Record<string, 'fr' \| 'en'>` | — | Maps Payload locale codes onto the analysis locale. |
| `collectionRoutes` | `Record<string, string>` | `{ posts: 'posts' }` | Public route prefix per collection, used by every URL the plugin generates. `''` serves at `/<slug>`. |
| `knownRoutes` | `string[]` | `[]` | Routes with no matching document slug, so they aren't reported as broken links or orphans. |
| `features` | `SeoFeatures` | see below | Per-feature switches. |
| `disabledRules` | `RuleGroup[]` | `[]` | Rule groups to skip. |
| `overrideWeights` | `Partial<Record<RuleGroup, number>>` | — | Force the weight of every check in a group. |
| `thresholds` | `SeoThresholds` | constants | `titleLengthMin/Max`, `metaDescLengthMin/Max`, `minWordsGeneric`, `minWordsPost`, `keywordDensityMin/Max`, `fleschScorePass`, `slugMaxLength`. |
| `localSeoSlugs` | `string[]` | — | Extra slugs treated as local-SEO pages. |
| `endpointBasePath` | `string` | `'/seo-plugin'` | Prefix of the REST endpoints under the API route. The admin UI follows it (`useSeoApi`), but a host that re-serves the root files must use the same value (`servePluginFile.ts` assumes the default). |
| `addDashboardView` | `boolean` | `true` | `false` registers no admin view at all. |
| `addSitemapAuditView` | `boolean` | `true` | `false` drops only `/admin/sitemap-audit`. |
| `trackScoreHistory` | `boolean` | `true` | `false` turns off the score snapshot hook even with `features.scoreHistory`. |
| `redirectsCollection` | `string` | `'seo-redirects'` | Slug of the redirects collection; an existing collection with that slug is reused. |
| `allowExternalRedirects` | `boolean` | `false` | Allow destinations on another origin. Off by default: an off-site 301 from your path carries your domain's authority. Stored external destinations stay editable; only a changed destination is refused. |
| `uploadsCollection` | `string` | `'media'` | Upload collection for `meta.image` and the alt-text endpoints. |
| `autoCreateMetaFields` | `boolean` | `true` | Adds the `meta` group (title, description, image, preview). Skipped with a warning when the collection already has one, e.g. from `@payloadcms/plugin-seo`. |
| `seoLogsSecret` | `string` | — | Shared secret for `POST /seo-logs` (`X-SEO-Secret`). Without it that route needs an SEO admin; in-process recording uses `recordSeoNotFound` instead. |
| `cacheStore` | `SeoCacheStore` | in memory | Persistent store for the caches the admin polls. **Required on Workers.** |
| `waitUntil` | `(promise) => void` | — | Keeps background work alive after the response and enables step builds. **Required on Workers.** |
| `dataStore` | `SeoDataStore` | Payload collections | Where time-series rows live. `createSqlSeoDataStore(d1)` on Workers. See [Data store and retention](#data-store-and-retention). |
| `rateLimit` | `SeoRateLimit` | in memory | `({ bucket, key }) => boolean \| undefined`. `undefined`, or a throw, falls back to the in-memory limiter. |
| `jobs` | `boolean \| SeoJobsOptions` | — | Payload jobs instead of timers. See [Background jobs](#background-jobs). |
| `retentionDays` | `Partial<Record<RetentionCollection, number>>` | `RETENTION_DEFAULTS` | Days to keep per dataset. |
| `retentionMaxRows` | `Partial<Record<RetentionCollection, number>>` | `RETENTION_DEFAULTS` | Row cap per dataset, newest kept. |
| `auditCacheFile` | `string` | — | **Node only.** A JSON audit from `buildAuditToFile()`, served on a cache miss instead of a live build. |
| `generateTitle`, `generateDescription`, `generateImage`, `generateURL` | functions | — | Back the meta fields' generate buttons and previews. |
| `fields` | `({ defaultFields }) => Field[]` | — | Rewrites the contents of the `meta` group. |
| `tabbedUI` | `boolean` | `false` | Wraps collection fields in "Content" and "SEO" tabs. |
| `interfaceName` | `string` | — | TypeScript interface name for the `meta` group. |
| `customTranslations` | `Record<string, Partial<DashboardTranslations>>` | — | Dashboard strings for admin languages beyond FR/EN; missing keys fall back to English. |

### Feature flags

`features` gates collections, endpoints and admin views together. The analyzer sidebar, `/validate` and the meta fields are always on.

| Flag | Default | Controls |
|---|---|---|
| `dashboard` | `true` | `/admin/seo`, `/audit` |
| `sitemapAudit` | `true` | `/admin/sitemap-audit`, `/sitemap-audit`, `/sitemap-config` |
| `settings` | `true` | `/admin/seo-config`, `/settings`, the `seo-settings` collection |
| `redirects` | `true` | `/admin/redirects`, redirect endpoints, the `seo-redirects` collection |
| `performance` | `true` | `/admin/performance`, `/performance`, `/core-web-vitals`, `/indexation-audit`, Search Console imports |
| `scoreHistory` | `true` | Score snapshots on save, `/history` |
| `seoLogs` | `true` | The 404 log and `/seo-logs` |
| `externalLinks` | `true` | `/external-links` |
| `aiFeatures` | `true` | The `ai-*` and `alt-text-audit` endpoints and the AI buttons |
| `linkGraph`, `keywords`, `cannibalization`, `schemaBuilder`, `duplicateContent` | `true` | Their views and endpoints |
| `warmCache` | `true` | Audit warm-up on start (Node only; set `false` on Workers) |
| `gscApi` | **`false`** | Search Console OAuth, rank tracking, CTR opportunities, content grade, `seo-gsc-auth` |
| `alerts` | **`false`** | Monitoring digest |
| `indexNow` | **`false`** | IndexNow key file and submit endpoint |

Most flags default to on, which suits a Node host. On Workers, turn on only what the [status table](#status-on-cloudflare-workers) marks verified, as `apps/web` does.

### Data store and retention

The time-series datasets are append-only: score history (a snapshot per document per save, throttled to one an hour), Search Console imports, rank history (a row per tracked query per day) and the 404 log. `dataStore` decides where they live:

- **`createSqlSeoDataStore(db)`** takes a D1 binding, or anything with D1's `prepare`/`bind`/`all`/`run`/`batch`. It owns its tables and migrations, batches bulk writes under D1's 100-parameter limit, and registers no Payload collections.
- **Omitted:** the upstream collections (`seo-score-history`, `seo-performance`, `seo-rank-history`, `seo-logs`) in the main database (`createPayloadSeoDataStore`).

**Retention is mandatory** for every enabled dataset. Windows default to `RETENTION_DEFAULTS`; `retentionDays` and `retentionMaxRows` override them.

| Dataset | Days | Max rows | Pruned on |
|---|---|---|---|
| `seo-rank-history` | 400 | 100,000 | snapshot date |
| `seo-score-history` | 365 | 50,000 | snapshot date |
| `seo-performance` | 490 | 100,000 | row date |
| `seo-logs` | 90 | 5,000 (`SEO_LOGS_MAX_ROWS`, also checked on each new URL) | last seen |

A value that isn't a finite number of at least 1 is ignored and the default applies; `0` never means "delete everything". The purge runs daily as the `seoRetentionPurge` job (or a timer on Node). `GET /retention` (dry run) and `POST /retention` (run now) are SEO-admin only. The windows come from config only: the `POST` reads no body. `purgeRetention`, `describeRetention` and `resolveRetention` are exported for a host that runs its own purge.

### Background jobs

```ts
seoAnalyzerPlugin({
  jobs: true, // or { queue: 'seo', auditCron: '*/5 * * * *', dailyCron: '0 4 * * *' }
})
```

With `jobs`, the plugin registers scheduled Payload tasks and starts no timers. Without it, Node runs the same work on `setInterval`, and Workers skips it with a warning.

| Task | Registered when | Schedule | Does |
|---|---|---|---|
| `seoAuditContinue` | `dashboard` | `auditCron` | Runs the next step of a paused dashboard audit. Never starts a build |
| `seoRankSnapshot` | `gscApi` | `dailyCron` | Search Console position snapshot |
| `seoAlertsDigest` | `alerts` | `dailyCron` | Builds and sends the digest |
| `seoRetentionPurge` | any time-series dataset enabled | `dailyCron` | Retention purge |

The host runs the queue: `runSeoJobs(payload)` from a Workers `scheduled` handler (see [step 3](#3-worker-entry-run-the-jobs-on-the-cron-trigger)), or Payload's `jobs.autoRun` on Node. A scheduled task is queued for the cron's *next* run time, so the first tick only queues and the second runs. Keep Payload's `deleteJobOnComplete` so finished jobs don't pile up.

A step build stops after `SEO_AUDIT_STEP_DOCS` docs or `SEO_AUDIT_STEP_MS`, saves its cursor and partial results in `cacheStore`, and pauses. A pause with no new step for `SEO_AUDIT_PAUSED_STALE_MS` is abandoned. A save during a build makes the result stale, so on a site edited every few minutes a big audit may keep rebuilding (PLAN.md, P3 item 21).

### Environment variables

The plugin reads no `NEXT_*` or `PAYLOAD_PUBLIC_*` variables. On Workers, declare the ones you use in `apps/web/.env.schema`.

| Variable | Default | Description |
|---|---|---|
| `SITE_URL` | — | Site origin when the `siteUrl` option isn't set. Without either, generated files use the request origin |
| `SEO_LLMS_TXT` | — | `1` serves `/llms.txt`; 404 otherwise |
| `SEO_AUDIT_MAX_DOCS` | `5000` | Docs in the dashboard audit |
| `SEO_AUDIT_STEP_DOCS` | `800` | With `waitUntil`: docs per build step (~8 s CPU on a deployed Worker) |
| `SEO_AUDIT_STEP_MS` | `20000` | With `waitUntil`: wall-time budget of a step |
| `SEO_AUDIT_PAUSED_STALE_MS` | `3600000` | A paused build idle this long is abandoned |
| `SEO_AUDIT_BUILD_STALE_MS` | `120000` | A build marker older than this counts as dead (cross-isolate single-flight) |
| `SEO_AUDIT_MIN_REFRESH_MS` | `300000` | Minimum delay between two manual (`?nocache=1`) rebuilds |
| `SEO_AUDIT_BATCH_SIZE` | `10` | Docs per audit batch (max 100) |
| `SEO_AUDIT_BATCH_DELAY_MS`, `SEO_AUDIT_DOC_DELAY_MS`, `SEO_AUDIT_THROTTLE_RATIO` | `100`, `10`, `2` | Throttling of a Node build; dropped with `waitUntil` |
| `SEO_AUDIT_DEPTH` | `0` | Payload `depth` for audit reads |
| `SEO_AUDIT_FILE_CACHE`, `SEO_AUDIT_TRUST_FILE` | — | Node only: `0` ignores `auditCacheFile`; `1` serves it without the staleness check |
| `SEO_INDEXATION_MAX_DOCS` | `1500` | Docs scanned by `/indexation-audit` (one request) |
| `SEO_FETCH_MAX_DOCS` | `5000` | Docs loaded by other site-wide scans, `sitemap.xml` included |
| `SEO_SITEMAP_MAX_DOCS`, `SEO_SITEMAP_BATCH_SIZE` | `5000`, `50` | News/image/video sitemaps; the cap counts every doc read |
| `SEO_EXTERNAL_LINKS_MAX` | `100` | Unique external URLs per scan (the response says `capped`) |
| `SEO_EXTERNAL_LINKS_MAX_SUBREQUESTS` | `1000` | Subrequests per call; a scan that doesn't fit resumes on the next call |
| `SEO_LOGS_MAX_ROWS` | `5000` | Row cap of the 404 log |
| `OPENROUTER_API_KEY` | — | Enables the AI calls. Without it, meta suggestions fall back to heuristics and alt text / briefs answer `no_api_key`. Put a credit limit on the key |
| `SEO_AI_MODEL` | `deepseek/deepseek-v4.1-flash` | OpenRouter model. Must support structured outputs, and image input for alt text |
| `SEO_AI_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter, or a proxy such as Cloudflare AI Gateway |
| `SEO_AI_REASONING` | `none` | Reasoning effort, for models that can't turn it off |
| `SEO_AI_DATA_COLLECTION` | `deny` | `deny` routes only to providers that don't store or train on prompts; `allow` lifts it |
| `SEO_MEDIA_ORIGIN` | — | Extra origin alt text may fetch from when Payload's file route has no file |
| `GSC_OAUTH_CLIENT_ID`, `GSC_OAUTH_CLIENT_SECRET` | — | Google OAuth client for `gscApi`. Redirect URI: `<siteUrl>/api/seo-plugin/gsc/callback` |
| `SEO_GSC_ENCRYPTION_KEY` | derived from `PAYLOAD_SECRET` | 32-byte key (hex or base64) for the stored GSC token. Changing it, or the secret it derives from, forces a reconnect |
| `GOOGLE_PAGESPEED_API_KEY` / `PAGESPEED_API_KEY` | — | PageSpeed Insights key for Core Web Vitals |
| `SEO_INDEXNOW_KEY` | — | IndexNow key, required by `indexNow` |
| `SEO_ALERT_WEBHOOK_URL`, `SEO_ALERT_EMAIL` | — | Digest delivery for `alerts`. The webhook gets a JSON POST, `{ type: "seo-alert-digest", siteUrl, digest }`; a non-2xx answer counts as failed. The scheduled digest only knows `siteUrl` from the option or `SITE_URL` |
| `SEO_ALERT_SCORE_DROP`, `SEO_ALERT_POSITION_DROP`, `SEO_ALERT_WINDOW_HOURS`, `SEO_ALERT_INTERVAL_HOURS` | `10`, `5`, `24`, `24` | Digest thresholds; the interval only applies to the Node timer |
| `SEO_REQUIRE_ADMIN_ROLE` | — | `1` requires an explicit `admin` role (no fail-open on role-less setups) |
| `SEO_ADMIN_USER_COLLECTIONS` | `config.admin.user` | Comma-separated collections accepted as admin-panel users |
| `SEO_STRICT_READ_ACCESS` | — | `1` makes single-document reads honour the caller's ACL |

## API endpoints

Paths are relative to `/api/seo-plugin` (`endpointBasePath`). "Authenticated" means a logged-in **admin-panel** user (`config.admin.user`, widened with `SEO_ADMIN_USER_COLLECTIONS`). A session on another auth collection doesn't qualify, even though Payload sets `req.user` for it.

"SEO admin" adds a role check: `role: 'admin'` or an `admin` entry in `roles`, read from a string, an array, a select or a populated relationship. It falls back to any panel user only when the users collection has **no** `role`/`roles` field; `SEO_REQUIRE_ADMIN_ROLE=1` removes that fallback. The admin views and the plugin's collections apply the same rules.

### Always registered

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` `POST` | `/validate` | Authenticated | Full analysis of one document or global |
| `GET` | `/check-keyword` | Authenticated | Whether a focus keyword is used elsewhere (returns document ids) |
| `POST` | `/generate` | Authenticated | Runs your `generate*` functions |
| `POST` | `/suggest-links` | Authenticated | Internal-link suggestions |
| `GET` | `/breadcrumb` | Authenticated | Breadcrumb trail for a document |
| `GET` | `/health` | SEO admin | Module health |
| `GET` | `/robots.txt`, `/sitemap.xml`, `/sitemap-news.xml`, `/sitemap-images.xml`, `/sitemap-video.xml`, `/llms.txt` | Public | Generated files (drafts and `noindex` documents excluded) |
| `POST` | `/robots.txt` | SEO admin | Saves custom robots rules |

### Feature-gated

| Method | Path | Access | Feature |
|---|---|---|---|
| `GET` | `/audit` | Authenticated (`?nocache=1`: SEO admin, throttled) | `dashboard` |
| `GET` | `/indexation-audit` | Authenticated | `performance` |
| `GET` | `/history` | Authenticated | `scoreHistory` |
| `GET` | `/sitemap-audit`, `/sitemap-config` | Authenticated | `sitemapAudit` |
| `GET` / `PATCH` | `/settings` | Authenticated / SEO admin | `settings` |
| `GET` | `/redirects`, `/redirect-chains` | Authenticated | `redirects` |
| `POST` `PATCH` `DELETE` | `/redirects`, `POST /create-redirect` | SEO admin | `redirects` |
| `POST` | `/external-links` | Authenticated (`forceRefresh`: SEO admin) | `externalLinks` |
| `GET` / `POST` | `/performance` | Authenticated / SEO admin | `performance` |
| `GET` | `/core-web-vitals` | Authenticated | `performance` |
| `GET` | `/cannibalization`, `/duplicate-content`, `/link-graph`, `/keyword-research`, `/schema-generator` | Authenticated | their flags |
| `POST` | `/ai-generate`, `/ai-rewrite`, `/ai-optimize`, `/ai-content-brief` | Authenticated | `aiFeatures` |
| `GET` / `POST` | `/alt-text-audit` / `/ai-alt-text`, `/ai-optimize-bulk` | SEO admin | `aiFeatures` |
| `GET` / `POST` / `DELETE` | `/seo-logs` | Authenticated / `X-SEO-Secret` or SEO admin / SEO admin | `seoLogs` |
| `GET` | `/gsc/status` | Authenticated | `gscApi` |
| `GET` / `POST` | `/gsc/auth`, `/gsc/callback`, `/gsc/data` / `/gsc/disconnect`, `/rank-snapshot` | SEO admin | `gscApi` |
| `GET` | `/rank-history`, `/ctr-opportunities`, `/content-grade` | SEO admin | `gscApi` |
| `GET` / `POST` | `/alerts-digest` / `/alerts-run` | SEO admin | `alerts` |
| `GET` / `POST` | `/indexnow-key.txt` (public) / `/indexnow-submit` (SEO admin) | — | `indexNow` |
| `GET` `POST` | `/retention` | SEO admin | any time-series dataset enabled, or named in `retentionDays` |

Rate limits are per user (`collection:id`), falling back to the client IP. The buckets are in `SEO_RATE_LIMITS`: `expensive` (10/min: whole-site scans, bulk AI), `audit-poll` (120/min), `ai-interactive` (30/min: per-document AI clicks) and `seo-logs` (30/min).

## Admin views

| Path | View | Feature |
|---|---|---|
| `/admin/seo` | Site audit, filters, bulk actions, CSV/PDF export | `dashboard` |
| `/admin/sitemap-audit` | Orphans, weak pages, hubs, broken links; 404 and External tabs follow `seoLogs` / `externalLinks` | `sitemapAudit` |
| `/admin/seo-config` | Settings, thresholds, robots, sitemap options | `settings` |
| `/admin/redirects` | Redirect manager: CRUD, CSV import/export, chain detection | `redirects` |
| `/admin/performance` | Search Console imports, Core Web Vitals and the panels built on them | `performance` |
| `/admin/cannibalization` | Pages competing on the same query | `cannibalization` |
| `/admin/keyword-research` | Keyword research and content briefs | `keywords` |
| `/admin/schema-builder` | JSON-LD builder | `schemaBuilder` |
| `/admin/link-graph` | Internal link graph and crawl budget | `linkGraph` |

An SEO nav group lists the enabled views. Admin links go through `formatAdminURL`, so a custom admin route works.

## Collections

Registered only when their feature is on.

| Slug | Holds | Read | Write | Feature |
|---|---|---|---|---|
| `seo-settings` | Thresholds, sitemap and robots configuration | Authenticated | SEO admin | `settings` |
| `seo-redirects` | Redirect rules (slug configurable) | Authenticated | SEO admin | `redirects` |
| `seo-gsc-auth` | Encrypted OAuth tokens, never readable through the API | Authenticated | SEO admin | `gscApi` |
| `seo-score-history`, `seo-performance`, `seo-logs`, `seo-rank-history` | Time-series data | Authenticated | SEO admin | **only without `dataStore`** |

Every plugin collection sets `versions: false` (Payload 4 versions collections by default) and stays out of the sidebar (`admin.group: false`). The plugin also adds `isCornerstone`, `focusKeyword` and the `focusKeywords` array to each collection in `collections`, plus the `meta` group unless one exists.

## Package exports

| Entry | Contents | Environment |
|---|---|---|
| `@cargo/payload-seo-analyzer` | `seoAnalyzerPlugin`, `analyzeSeo`, frontend helpers, `createSqlSeoDataStore` / `migrateSeoStore`, `runSeoJobs`, `recordSeoNotFound`, retention helpers, `SEO_RATE_LIMITS`, field builders, endpoint factories and every type | Server |
| `@cargo/payload-seo-analyzer/shared` | `buildJsonLd`, `serializeJsonLd`, `validateRedirectTarget`, `normalizeFromPath`, with no package imports | Isomorphic |
| `@cargo/payload-seo-analyzer/client` | Admin React components (sidebar field, views, meta fields, `SerpPreview`, `SeoNavLink`) | Client (`'use client'`) |
| `@cargo/payload-seo-analyzer/client.css` | Admin styles. The ESM client bundle already imports them | Client |
| `@cargo/payload-seo-analyzer/views` | Server view wrappers rendered inside Payload's `DefaultTemplate` | Server (RSC) |

ESM and CJS builds ship with type declarations. `xlsx` (Search Console XLSX import) is optional and loaded through a non-literal import; map it in the host if you need it.

## Database and migrations

- **Payload migrations belong to the host.** Payload reads one migrations directory, in the app, never in a dependency. After adding a slug to `collections`, or turning on `settings`, `redirects`, `gscApi`, `jobs` or (without `dataStore`) a time-series feature, run `payload migrate:create` and commit the migration. In `apps/web`: `pnpm web migrate:create <name>`. CI fails when the schema and migrations disagree.
- **The SQL data store migrates itself.** `SEO_STORE_MIGRATIONS` is append-only and every statement is safe to run twice. Run `migrateSeoStore(db)` at deploy time (`pnpm web seo-store:migrate:remote`, part of `pnpm web run deploy`) so the first request doesn't pay for it.
- **Fields the plugin adds to your tables** (`isCornerstone`, `focusKeyword`, `focusKeywords`, `meta`) are editorial content. Don't drop them blindly; the `meta` group may belong to `@payloadcms/plugin-seo`.

Upgrade notes for upstream releases up to 4.2.2 (Payload 3) are in [`CHANGELOG.md`](CHANGELOG.md). Fork changes are in `git log -- packages/payload-seo-analyzer` and [`PLAN.md`](PLAN.md).

## Performance

Measured on a deployed Worker with 1,500 pages (Workers Observability `cpuTimeMs`):

| Work | CPU | Notes |
|---|---|---|
| Dashboard audit | ~10 ms per doc | Built in steps of 800 docs through `waitUntil`; the Cron Trigger finishes paused builds |
| `/indexation-audit` | 12.7 s at 1,500 docs | One request, hence `SEO_INDEXATION_MAX_DOCS=1500` |
| Uncached `sitemap-audit` / `sitemap.xml` | 1.2 s / 0.9 s | Cached afterwards (shared cache, invalidated on save) |
| Cached reads, `/validate`, admin views | ≤ 0.2 s | |
| External links scan | ≤ 65 ms per call | 5 links at a time, 5 s per request, resumes across calls |
| Cron tick (jobs) | 60–175 ms | Wall time is mostly Payload start-up |

The default Workers CPU limit is 30 s per invocation. The whole-site scans that are still off (link graph, keywords, cannibalization, duplicate content) run in one request and haven't been measured.

## Troubleshooting

- **Admin components don't update:** regenerate the import map (`pnpm web generate:importmap`).
- **The dashboard says "building" forever on Workers:** `cacheStore` or `waitUntil` is missing (`onInit` warns), or no Cron Trigger runs `runSeoJobs`.
- **A plugin env var has no effect on Workers:** declare it in `apps/web/.env.schema`. `--var` on deploy is silently replaced by the schema's value; set it in the shell instead (`SEO_AUDIT_STEP_DOCS=1 varlock-wrangler deploy`).
- **Admin login fails on a deployed Worker but works locally:** Payload 4 hashes with 600,000 PBKDF2 iterations and Workers reject more than 100,000. The repo patches `payload` (`patches/`); keep the patch when bumping it.
- **HTTP 429 in automated checks:** the expensive endpoints allow 10 calls a minute per user.
- **`index … already exists` on the first dev request after adding collections:** a drizzle/SQLite push quirk; the next request works.
- **Payload's dev push stops at a "data loss" prompt:** your local D1 has plugin tables that the current config doesn't. Restore the config, or migrate a fresh `.wrangler/state`.
- **Generated URLs don't match your routes:** set `collectionRoutes`, and pass the same map to `buildJsonLd` / `buildDocUrl`.

## Security

The threat model is in [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md). In short:

- Every endpoint needs an admin-panel session, except the public generated files.
- Secrets come from environment variables only.
- The GSC refresh token is encrypted with AES-256-GCM (WebCrypto, key from HKDF) and is never readable through the API.
- Redirect targets go through one policy (`redirectSafety.ts`), and robots rules are sanitized.
- Outbound fetches of user URLs go through an SSRF guard that blocks private addresses, odd IP encodings and redirects to them. The guard resolves DNS with `resolve4`/`resolve6` on Workers.
- JSON-LD is escaped by `serializeJsonLd`, and CSV exports are protected against formula injection.

In production:

- Set `SEO_GSC_ENCRYPTION_KEY` if you enable `gscApi`.
- Set `SEO_REQUIRE_ADMIN_ROLE=1` if your users have roles.
- Put a credit limit on the OpenRouter key.

## Development

From the repo root:

```sh
pnpm dev                                                # tsup --watch for the plugin + the app on :3000
pnpm --filter @cargo/payload-seo-analyzer test          # ~950 vitest tests (jsdom for components)
pnpm --filter @cargo/payload-seo-analyzer typecheck
pnpm build                                              # the plugin, then the production Worker
PAYLOAD_SECRET=test-secret pnpm web test:int            # app integration tests
E2E_PORT=3021 pnpm web test:e2e                         # Playwright, SEO views included
```

- CI (`.github/workflows/ci.yml`) runs lint, typecheck, these tests, the build, a migration and generated-files drift check, and the e2e suite on every PR.
- Ground rules are in [`PLAN.md`](PLAN.md#working-on-it): catalog versions, `versions: false` on collections, no literal dynamic `import()` of optional dependencies, the `@payloadcms/ui` test stub, append-only store migrations.
- Admin UI changes follow [`src/ui/README.md`](src/ui/README.md).
- Pull upstream fixes from the repo root with `git subtree pull --prefix=packages/payload-seo-analyzer https://github.com/pOwn3d/payload-seo-analyzer.git main`. Expect conflicts in `components/*`, `views/*`, `plugin.ts`, `rateLimiter.ts` and the collections.
- `e2e/` holds upstream's Next.js 16 + Payload 3 harness. It isn't a workspace member and doesn't run; the app's Playwright specs replace it.

## Uninstall

The `seo-analyzer-uninstall` script (`scripts/uninstall.mjs`) is upstream's. It removes the plugin from your source files and package manager, then regenerates the import map, but it hasn't been checked against Payload 4 or D1. By hand:

1. Remove `seoAnalyzerPlugin(...)` and the app glue (`servePluginFile`, the redirect and 404 hooks, the `scheduled` jobs call).
2. Run `generate:importmap` and `migrate:create`.
3. Drop `seo-gsc-auth` first if it exists: it holds an encrypted Google refresh token. Revoke the grant at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) too.
4. Delete the `SEO_D1` database and the R2 prefix `seo-analyzer/cache/`.

## License

MIT, see [LICENSE](LICENSE). Based on [`@consilioweb/payload-seo-analyzer`](https://github.com/pOwn3d/payload-seo-analyzer) by [ConsilioWEB](https://consilioweb.fr). Report upstream bugs there, and fork-specific ones in this repository.
