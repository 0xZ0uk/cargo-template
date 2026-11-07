# Changelog

## [Unreleased]

### Added

- Promote a variant: `POST /api/_ab/promote` (body `{ collectionSlug, docId, variantId }`) and a **Promote** button with a confirmation on each row of the Variants panel. It copies the variant's published content (what visitors were tested on; a never-published variant is refused) onto the original as a draft in every locale, then deletes the variants, which ends the run (it stays listed as a past experiment). The slug, `id`, timestamps, `createdBy`/`updatedBy`, `_status` and the A/B fields are never copied (`DEFAULT_PROMOTE_SKIP_FIELDS`); the new per-collection `promoteSkipFields` adds more. Admin-panel users with update access on the original and delete access only; the variants are deleted with the user's own access. A failed copy deletes nothing, and the response reports partial failures (`step`, `copiedLocales`, `deleted`, `failed`).

### Changed

- A run ends instead of being deleted: when a key's manifest entry is cleared, its open `ab-experiments` row gets the new `endedAt` field and stays (the next published variant starts a new row). Only open rows (`endedAt` empty) count as the current run, in the recompute, the conversion endpoint and the results endpoint. Deleting the original still deletes all its rows. Hosts need a migration adding the `ended_at` column.
- `GET /api/_ab/results` also returns `pastRuns`: runs on the document and locale that ended in the last 90 days, each with its results from `startedAt` to `endedAt`. `measurement.getResults` receives `endedAt` for those (undefined for the current run). The Variants panel lists them in a collapsed "Past experiments" section, also when no variant is left.
- `POST /api/_ab/duplicate` skips the manifest recompute for a draft copy (`AB_SKIP_RECOMPUTE_CONTEXT_KEY`), which, under per-locale `_status`, briefly routed the other locales to the copy and started a run.

