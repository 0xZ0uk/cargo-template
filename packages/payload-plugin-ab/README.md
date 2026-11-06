# @cargo/payload-plugin-ab

A/B testing for [Payload CMS](https://payloadcms.com) 4: create page variants in the admin, give each a share of traffic, and route visitors to them from your request handler. Runs on Node or Cloudflare Workers.

Cargo's fork of [`@focus-reactive/payload-plugin-ab`](https://github.com/focusreactive/payload-plugins/tree/main/packages/payload-plugin-ab) 2.10.1 by FocusReactive (MIT), which targets Payload 3 + Next.js. Imported with its history from upstream `e40c7a0` (2026-10-06) via `git subtree`: diff `packages/payload-plugin-ab` against that import to see what changed, or to pull upstream fixes. This fork:

- **Requires Payload 4** (`>=4.0.0-beta.6 <5`, from the workspace catalog) and has **no Next.js dependency**. The upstream Next.js middleware (`NextRequest` in, `NextResponse.rewrite` out) is now a framework-agnostic resolver: a Web `Request` (or its `Cookie` header) in, `{ bucket, pathname, variant, cookies, setCookieHeaders }` out. The host renders that path and sets the cookies. See [Routing](#routing).
- **Reads the manifest through the Local API** when the resolver runs next to Payload (pass `{ payload }`). Upstream always fetched `GET /api/globals/_abManifest`, which on a Worker is a subrequest to itself.
- **Stores the manifest one row per key, not publicly readable.** Upstream kept it in one JSON field on a public global and rewrote the whole value on every publish, so two publishes at once could drop one's update, and anyone could list every experiment. `payloadCollectionAdapter` writes only the published page's row, and the manifest and `ab-experiments` need a signed-in user over REST. An optional read cache keeps the per-page-view read off D1.
- **Opts out of Payload 4's default versioning** on the `ab-manifest` and `ab-experiments` collections. Both are rewritten by the plugin; their history would only add D1 rows.
- **Hides variants with `admin.baseFilter`**, Payload 4's name for `baseListFilter` (a host's own filter, under either name, is kept and combined). It also keeps variants out of Lexical's internal-link pickers.
- **Locks down `POST /api/_ab/duplicate`.** Upstream created the variant with `overrideAccess: true` after checking only *read* access, so any visitor could clone a published page. It now requires a signed-in user, only accepts collections the plugin is configured on, takes the slug field from the plugin config (not the request body), and creates the clone with the user's own access. It also refuses to make a variant of a variant.
- **Only the plugin writes the variant fields.** `_abVariantOf` and `_abPassPercentage` have field-level `create` / `update` access that only the duplicate endpoint passes (it sets a `req.context` marker, `AB_WRITE_CONTEXT_KEY`); the hooks write them with `overrideAccess: true`. A REST, GraphQL or MCP write (anything that enforces access) can't turn a page into a variant, skip the endpoint's checks (variant of a variant, created as a draft), or set a percentage directly: Payload drops the field and keeps the stored value. Percentages still change through the Variants panel's channel, `_abPendingPercentages` on a save of the original, which needs update access on the original and is validated against the 99% cap.
- **Creates variants as drafts** (when the collection has drafts), in every locale. Upstream duplicated a published original into an already-published variant, which took traffic and started the experiment the moment you clicked "Add variant". Payload 4 keeps `_status` per locale on localized collections, and a draft duplicate only drafts the request's locale, so the endpoint follows it with `unpublishAllLocales`. Experiment start dates likewise only count published variants.
- **Drops unpublished pages from the manifest.** Upstream recomputed only on publish, so unpublishing a variant left it taking traffic to a page that no longer served, and unpublishing the original left its variants running. Unpublishing either, in one locale or all, now updates those locales' entries.
- **Publishes only the percentage** with a partial `db.updateOne`. Upstream wrote back the whole raw row from `db.findOne`, which re-saves localized fields in one locale.
- **Admin panel on Payload 4 components and tokens**: `Button` / `Spinner` / `FieldLabel` / `ConfirmationModal` (instead of `window.confirm`) from `@payloadcms/ui`, styles in `VariantsField.css` on `--color-*` / `--field-color-*` / `--spacer-*` / `--radius-*` tokens (Payload 4 removed the v3 `--theme-elevation-*` tokens, which broke dark mode). API calls follow `routes.api`. "Clear all" deletes one variant at a time (parallel deletes raced on the manifest). The panel now receives the collection's slug and title fields (upstream never passed them).
- Drops the **Vercel Edge Config adapter** (no Vercel on Workers) and upstream's release tooling. Named `@cargo/payload-plugin-ab`, built with tsup, private to the workspace.

## How it works

Variants live **inside the same collection as the original page**:

```
pages collection
├── original   slug: "about"         _abVariantOf: null
├── variant A  slug: "about--4ji9qa" _abVariantOf: <original id>
└── variant B  slug: "about--x2k1zz" _abVariantOf: <original id>
```

On every publish, unpublish or delete, hooks recompute the **variant manifest** entries of that page, keyed by URL path, and write them to the storage adapter. The request resolver reads the entry for the requested path, assigns the visitor a bucket (sticky, by cookie), and tells the host which page to render.

```
Payload admin → afterChange / afterDelete hooks → storage adapter
                                                   { "/en/about": [variantA, variantB] }
                                                          ↓
request → resolveAbRewrite(request, …) → { pathname: "/en/about--4ji9qa", cookies }
                                                          ↓
                                          host loads that page, sets the cookies
```

## Install

In this monorepo, add it to an app as a workspace dependency:

```jsonc
// apps/web/package.json
"dependencies": { "@cargo/payload-plugin-ab": "workspace:*" }
```

Then run `pnpm web generate:importmap` (the Variants panel is an admin component), and `pnpm web migrate:create` (the plugin adds fields and two collections).

## Register the plugin

Share one adapter between the Payload config and the resolver:

```ts
// src/plugins/abTesting.ts
import { payloadCollectionAdapter } from '@cargo/payload-plugin-ab/adapters/payload-collection'

// `startedAt` is the experiment run's start (see Measurement > Runs).
export type AbVariant = { bucket: string; rewritePath: string; passPercentage: number; startedAt?: string }

export const abStorage = payloadCollectionAdapter<AbVariant>()
```

```ts
// payload.config.ts
import { abTestingPlugin } from '@cargo/payload-plugin-ab'
import { abStorage } from './plugins/abTesting'

export default buildConfig({
  plugins: [
    abTestingPlugin({
      storage: abStorage,
      collections: {
        pages: {
          // The manifest key, and (for a variant document) the path that serves it.
          generatePath: ({ doc, locale }) => {
            const slug = doc.slug as string | undefined
            if (!slug) return null
            return locale ? `/${locale}/${slug}` : `/${slug}`
          },
        },
      },
    }),
  ],
})
```

The plugin injects into each configured collection:

- the **Variants panel** (sidebar, on originals): variants with traffic % inputs, edit in a drawer, add, delete, clear all
- a read-only **"Variant of"** relationship (sidebar, on variants)
- the hidden `_abVariantOf`, `_abPassPercentage` and (virtual, no column) `_abPendingPercentages` fields
- `admin.baseFilter`, so variants don't show in the list view or link pickers
- `beforeChange` / `afterChange` / `afterDelete` hooks

and adds the `ab-manifest` and `ab-experiments` collections (both hidden unless `debug: true`) and `POST /api/_ab/duplicate` (plus the measurement endpoints with `measurement`, see [Measurement](#measurement)).

### Traffic percentages

Each variant owns its `_abPassPercentage`, versioned with the variant document: the draft holds the value being edited, the published version the value the manifest serves.

Editing percentages in the panel stages them in `_abPendingPercentages`, sent with the original's own save:

- **Save draft** on the original writes the new percentages to each variant's draft. Live traffic keeps the published split.
- **Publish** on the original publishes them to the variants. Only the percentage is published: a variant's unpublished content stays unpublished until that variant is published.
- A variant that has never been published takes no traffic, whatever its percentage says. New variants start as drafts.
- With localization, Payload 4 keeps publication status per locale: a variant takes traffic in the locales it's published in (Payload's "publish in all locales" covers all of them), each locale with its own manifest entry.
- Unpublishing a variant removes it from the split in those locales; unpublishing the original stops the experiment there until it's published again.

Variants together take at most 99%, leaving the original at least 1%. A save that breaks this fails with a validation error.

## Routing

`createResolveAbRewrite` builds the per-request resolver. It has no Payload or framework import, so it runs anywhere a Web `Request` does.

```ts
resolveAbRewrite(
  request,             // Request, or the Cookie header string
  visiblePathname,     // the URL the visitor sees (kept for upstream parity)
  manifestKey,         // the path generatePath returned for the original
  originalRewritePath, // what to render for the 'original' bucket
  { payload },         // optional: read the manifest through the Local API
) // → Promise<AbRewrite | null>
```

It returns `null` when the path runs no experiment (or the manifest can't be read): render the page as requested. Otherwise, including for a returning visitor already in the original bucket (no cookies to set, but the view still counts):

```ts
{
  bucket: 'about--4ji9qa',            // or 'original'
  pathname: '/en/about--4ji9qa',      // the page to render
  variant: { bucket, rewritePath, passPercentage } | null,
  visitorId: '7d0c…',                 // from the cookie, or new (then also in cookies)
  cookies: [{ name, value, options: { path: '/', sameSite: 'lax', maxAge } }],
  setCookieHeaders: ['payload_ab_bucket_en_about=about--4ji9qa; Path=/; Max-Age=…'],
}
```

### TanStack Start

There's no URL rewrite to do: the page loader's server function resolves the bucket and loads the variant's document instead of the original. Skip it for drafts and previews.

```ts
import { createResolveAbRewrite } from '@cargo/payload-plugin-ab/middleware'
import { abStorage, type AbVariant } from '@/plugins/abTesting'

const resolveAb = createResolveAbRewrite<AbVariant>({
  storage: abStorage,
  getBucket: (v) => v.bucket,
  getRewritePath: (v) => v.rewritePath,
  getPassPercentage: (v) => v.passPercentage,
})

// In loadPage's handler, for a visitor seeing the published page:
const { appendResponseHeader, getRequestHeader } = await import('@tanstack/react-start/server')
const key = `/en/${data.slug}`
const ab = draft ? null : await resolveAb(getRequestHeader('cookie'), key, key, key, { payload })
for (const header of ab?.setCookieHeaders ?? []) appendResponseHeader('Set-Cookie', header)
const slug = ab?.variant?.bucket ?? data.slug // the default variant data's bucket is its slug
```

The loader also runs as a server-function call on client-side navigation; the browser sends the cookies with it and keeps the ones it sets, so assignment stays sticky either way.

Things the host decides:

- **Caching.** A response that depends on the visitor's bucket must not be shared from a cache keyed only by URL, original bucket included. Decide from the manifest (`storage.read(key)` has variants) rather than from the resolver's result, which is also `null` when the manifest read fails. `apps/web` reads the manifest once and runs the resolver on it (`routeAb` in `src/plugins/abTesting.ts`).
- **SEO.** Variant pages are ordinary published pages at their own slug (`/about--4ji9qa`). Point their canonical URL at the original, and leave them out of the sitemap. `apps/web` redirects (302) a visitor who asks for a variant at its own URL, builds the canonical URL from the requested slug, and excludes `_abVariantOf` documents with the SEO analyzer's `excludeDocs` option.

### Cookies

| Cookie | Default name | Lifetime | Purpose |
| --- | --- | --- | --- |
| Bucket | `payload_ab_bucket_{key}` (`/` → `_`, then URI-encoded) | 90 days | The visitor's bucket for this page |
| Visitor ID | `ab_visitor_id` | 365 days | Stable visitor id for analytics |
| Experiment | `exp_{encodeURIComponent(key)}` | 90 days | The bucket, readable by `ExperimentTracker` |

Keys are URI-encoded in cookie names (with `(` and `)` escaped too), since a name must be plain ASCII without separators: `/fr/à-propos` becomes `payload_ab_bucket_fr_%C3%A0-propos`. If the bucket cookie is gone, the assignment is restored from the experiment cookie; a bucket whose variant no longer exists is drawn again. Override names and lifetimes with `cookies` (`bucketCookiePrefix`, `visitorIdCookieName`, `getExpCookieName`, `visitorIdMaxAge`, `expCookieMaxAge`, `bucketCookieMaxAge`, in seconds), and use `resolveAbCookieNames(config, key)` to hand the same names to `ExperimentTracker`.

## Measurement

Pass `measurement` to count conversions and show results in the Variants panel. The plugin owns the endpoints, their checks and the panel; the host owns the store:

```ts
abTestingPlugin({
  // …
  measurement: {
    goals: ['cta'], // default
    // Called once per visitor, experiment run and bucket. `visitorId` is pseudonymous but persistent.
    recordConversion: ({ experiment, bucket, goal, visitorId }, req) => { /* write it */ },
    // Optional: runs first on every conversion request; false answers 429 and records nothing.
    rateLimit: async (req) => (await env.MY_LIMITER.limit({ key: clientIp(req) })).success,
    // Server only: credentials stay here.
    // `endedAt` is set for a run that ended (count up to it), undefined for the current run.
    getResults: async ({ experiment, startedAt, endedAt, req }) =>
      ({ configured: true, buckets: [{ bucket: 'original', impressions: 120, conversions: 6 }] }),
      // or { configured: false, reason: 'Set … to see results.' }
  },
})
```

- **`POST /api/_ab/convert`**, body `{ experiment, goal }` (JSON; `navigator.sendBeacon`'s `text/plain` works too). The bucket and visitor id come from the request's own cookies, never from the body; the bucket must be live in the manifest (`409` otherwise, `404` without an experiment, `400` for a bad body or unknown goal). The first conversion sets an HttpOnly marker cookie (`payload_ab_cv_{key}`, value `<bucket>:<run>`, 90 days) and later ones in the same run answer `{ recorded: false, reason: 'duplicate' }`. The cookies are `SameSite=Lax`, so a cross-site form post carries none and can't convert for a visitor. The endpoint is unauthenticated and the marker is the client's own cookie, so pass `rateLimit` (e.g. per IP) to bound what a script that drops it can add; when it resolves `false` the endpoint answers `429` and records nothing (if it throws, the request goes through and the error is logged).
- **`GET /api/_ab/results?collection=&id=&locale=`**: for users of the admin panel's auth collection only (`req.user.collection === config.admin.user`), who must also be able to read the document. The manifest key comes from `generatePath` on that document, and `startedAt` from its open `ab-experiments` row. `experiment` and `results` are null while no variant is published. `pastRuns` lists the runs on that document and locale that ended in the last 90 days, most recent first (at most 10): `{ key, startedAt, endedAt, results }`, each with its own `getResults` call bounded by `endedAt` (a failing one gets `results: null` and `error`, without hiding the others).
- **The panel** shows a results table under the variants (original, current variants, then "Deleted variant (bucket)" rows for data whose variant is gone), with totals, or the host's `reason` when `configured` is false. A bucket is matched to a variant by slug, as in the default variant data. Past runs sit in a collapsed "Past experiments" section, each with its dates and its own table (the original, the variants with data, deleted ones labelled), or the `reason` when `configured` is false. With no variants left the panel shows only that section, and nothing without past runs.

Impressions are the host's to count (the plugin doesn't see page views): `apps/web` counts one per visitor, run and bucket in its page loader.

### Runs

An experiment runs on a manifest key from its first published variant until it has none left. The recompute that writes the manifest keeps its `ab-experiments` row in step: the first published variant creates the row (`startedAt` = now), and when the key's entry is cleared (the last variant unpublished or deleted, or the original unpublished) the run ends: the row gets `endedAt` = now and stays, so its results (`startedAt` → `endedAt`) remain in the panel. Publishing a variant again later starts a new run (a new row with a new `startedAt`), so results count from then, not from the first experiment ever run on the page. Deleting the original deletes all its rows, ended or not.

Ended rows are kept for `AB_RUN_RETENTION_DAYS` (90, Analytics Engine's retention: after that the events behind the results are gone). The plugin doesn't schedule anything: call `pruneEndedExperimentRuns(payload, { experimentsCollectionSlug?, retentionDays?, limit? })` from the host's scheduler. It deletes up to `limit` (100) rows of runs that ended more than `retentionDays` ago, never an open run, and returns how many it deleted. `apps/web` calls it from its Cron Trigger (`src/server.ts`). The panel only lists runs that ended within the window, so a late prune shows nothing stale.

A variant created by `POST /api/_ab/duplicate` on a collection with drafts skips the manifest recompute (the `AB_SKIP_RECOMPUTE_CONTEXT_KEY` `req.context` marker): it takes no traffic, and the moment between the copy (still published in the other locales under Payload 4's per-locale `_status`) and its unpublish would otherwise start and end a run.

The default variant data carries the run's `startedAt` on every entry (a custom `generateVariantData` receives it as `startedAt`), so a resolver knows the run from the manifest read it already makes. The dedupe markers hold `abRunMarker(bucket, startedAt)` (`/middleware`): `<bucket>:<startedAt in base-36 ms>`. A visitor returning in a new run on the same page doesn't match their old marker and is counted again.

### Known biases

- Browsers that refuse cookies count an impression on every view and can never convert.
- Bots that run no JS add impressions but no conversions.
- A determined client can still forge conversions: anyone who fetches the page gets valid bucket and visitor cookies, and by dropping the marker can post a conversion each time, up to the host's `rateLimit` (per IP, in `apps/web` 20 a minute), and more from many IPs. The counts are fit for comparing variants, not for anything paid per conversion.
- The bucket cookie outlives a run: a returning visitor stays in the original bucket in the next run on the same page (a bucket whose variant is gone is drawn again).
- During the host's manifest-cache window (`apps/web`: up to 30 s) a just-removed variant's bucket can still receive an impression, and the first views of a new run can carry the previous run's marker value.

## GA4

Mount `<ExperimentTracker experimentId={manifestKey} />` (from `@cargo/payload-plugin-ab/analytics`, a client component) on variant-served pages. It sets three GA4 event-scoped parameters with `gtag('set', …)`: `fr_ab_experiment` (the manifest key), `fr_ab_variant` (the bucket) and `fr_ab_visitor_id`. Register them as custom dimensions in GA4. It does nothing when `gtag` never loads.

The `ab-experiments` collection records the `startedAt` of each experiment run, and the `endedAt` of runs that ended (see [Runs](#runs)).

## Configuration

```ts
interface AbTestingPluginConfig<TVariantData extends object> {
  storage: StorageAdapter<TVariantData>
  collections: Record<string, CollectionABConfig<TVariantData>>
  enabled?: boolean                    // default true
  debug?: boolean                      // show the manifest and experiments collections. default false
  experimentsCollectionSlug?: string   // default 'ab-experiments'
  measurement?: AbMeasurementConfig    // conversions and results, see Measurement
}

interface CollectionABConfig<TVariantData> {
  generatePath: (args: { doc: Record<string, unknown>; locale: string | undefined }) => string | null
  generateVariantData?: (args: { doc; variantDoc; locale; startedAt }) => TVariantData
  // default: { bucket: variant slug, rewritePath: generatePath(variantDoc), passPercentage, startedAt }
  slugField?: string   // default 'slug'; variants get `{slug}--{6 chars}`
  tenantField?: string // hidden on variants
  nameField?: string   // variant title in the panel; default: the collection's useAsTitle
}

interface StorageAdapter<TVariantData extends object> {
  write(path: string, variants: TVariantData[], payload: Payload): Promise<void>
  read(path: string, payload?: Payload): Promise<TVariantData[] | null> // called per request
  clear(path: string, payload: Payload): Promise<void>
  createGlobal?(debug: boolean): GlobalConfig         // storage the plugin adds to the config
  createCollection?(debug: boolean): CollectionConfig
}
```

`write` touches only its key and runs on every recompute, draft autosaves included: skip it when the stored value is already `variants`.

With localization on, `generatePath` is called once per locale and each locale gets its own manifest entry (`locale` is `undefined` without localization).

### payloadCollectionAdapter

```ts
payloadCollectionAdapter<TVariantData>({
  collectionSlug?: string // default 'ab-manifest'
  serverURL?: string      // REST fallback, when read gets no payload. default ''
  apiRoute?: string       // default '/api'
  authorization?: string  // Authorization header for the REST fallback, e.g. 'users API-Key <key>'
  cache?: ManifestCache<TVariantData>
  cacheTtl?: number       // seconds. default 30
})
```

Stores the manifest in a hidden collection, one row per manifest key: `key` (unique, indexed) and `variants` (JSON). A write finds its key's row and updates it (skipped when unchanged), or creates it; if another write created the same new key first, it re-finds the row and updates it once. A clear deletes the row. `read` is one indexed lookup (`pagination: false`, so no count query) through the Local API when given `payload`.

Signed-in users can read the collection (the `debug` view, an authenticated REST read); nobody can write it over the API, and visitors can't read it. The plugin uses the Local API with `overrideAccess: true`. Without `payload`, `read` fetches `{serverURL}{apiRoute}/{collectionSlug}?where[key][equals]=…` with `authorization`; with no `authorization` it returns `null` (no experiment) without fetching.

#### Read cache

Every routed page view calls `read`. Pass a `cache` to serve it from memory or a platform cache instead of D1:

```ts
interface ManifestCache<TVariantData> {
  get(key: string): TVariantData[] | null | undefined | Promise<…> // undefined: miss; null: no experiment
  set(key: string, value: TVariantData[] | null, ttlSeconds: number): void | Promise<void>
  delete(key: string): void | Promise<void>
}
```

Reads are cache-first, and a key with no experiment is cached as `null`, so pages without experiments skip D1 too once warm. Writes and clears update the cache after storage succeeds (a failed write drops the entry), and a cache error falls back to storage. Store values only: on Workers a promise belongs to the request that created it, so a cache must never hold an in-flight read.

`createMemoryManifestCache({ maxEntries? })` is a reference implementation in a `Map`, per process (per isolate on Workers). For another adapter, `withManifestCache(adapter, { cache, ttl })` adds the same behaviour.

#### Known limits

- **Same-key writes are last-write-wins.** Writes for different pages never collide, but two recomputes of the same page at the same instant (D1 has no transactions) keep whichever lands last. Both are computed from the same variant documents, and the next publish of that page rewrites the entry.
- **Cache staleness is bounded by `cacheTtl`.** Only the cache in the isolate (or, for a per-colo cache such as the Workers Cache API, the colo) that made a change sees it at once. Elsewhere, a cached entry keeps routing to the old variants, including an unpublished or deleted one, until it expires: 30 seconds by default. A globally replicated cache with its own propagation delay (such as KV) adds that delay.

## Exports

| Import path | Exports |
| --- | --- |
| `@cargo/payload-plugin-ab` | `abTestingPlugin`, `resolveAbCookieNames`, `pruneEndedExperimentRuns`, `AB_EXPERIMENTS_SLUG`, `AB_DIMENSION_PARAMS`, `AB_RUN_RETENTION_DAYS`, `DEFAULT_CONVERSION_COOKIE_PREFIX`, types (including `ManifestCache`, `AbMeasurementConfig`, `AbResults`, `AbResultsResponse`, `AbPastRun`) |
| `@cargo/payload-plugin-ab/adapters/payload-collection` | `payloadCollectionAdapter`, `withManifestCache`, `createMemoryManifestCache`, types |
| `@cargo/payload-plugin-ab/middleware` | `createResolveAbRewrite`, `parseCookieHeader`, `serializeAbCookie`, `bucketCookieName`, `resolveAbCookieNames`, types |
| `@cargo/payload-plugin-ab/analytics` (also `/analytics/client`) | `ExperimentTracker`, `resolveAbCookieNames`, types |
| `@cargo/payload-plugin-ab/admin/VariantsField` | the Variants panel (import-map path) |

## Development

```bash
pnpm --filter @cargo/payload-plugin-ab test       # unit + Payload 4 integration (in-memory SQLite)
pnpm --filter @cargo/payload-plugin-ab typecheck
pnpm --filter @cargo/payload-plugin-ab build
```

`tests/integration/boot.test.ts` boots Payload 4 with drafts and two locales and drives the endpoint and REST calls through Payload's own handler: duplicate auth, variant drafts, per-locale manifest entries, staged and published percentages (with an unpublished variant edit that must stay unpublished), unpublishing a variant or the original, deletes, the measurement endpoints (conversion cookies, dedupe and validation; results auth and key lookup), and the manifest storage (concurrent writes to different keys, a create race on one key, REST access with and without a session or credentials). `tests/cache/` covers the read cache. `tests/payload4Tokens.test.ts` keeps v3 admin tokens out of the styles.

## License

MIT, © FocusReactive. See [LICENSE](LICENSE).