- **Breaking:** `payloadGlobalAdapter` (`/adapters/payload-global`) is replaced by `payloadCollectionAdapter` (`/adapters/payload-collection`). The manifest moves from the `_abManifest` global to the hidden `ab-manifest` collection, one row per key (`key` unique and indexed, `variants` JSON). A write updates or creates only its key's row and a clear deletes it, so concurrent publishes of different pages no longer drop each other's entries. A create race on a new key re-finds the row and updates it. No data migration: the plugin wasn't registered in an app yet.
- **Breaking:** the manifest and `ab-experiments` are no longer publicly readable: REST reads need a signed-in user, and nobody writes the manifest over the API. The adapter's REST fallback sends the new `authorization` option and returns `null` without it.
- `StorageAdapter.createCollection?(debug)` lets an adapter add a collection, like `createGlobal`.
- **Breaking:** `_abVariantOf` and `_abPassPercentage` have field-level `create`/`update` access: only `POST /api/_ab/duplicate` (through the `AB_WRITE_CONTEXT_KEY` `req.context` marker) and the plugin's own `overrideAccess` writes can set them. REST, GraphQL and MCP writes can no longer create variants, variants of variants, or change percentages directly.
- The unchanged-entry check moved from the recompute into the adapter's `write`, so a cached read can't wrongly skip a write.
- **Breaking:** the resolver returns `null` only when the page runs no experiment (or the manifest can't be read). A returning visitor already in the original bucket now gets `{ bucket: 'original', variant: null, cookies: [] }` instead of `null`, so hosts can count that view; before, the original bucket was under-counted. The result also carries `visitorId`.

### Added

- `pruneEndedExperimentRuns(payload, options?)` deletes the rows of runs that ended more than `AB_RUN_RETENTION_DAYS` (90) days ago, for the host's scheduler.

- Measurement (`measurement` option): `POST /api/_ab/convert` records a conversion for the requesting visitor, with the bucket and visitor id read from their cookies and checked against the live manifest, once per visitor, experiment and bucket (HttpOnly marker cookie); `GET /api/_ab/results` returns counts per bucket since the experiment started, for admin-panel users only; the Variants panel shows them (impressions, conversions, rate, deleted variants) through the new `resultsPath` client prop. The host supplies `recordConversion` and `getResults`, so the store is its choice. Without the option none of this exists.
- `bucketCookieName` (`/middleware`) and an `httpOnly` cookie option for `serializeAbCookie`.
- Experiment runs: the manifest recompute starts a run (an `ab-experiments` row) when a key gets published variants and ends it (deletes the row) when the key's entry is cleared, so a later experiment on the same page gets a fresh `startedAt`. Before, the first run's row was kept until the original was deleted. The default variant data carries the run's `startedAt`, and `generateVariantData` receives it. `ensureExperimentRecords` is gone.
- `abRunMarker(bucket, startedAt)` (`/middleware`): the conversion marker (`payload_ab_cv_*`) holds `<bucket>:<run>`, so a returning visitor converts again in a new run.
- `measurement.rateLimit(req)`: an optional limiter for `POST /api/_ab/convert`; `false` answers 429 and records nothing.
- Optional read cache: `ManifestCache` (`get`/`set`/`delete` with a TTL), the adapter's `cache` and `cacheTtl` (default 30 s) options, `withManifestCache` for any adapter, and `createMemoryManifestCache` as a reference implementation. Reads are cache-first with negative entries for keys without an experiment; writes and clears update the cache.

## [3.0.0-beta.0] - 2026-11-05

Shipment's fork (`@shipment/payload-plugin-ab`) of upstream 2.10.1 (`e40c7a0`), ported to Payload 4 and to hosts without Next.js (TanStack Start on Cloudflare Workers). See the README for the full list.

### Changed

- **Payload 4** (`>=4.0.0-beta.6 <5`) replaces Payload 3; `next` is no longer a peer.
- **Breaking:** `createResolveAbRewrite` (`/middleware`) takes a Web `Request` or a `Cookie` header string and returns `{ bucket, pathname, variant, cookies, setCookieHeaders }` instead of a `NextResponse` rewrite. An optional fifth argument `{ payload }` is passed to `storage.read`.
- `StorageAdapter.read(path, payload?)`: `payloadGlobalAdapter` reads through the Local API when it gets `payload`, instead of fetching its own REST API.
- `_abManifest` and `ab-experiments` set `versions: false` (Payload 4 versions globals and collections by default).
- Variants are hidden with `admin.baseFilter` (Payload 4's name for `baseListFilter`), combined with the host's own filter under either name.
- `POST /api/_ab/duplicate` requires a signed-in user, accepts only configured collections, takes the slug field from the plugin config, and creates the variant with the user's access (it used `overrideAccess: true`). Variants of variants are refused. The 6-character suffix uses `crypto.getRandomValues`.
- New variants are created as drafts when the collection has drafts, in every locale (`unpublishAllLocales`, since Payload 4 localizes `_status`), so they take no traffic until published. `ab-experiments` rows are only created for published variants.
- Unpublishing a variant or the original, in one locale or all, updates the manifest: the variant's entries, or the original's whole entry, are dropped for the locales no longer published. Upstream only recomputed on publish, so an unpublished variant kept its traffic. A draft save of a published document still leaves the manifest alone, and unchanged entries aren't rewritten.
- `ab-experiments` rows are matched by `parentCollection` as well as `parentDocId`/`manifestKey`, so deleting a document no longer deletes the experiments of a same-id document in another A/B collection.
- Manifest keys are URI-encoded in the default bucket and experiment cookie names (`(` and `)` too), so a non-ASCII slug yields a valid cookie name instead of a `Set-Cookie` browsers drop.
- Publishing a percentage writes only `_abPassPercentage` to the published row (`db.updateOne`), not the whole raw row.
- Variants panel: Payload 4 components (`ConfirmationModal` for "Clear all", `Spinner`, `FieldLabel`) and tokens in `VariantsField.css`; API calls follow `routes.api`; "Clear all" deletes sequentially; the panel receives the collection's slug and title fields. `hideOnVariant` keeps a field's own `admin.condition`.
- Package name `@shipment/payload-plugin-ab`; the admin import-map path is `@shipment/payload-plugin-ab/admin/VariantsField#VariantsField`. `/analytics` and `/analytics/client` are the same client bundle.

### Added

- `parseCookieHeader` and `serializeAbCookie` (`/middleware`).
- Integration tests on real Payload 4 (in-memory SQLite, drafts, two locales) and a v3-token guard.

### Removed

- `vercelEdgeAdapter` (`/adapters/vercel-edge`) and the `@vercel/edge-config` optional dependency.
- Upstream's release tooling, plans and bundled Claude skill.
- The unused internal `isFieldPathExists` utility.

---

Upstream history (`@focus-reactive/payload-plugin-ab`):

## @focus-reactive/payload-plugin-ab [2.10.1](https://github.com/focusreactive/payload-plugins/compare/@focus-reactive/payload-plugin-ab@2.10.0...@focus-reactive/payload-plugin-ab@2.10.1) (2026-10-06)


### Bug Fixes

* **ab:** keep the A/B variant across browser sessions ([12221ce](https://github.com/focusreactive/payload-plugins/commit/12221ce3fd3c5471a45b02f077fe693de18b3b1a))

# @focus-reactive/payload-plugin-ab [2.10.0](https://github.com/focusreactive/payload-plugins/compare/@focus-reactive/payload-plugin-ab@2.9.0...@focus-reactive/payload-plugin-ab@2.10.0) (2026-08-12)


### Bug Fixes

* **ab:** keep the variant delete button hover dark-theme aware ([183d292](https://github.com/focusreactive/payload-plugins/commit/183d292819f6b83204454c638105fdbbeadc2bed))


### Features

* **ab:** drive variant percentage writes from a validated plan ([a37e44e](https://github.com/focusreactive/payload-plugins/commit/a37e44e81c25ae46630eaf94a4316ad665b9ba47))
* **ab:** drop the persisted variant percentages buffer ([f67de64](https://github.com/focusreactive/payload-plugins/commit/f67de640bdfc67a8defff2448330f6597c7c8275))
* **ab:** make variants the single owner of their traffic percentage ([85be211](https://github.com/focusreactive/payload-plugins/commit/85be211eac86f08ca841e4f4bc0da50781dd0294))
* **ab:** stage variant percentages from the panel via the virtual field ([d0042b9](https://github.com/focusreactive/payload-plugins/commit/d0042b92ab84f06ccf5fdefbc7769ce32d5e46bd))

# @focus-reactive/payload-plugin-ab [2.9.0](https://github.com/focusreactive/payload-plugins/compare/@focus-reactive/payload-plugin-ab@2.8.0...@focus-reactive/payload-plugin-ab@2.9.0) (2026-06-18)


### Features

* **ab:** validate storage/collections options and Vercel Edge adapter config ([1c3a659](https://github.com/focusreactive/payload-plugins/commit/1c3a659222fd72d1e72b6a9442b2903af8b46a8e))

# @focus-reactive/payload-plugin-ab [2.8.0](https://github.com/focusreactive/payload-plugins/compare/@focus-reactive/payload-plugin-ab@2.7.0...@focus-reactive/payload-plugin-ab@2.8.0) (2026-06-17)


### Bug Fixes

* **ab:** clean up manifest and promote variants on control deletion ([90fd756](https://github.com/focusreactive/payload-plugins/commit/90fd7562d096b2865fec382b49acd761c32a6061))


### Features

* **ab:** group ab experiments collection into system ([7973d03](https://github.com/focusreactive/payload-plugins/commit/7973d03c9682e07d7729568950ccc32fa1823a2a))

# @focus-reactive/payload-plugin-ab [2.7.0](https://github.com/focusreactive/payload-plugins/compare/@focus-reactive/payload-plugin-ab@2.6.0...@focus-reactive/payload-plugin-ab@2.7.0) (2026-06-04)


### Features

* **ab:** replace analytics adapter with GA4-native dimension tracking ([d3bb9ce](https://github.com/focusreactive/payload-plugins/commit/d3bb9cee3712349e91665d6400a8b751791d38ea))

# @focus-reactive/payload-plugin-ab [2.6.0](https://github.com/focusreactive/payload-plugins/compare/@focus-reactive/payload-plugin-ab@2.5.0...@focus-reactive/payload-plugin-ab@2.6.0) (2026-05-25)


### Features

* **cms:** import payload CMS app from cms-kit into monorepo ([f1a423c](https://github.com/focusreactive/payload-plugins/commit/f1a423c65ae39bdeb1e47702637c1cb4b92415e5))


### Reverts

* **format:** undo ultracite mass reformat on existing plugins ([d608685](https://github.com/focusreactive/payload-plugins/commit/d6086859295f006db109fa07acf2020652713a39)), closes [#12](https://github.com/focusreactive/payload-plugins/issues/12)

# @focus-reactive/payload-plugin-ab [2.5.0](https://github.com/focusreactive/payload-plugins/compare/@focus-reactive/payload-plugin-ab@2.4.6...@focus-reactive/payload-plugin-ab@2.5.0) (2026-05-13)


### Features

* **ab-testing:** open variation to edit in a drawer instead of a new page ([92a8266](https://github.com/focusreactive/payload-plugins/commit/92a82669869bd4807360e95e6fd1e8575532844c))

## @focus-reactive/payload-plugin-ab [2.4.6](https://github.com/focusreactive/payload-plugins/compare/@focus-reactive/payload-plugin-ab@2.4.5...@focus-reactive/payload-plugin-ab@2.4.6) (2026-05-06)


### Bug Fixes

* **payload-plugin-ab:** fetch variants with draft true in variants field ([0c771e3](https://github.com/focusreactive/payload-plugins/commit/0c771e3163de3c57f0ad928f8aa18e78f9984790))

## @focus-reactive/payload-plugin-ab [2.4.5](https://github.com/focusreactive/payload-plugins/compare/@focus-reactive/payload-plugin-ab@2.4.4...@focus-reactive/payload-plugin-ab@2.4.5) (2026-05-04)


### Bug Fixes

* **payload-plugin-ab:** set new variant to 1% without redistributing existing percentages ([add7e4b](https://github.com/focusreactive/payload-plugins/commit/add7e4bbe66a2c16c53b6a921ef84298e0fd3519))

## @focus-reactive/payload-plugin-ab [2.4.4](https://github.com/focusreactive/payload-plugins/compare/@focus-reactive/payload-plugin-ab@2.4.3...@focus-reactive/payload-plugin-ab@2.4.4) (2026-05-04)


### Bug Fixes

* **payload-plugin-ab:** publish variants and recompute manifest on duplicate ([9e25328](https://github.com/focusreactive/payload-plugins/commit/9e253285dae96866a05251ec09277802613c8df5))

## @focus-reactive/payload-plugin-ab [2.4.3](https://github.com/focusreactive/payload-plugins/compare/@focus-reactive/payload-plugin-ab@2.4.2...@focus-reactive/payload-plugin-ab@2.4.3) (2026-05-04)


### Bug Fixes

* **payload-plugin-ab:** keep variant duplication as draft to avoid localized validation failures ([b44237b](https://github.com/focusreactive/payload-plugins/commit/b44237b8aab83a3ecd6e34f3e257904b1e8b586d))

## @focus-reactive/payload-plugin-ab [2.4.2](https://github.com/focusreactive/payload-plugins/compare/@focus-reactive/payload-plugin-ab@2.4.1...@focus-reactive/payload-plugin-ab@2.4.2) (2026-05-04)


### Bug Fixes

* **payload-plugin-ab:** redistribute variant percentages atomically on duplicate ([0b85744](https://github.com/focusreactive/payload-plugins/commit/0b85744af9950bd1d72b3706de4ad4551d410ee7))

## @focus-reactive/payload-plugin-ab [2.4.1](https://github.com/focusreactive/payload-plugins/compare/@focus-reactive/payload-plugin-ab@2.4.0...@focus-reactive/payload-plugin-ab@2.4.1) (2026-05-04)


### Bug Fixes

* **payload-plugin-ab:** populate parent doc relationships in manifest recompute ([fdb0b28](https://github.com/focusreactive/payload-plugins/commit/fdb0b28bac336b87d33b63a50f865459a25c9b50))

# @focus-reactive/payload-plugin-ab [2.4.0](https://github.com/focusreactive/payload-plugins/compare/@focus-reactive/payload-plugin-ab@2.3.2...@focus-reactive/payload-plugin-ab@2.4.0) (2026-03-31)


### Bug Fixes

* remove redundant isolatedModules and align [@types](https://github.com/types) versions ([96ebfc7](https://github.com/focusreactive/payload-plugins/commit/96ebfc770c4668a3c52f85206b72754d42d38817))


### Features

* **payload-plugin-ab:** improve variant management UX ([b96fe1a](https://github.com/focusreactive/payload-plugins/commit/b96fe1a77cc9a7e48482d8296bf50ac5b7ec67c8))
* **payload-plugin-ab:** pin dependency versions ([95ea257](https://github.com/focusreactive/payload-plugins/commit/95ea2576e05c836c9c032483dce79242a46ca3d9))
* **payload-plugin-ab:** redesign variant row UI and improve input behavior ([f6ceb3e](https://github.com/focusreactive/payload-plugins/commit/f6ceb3ef6fc397f0d7c87cb224cdd19bc20f770f))

## @focus-reactive/payload-plugin-ab [2.3.2](https://github.com/focusreactive/payload-plugins/compare/@focus-reactive/payload-plugin-ab@2.3.1...@focus-reactive/payload-plugin-ab@2.3.2) (2026-03-12)

## [1.1.2](https://github.com/focusreactive/payload-plugin-ab/compare/v1.1.1...v1.1.2) (2026-03-02)


### Bug Fixes

* remove emoji from readme ([2e929a1](https://github.com/focusreactive/payload-plugin-ab/commit/2e929a1a5733f065589a8bbae79e3cdc868d0c05))

## [1.1.1](https://github.com/focusreactive/payload-plugin-ab/compare/v1.1.0...v1.1.1) (2026-03-02)


### Bug Fixes

* add emoji to readme ([2afb3aa](https://github.com/focusreactive/payload-plugin-ab/commit/2afb3aa226159c351f59a4157a495f16a54e1fbd))

# [1.1.0](https://github.com/focusreactive/payload-plugin-ab/compare/v1.0.2...v1.1.0) (2026-03-02)


### Bug Fixes

* add "use client" directive to analytics client barrel file ([289bff7](https://github.com/focusreactive/payload-plugin-ab/commit/289bff77bfddffb1526183829502f2b5db9db5f3))
* scope bucket cookie to manifestKey for tenant isolation ([f545b60](https://github.com/focusreactive/payload-plugin-ab/commit/f545b60acf922b1d89255bbd698ba6f7db82d8a0))
* use parent field path to extract parent document ([0f102f0](https://github.com/focusreactive/payload-plugin-ab/commit/0f102f0daee6f1e1f6ebbe56b92c24d39000350e))
* wait for Gtag initialization to track impression event ([96385cc](https://github.com/focusreactive/payload-plugin-ab/commit/96385cc53e7bfc2b4b88c7d64b36378fb1a5f05b))


### Features

* add getPassPercentage support ([b07de35](https://github.com/focusreactive/payload-plugin-ab/commit/b07de3500d9ceeb03a21fe7092d7063f2293c91a))
* add resolveAbCookieNames utility to derive cookie config for Client Components ([a0d6bcc](https://github.com/focusreactive/payload-plugin-ab/commit/a0d6bcc5069298762dfd8c50e5c218f9b16032e3))
* bundle client analytics entities ([4e8eee9](https://github.com/focusreactive/payload-plugin-ab/commit/4e8eee95dda5f5dacfbdc3fe7e3b41fca4ceb575))
* bundle core analytics types ([cd31ff1](https://github.com/focusreactive/payload-plugin-ab/commit/cd31ff1303843b415692e58e9140ff16553827ea))
* create ABAnalyticsProvider component ([afca22a](https://github.com/focusreactive/payload-plugin-ab/commit/afca22a674c39dea8c7d179aefc02337b43037aa))
* create client event trackers ([155a8ad](https://github.com/focusreactive/payload-plugin-ab/commit/155a8adedc91f370a45b5919b53b6b5a1fdd3b2c))
* create ExperimentTracker component ([c70bcf7](https://github.com/focusreactive/payload-plugin-ab/commit/c70bcf7f8edad690ff8210b55203ff91a9f7f80e))
* create getCookie utility ([e53434f](https://github.com/focusreactive/payload-plugin-ab/commit/e53434f5168752435fe5865af6c76f112bb23327))
* create getExperimentStats service ([edb069d](https://github.com/focusreactive/payload-plugin-ab/commit/edb069dbb9a8c51b2b237c39894b60984dc296db))
* create googleAnalyticsAdapter ([2f365d4](https://github.com/focusreactive/payload-plugin-ab/commit/2f365d409ceca0e23815b60519856f2b2ad5f766))
* create isFieldPathExists utility ([7e06345](https://github.com/focusreactive/payload-plugin-ab/commit/7e06345d11088d0c64af73b8b7536e37e822e9cf))
* create pick variant bucket utils ([13a2c31](https://github.com/focusreactive/payload-plugin-ab/commit/13a2c312f64fdac2371442453f0bd13fae2186aa))
* create resolve a/b write factory ([6da3879](https://github.com/focusreactive/payload-plugin-ab/commit/6da3879d9b44f6075e52c239f0f474112d8ebf0f))
* create trackImpressionServer service ([f1d97d8](https://github.com/focusreactive/payload-plugin-ab/commit/f1d97d846151d94808ab9ff88531208a25db73e8))
* create useABConversion hook ([e4287c8](https://github.com/focusreactive/payload-plugin-ab/commit/e4287c8a988dec211705accc31987b2393be0318))
* design core analytics types ([c6b2cae](https://github.com/focusreactive/payload-plugin-ab/commit/c6b2cae32c282f1698ea06b0562798017e4fc569))
* design core types ([7621ec2](https://github.com/focusreactive/payload-plugin-ab/commit/7621ec254d41da95ecf8001dccc53c6aec8f7935))
* extract getNestedValue to separate utility ([ceb305c](https://github.com/focusreactive/payload-plugin-ab/commit/ceb305c7c766b4ba5045012b7cd90334ba52ff8e))
* introduce shared AbCookieConfig to link cookie names across utilities ([f60fdae](https://github.com/focusreactive/payload-plugin-ab/commit/f60fdae05df03811dc78fb055aa091d5ed01e0e6))
* provide passPercentage, parent and tenant fields and embed variant percentage sum validation ([b30dbbe](https://github.com/focusreactive/payload-plugin-ab/commit/b30dbbed74e582cdc52348f73ae8f40ed62f109b))
* support react and resolve analytics paths ([5fca12f](https://github.com/focusreactive/payload-plugin-ab/commit/5fca12f5b3a4f45912ff05b62b6dc721e8e4653b))
* typify google analytics adapter config ([0bd489f](https://github.com/focusreactive/payload-plugin-ab/commit/0bd489f3cf3abb6f71156f0d84dd5f9d09796cb8))
* validate variant percentage sum according to parent document tenant field ([c8810b3](https://github.com/focusreactive/payload-plugin-ab/commit/c8810b31b1404e13e65aada38f910cdb70a3727e))
