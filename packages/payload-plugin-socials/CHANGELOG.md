# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Reconciliation sits behind the platform adapter (#132). `PlatformAdapter.reconcile` (optional) asks the platform where a post it holds stands and returns a `ReconcileVerdict` (`published`, `failed` with a `reason`, or `pending` with an optional `checkAt`); the publication ledger's `reconcilePublication` records it. Facebook's scheduled-post check and Business Profile's moderation check moved into their adapters and no longer write `social-posts`: `reconcileFacebookScheduledPost` and `reconcileGbpLocalPost` (renamed from `reconcileGbpLocalPostState`) return the verdict. The publish task, the sweep query and `publicationReconciliation.ts` have no Facebook or Business Profile branches left, and no longer parse `meta.scheduledSeconds` or `meta.pageId`. `needsPublicationReconciliation` and `queuePublicationReconciliation` are replaced by the ledger and `queueReconciliationCheck`. `ReconcileVerdict` is an exported type. Task slugs, schemas and `retries` are unchanged.
- One generic due query (`dueForWorkWhere`): `queued` posts whose `scheduledAt` passed, and `scheduled`/`publishing` posts with an `externalId` whose `nextRetryAt` passed, on any platform whose adapter reconciles. A claim clears `nextRetryAt`, so an in-flight publish is never due.
- `delete` and `getInsights` are adapter capabilities with no platform special cases: `DELETE /posts/{postId}` answers `422` for any platform whose adapter has no `delete` (the Instagram adapter dropped its throwing `delete` and `INSTAGRAM_DELETE_UNSUPPORTED_MESSAGE`), and the 422 message names the configured `basePath` instead of `{basePath}`. Delete, insights and reconcile receive the same row-built `publishedRef` (the row's `meta` plus `destinationId`); the Facebook adapter falls back to `destinationId` for the Page, instead of the insights task adding `pageId` for Facebook only.
- A pending reconciliation is checked again at the verdict's time (Facebook: five minutes, Business Profile: one minute), and its follow-up job is held until that same time. Before, the follow-up job ran after one minute while the row said five, and each sweep plus follow-up queued another job. A publish job that runs before the row's `nextRetryAt` now does nothing (`output.reconcileSkipped: 'notDue'`). The sweep no longer queues a held post whose follow-up job has not run yet (the row notes it in `queuedJobId`; `SweepResult.skipped` counts them), and a verdict is recorded only while the row's `nextRetryAt` is the one the job read: before, a cron tick's sweep job and the follow-up job ran in the same drain, both recorded `pending` and both queued another check, adding a job and a platform read per tick.
- A scheduled result whose time already passed is first checked a minute from now (before: a minute after the past time, so at once).

- A publication ledger (`src/server/services/publicationLedger.ts`) owns the `social-posts` lifecycle (#131): the idempotency identity, reserving and claiming a post, recording the platform's answer or error (and whether Payload may retry it), and the retry, resolve, cancel and delete guards. The publish endpoint, the composer, `scheduleSocialPostPublish`, the publish and retry tasks and the post endpoints call it, instead of writing `status` in nine places. The README's "Post lifecycle" lists the transitions. Task slugs, schemas and `retries` are unchanged.
- **Breaking for custom adapters:** `PlatformAdapter.publish` returns a `PublishResult` (the `PublishedRef`, plus `state`: `published`, `scheduled`, `pending` or `rejected`, and `record`: the audit fields to store) and receives no `postId`. Adapters no longer read or write `social-posts`: the four built-in adapters lost their idempotency lookup, `attempts` count and row writes, and the idempotency key is computed once, by `buildPublicationIdentity`. `PublicationRecord` and `PublishResult` are exported types.
- `attempts` counts every claim of a post (each platform call), not only successful publishes.
- A Business Profile post rejected after creation, and a provider success whose audit record could not be saved, are no longer recorded as connection errors on the `socials-connections` global.

- The admin UI (`/admin/socials`, the dashboard widget, the Socials tab, the standalone composer and the template builder) is rebuilt on `@payloadcms/ui` components and Payload 4 tokens, following the SEO analyzer's UI rules; `socials.css` keeps only what the components don't cover. Behaviour is unchanged. Platform tabs no longer use per-platform brand colours.

- `disabled` no longer changes the admin component paths. It registers the nav link, the `/admin/socials` view, the dashboard widget and the Socials tab on `injectInto` collections like the enabled mode does, so Payload's generated import map is identical with and without the encryption key. The components read `admin.custom.socials.disabled` and show "Socials is turned off. Set its encryption key to enable it." (the nav link shows nothing) instead of calling endpoints; endpoints, jobs, hooks, scheduling and access are unchanged.

- `disabled` now registers the same job task definitions as the enabled mode (slugs, `inputSchema`, `outputSchema`, `interfaceName`, retries), so everything Payload derives from them (the `Socials*TaskInput` types in `payload-types.ts`, the `payload-jobs` task-slug options) is the same with and without the encryption key. The tasks have no `schedule` and a handler that needs no options or key and touches no platform: it throws ("socials is disabled"), so Payload records the job as failed after the task's retries (Payload 4 logs a returned `{ state: 'failed' }` as succeeded). Nothing queues them while disabled (no endpoints, hooks or scheduling). A failure rather than a silent no-op, so a job queued by hand or left over from an enabled deploy is not reported as published.
- In `disabled`, `social-posts` and `social-templates` set `admin.hidden` to `() => true` instead of `true`. Payload's dashboard `collection-query` widget lists collections whose `hidden` is not the literal `true`, so the boolean made the generated types depend on `disabled`. They stay hidden.

- The composers read each platform's behaviour from one client-safe descriptor (`src/components/platforms/`: `facebook`, `instagram`, `pinterest`, `gbp`) instead of branching on the platform in every file. A descriptor holds the formats, accepted media, destination response parsing, template-to-form mapping, the controls shown per format, and the source and standalone publish inputs. The copy of the destination parsing in the source composer and the standalone composer is gone, and `platformFormats`, `destinationPath`, `acceptedMediaTypes` and `supportsMultipleMedia` are removed in favour of the descriptors. Behaviour is unchanged: the UI and the request bodies are the same.

### Fixed

- A reconciliation verdict is written only while the row keeps the status and `externalId` it was checked with, so a check that finishes after an operator deleted the post no longer overwrites `deleted`.
- `queuePublicationReconciliation` swallowed a failed queue and left the post to the sweep, which (under `scheduling.autoRun`) never checked it. The ledger now sets the row's `nextRetryAt` before queueing the check, so a failed queue leaves the post due for the next sweep in every mode.
- A custom adapter without `delete` no longer lets `DELETE /posts/{postId}` mark a live post deleted without removing it from the platform; it answers `422` unless `?localOnly=true`.
- With `scheduling.autoRun.cron` set, Facebook natively scheduled posts and Business Profile posts in moderation were never checked again (#132): the `socialPostSweep` task, which is what the autoRun schedule runs, queued only due `queued` posts, while `sweepDueSocialPosts` (the cron, the HTTP endpoint, worker loops) also queued their follow-up checks. The task now runs `sweepDueSocialPosts`, so every mode uses one due query. `SweepResult` (and the sweep endpoint's `sweep`) gains `failed`: the due posts whose job could not be queued.
- Rescheduling a post (a scheduled publish of content that already has a row) overwrote any row that was not `published` back to `queued`, including one in `publishing`, `unknown` or `scheduled`, so the publish task could post it a second time. It now answers `409` for those.
- The publish task's claim no longer takes a `failed` row that has an `externalId` (a rejected Business Profile post, a failed Facebook reconciliation); only a manual retry, which asks for `confirmNotPublished`, puts such a post back in the queue. Moving a row to `publishing` (the task's claim, the immediate publish's takeover) clears the `externalId`/`externalUrl` an earlier publication left, so a deleted-then-rescheduled post, or one re-queued with `confirmNotPublished`, is claimed again by Payload's retry after a safe-to-repeat failure, and is not refused by the manual retry for that old id.
- `POST /internal/posts/{postId}/retry` answers `409 already published` for a published post, as the retry task treats it, instead of refusing it as possibly live or queueing a retry that does nothing.
- When fencing a provider success as `unknown`, a failed read of the row's `meta` no longer drops the existing `meta`.
- Job task failures are recorded as failures in `payload-jobs` (#94). The handlers returned `{ errorMessage, state: 'failed' }`, which Payload 4 logs as succeeded (it reads only `output`), so failed publishes showed as succeeded jobs and task `retries` never applied. They now throw. Transient failures that cannot post twice (a publish the provider rejected as retryable, a failed token refresh, an insights refresh that refreshed nothing, a retry that could not re-queue its post) throw a plain `Error`, so Payload retries them per the task's `retries`. Failures the `social-posts` row already records (an unknown publish outcome, a non-retryable rejection, a missing or cancelled post, a failed Facebook/GBP reconciliation) throw `SocialsTaskFailure`, a `JobCancelledError`: the job is marked failed (`hasError`, `error.cancelled`) without Payload retries. A publish with an unknown outcome is now a failed job instead of a succeeded one with `output.outcomeUnknown`. Post status updates are unchanged. The sweep and insights refresh report partial failures in `output` (`failed`, `failedPlatforms`) and throw when nothing succeeded; the connection refresh throws when any platform failed. See "Job failures and retries" in the README.
- Payload's automatic publish retry could post twice. Facebook's create requests (`/feed`, `/photos`, `/videos`) labelled a 5xx as `outcome: 'failed'` and `retryable: true`, so a post Meta had created before answering 5xx was published again. Every platform client now classifies failures through one function, `classifyRequestFailure`: on a request that creates the post, only a 4xx (or a 429 / documented throttle) proves the platform did not apply it; a 5xx, 408, 425, timeout, network error, or a 2xx without JSON or a post id is `outcome: 'unknown'` (the post goes `unknown`). Requests that publish nothing by themselves (Instagram containers, unpublished Facebook photos, Pinterest video uploads) and reads stay `failed`. Payload retries a publish only when `isAutoRetrySafe` holds: `outcome: 'failed'`, `retryable`, and the new `PlatformApiError.safeToRepeat`, which defaults to `false` and only the classifier (or an explicit pre-creation site) sets. Facebook publish requests now go through the shared Meta response reader (`readMetaJson`), so their error messages read `Meta /{page}/feed failed: …`.
- Task retries back off: `socialPostPublish`, `socialPostRetry`, `socialInsightsRefresh` and `socialConnectionRefresh` use `retries: { attempts, backoff: { type: 'exponential', delay: 60_000 } }` (`SOCIALS_RETRY_BACKOFF`: 1, 2, then 4 minutes), so a throttled publish is not retried on the next drain. The attempt counts are unchanged.
- The manual retry (`POST /internal/posts/{postId}/retry`, the `socialPostRetry` task) no longer re-publishes a post that may already be live (`unknown`, `publishing`, or with an `externalId`): the endpoint answers `409` and the task fails without a retry, with a message that says to check the platform and resolve the post. `{ "confirmNotPublished": true }` in the request body (or the task input, or `queueSocialPostRetry({ confirmNotPublished: true })`) overrides it. A missing post now answers `404`.
- The Socials tab on a source document shows "No platform is enabled" when no platform is enabled, instead of loading a Pinterest composer whose requests fail with "platform is not enabled".
- Composer channel chips: the checkbox sits inline with its label instead of stacking above it.

## [0.12.0-beta.0] - 2026-11-04

Cargo's fork (`@cargo/payload-plugin-socials`) of upstream 0.11.1 (`b2ee260`), ported to Payload 4. No option changes. The schema is the same tables as 0.11.1; on Payload 4 that requires the opt-outs below, or Payload adds version tables.

### Changed

- **Payload 4** (`>=4.0.0-beta.6 <5`) replaces Payload 3; `@payloadcms/next` is no longer a peer. The `/admin/socials` view uses `DefaultTemplate` from `@payloadcms/ui/rsc` and `server.redirect()` instead of `next/navigation`.
- `social-posts`, `social-templates` and the `socials-connections` global set `versions: false`: Payload 4 versions collections and globals by default.
- `payload.jobs.queue`, `run` and `cancelByID` pass `overrideAccess: true`. Payload 4 defaults them to the jobs access functions (a logged-in user), so cron sweeps and internal-scheduler drains threw `Forbidden`.
- Package name `@cargo/payload-plugin-socials`; admin import-map paths follow it (`@cargo/payload-plugin-socials/client`, `/rsc`). Log and error prefixes stay `payload-plugin-socials`.
- Built with tsup into `dist/index.js`, `dist/client.js` (+ `client.css`) and `dist/rsc.js`. The stylesheet is plain CSS (it used SCSS only for nesting, which CSS has).
- Admin buttons use `size="medium"`: `@payloadcms/ui` 4 has no `small`.
- Admin styles use Payload 4 tokens (`--color-*`, `--field-color-*`, `--radius-*`, `--text-mono-family`, heading tokens) instead of the removed v3 ones (`--theme-elevation-*`, `--theme-text`, `--theme-input-bg`, `--style-radius-*`, `--font-mono`), so the composer, widget and template builder follow the admin theme in light and dark. `payload4Tokens.test.ts` guards it. Composer, widget and view headings carry a `socials-heading` class, since Payload 4 doesn't style bare headings.

### Added

- **Cloudflare Workers support** for remote media fetches (image preflight, Pinterest video downloads). On Workers, hostnames resolve through `dns.resolve4` + `dns.resolve6` (CNAME targets in the answers are ignored; a lookup error other than "no record" fails closed), and requests go through `fetch` with `redirect: 'manual'`, since workerd's `node:https` rejects the `lookup` option that pins the connection on Node. Every hop is still checked against non-public ranges. Exported from the module as `createWorkersLookupHostname` and `fetchUnpinnedHttpsRequest` for tests.
- `sharp` is loaded through a variable specifier (`importSharp`), so bundlers don't try to resolve the optional dependency at build time. `optionalImports.test.ts` guards it.
- Boot tests (real Payload, in-memory SQLite): the versioning opt-outs, and a sweep job queued and drained with no user.

### Removed

- The Next.js dev app, Playwright e2e and live canary suites, and the Postgres/MongoDB boot variants. Upstream's release tooling (ESLint config, publint, pack smoke test, CONTRIBUTING).

## [0.11.1] - 2026-10-23

### Fixed

- Business Profile service-account tokens: encode JWT segments with Node's built-in `base64url` instead of a padding-stripping regular expression that static analysis flagged as potentially slow on crafted input. The produced tokens are unchanged.

## [0.11.0] - 2026-10-23

### Added

- Google Business Profile listing management through the Business Information API:
  - `GET {basePath}/gbp/locations/:locationId` (publisher) and `getLocation()` read one listing in full: address, regular and special hours, open state, description, phone, website, categories, service area, labels and metadata (`hasVoiceOfMerchant`, `hasPendingEdits`, `canDelete`, `duplicateLocation`, `mapsUri`, `placeId`).
  - `PATCH {basePath}/gbp/locations/:locationId` (admin, with `listingManagement`) and `updateLocation()` change the storefront address, regular hours, special hours, `profile.description`, `phoneNumbers.primaryPhone` and `websiteUri`. The `updateMask` is derived from the patch keys only, the patch is validated at the boundary (`buildLocationPatch`), and `validateOnly` passes through so Google can check the exact change before approval.
  - `POST {basePath}/gbp/locations/:locationId/open-status` (admin, with `listingManagement`) and `setOpenStatus()` mark a listing `OPEN`, `CLOSED_TEMPORARILY` or `CLOSED_PERMANENTLY`, with optional `expectedTitle` and `validateOnly`.
  - `DELETE {basePath}/gbp/locations/:locationId` (admin, with `listingManagement`) and `deleteLocation()` remove a stale listing only when Google's `metadata.canDelete` is true, and a verified listing only when Google names it a duplicate in `metadata.duplicateLocation`; anything else is a 409 and nothing is sent.
  - `GET {basePath}/gbp/locations?include=all` and `listAllLocations()` list every location on every account, postable or not. Discovered locations now carry `canDelete` and `duplicateLocation`.
  - `platforms.gbp.listingManagement` (default `false`) mounts the three listing write routes. They change the live listing on Google inline in the request, so they are a new admin surface: enable them only when every user your `authorize` grants `admin` may edit, close or delete the Business Profile, or wrap them in your own approval. The exported helpers work without the option.
  - A rejected listing request is a `PlatformApiError` carrying Google's own message and `fieldViolations` (from `google.rpc.BadRequest` and `google.rpc.ErrorInfo` details), without the request URL. Error responses below 500 include `fieldViolations` when present.
  - A closed special-hours period refuses an `endDate` (400) rather than dropping it, because Google ignores it and a two-day closure would silently become one day.
- `POST {basePath}/posts/:postId/cancel` (publisher) and `cancelQueuedSocialPost()` cancel a queued post through a guarded update and never call a provider, so they cannot remove a live post. Any other status is a 409. The guard is select-then-write, like the publish task's claim, so it is not atomic against a post that is already due; pass `minLeadSeconds` (refuse a post due within that many seconds) to keep a cancellation clear of the publish task.
- `POST {basePath}/compose/validate` (publisher) and `validateComposeTargets()` validate a standalone multi-channel post with the same body as `compose/publish`, without reserving or publishing anything.
- `PlatformApiError` and the Business Profile location types are exported from the package entry.

### Changed

- **Schema: `social-posts.destinationId`.** The account a post went to (board id, Instagram user id, Page id or location resource name) is now a top-level, indexed `destinationId` text field. The `destination` group keeps `label` and `meta`. `scheduleSocialPostPublish` takes `destinationId` beside `destination: { label, meta }`.
- The queued branch of `DELETE {basePath}/posts/:postId` now uses the same guarded cancellation as the cancel route, so it answers 409 instead of overwriting a row the publish task claimed a moment earlier.
- `listPostablesLocations` is now built on `listAllLocations`; its result is unchanged.
- Nothing new changes Google for an existing install: the listing write routes stay unmounted until `platforms.gbp.listingManagement` is set. The new read routes (`GET /gbp/locations/:locationId`, `?include=all`) use the existing `publisher` scope.

### Fixed

- `social-posts` never stored its destination on SQL adapters: the group subfield was named `id`, which Payload's Postgres and SQLite adapters skip below the top level, so every post lost the account it was published to and history could not tell two accounts apart. Insights refresh now reads the stored `destinationId` (and the Facebook Page id from it).

### Migration

Run `payload migrate:create` after upgrading and review the SQL: it adds a nullable `destination_id` column to `social_posts` with an index, and drops nothing. Rows written by earlier versions have no destination on SQL adapters. If you want them backfilled, a reviewed data step can recover most of them from what was stored, for example on Postgres:

```sql
UPDATE social_posts
SET destination_id = 'accounts/' || (destination_meta->>'accountId') || '/locations/' || (destination_meta->>'locationId')
WHERE platform = 'gbp' AND destination_id IS NULL
  AND destination_meta->>'accountId' IS NOT NULL AND destination_meta->>'locationId' IS NOT NULL;

UPDATE social_posts
SET destination_id = COALESCE(meta->'queuedInput'->>'pageId', meta->'queuedInput'->>'igUserId',
                              meta->'queuedInput'->>'boardId', meta->'queuedInput'->>'locationResourceName')
WHERE destination_id IS NULL AND meta ? 'queuedInput';
```

On MongoDB the old value was stored, so move it: `updateMany({ 'destination.id': { $exists: true } }, [{ $set: { destinationId: '$destination.id' } }, { $unset: 'destination.id' }])`. Host code that read `post.destination.id` should read `post.destinationId`. No other plugin option or default changed.

## [0.10.0] - 2026-10-22

### Added

- Deferred publishing: the composers send `X-Socials-Publish-Async: 1` and, when a host answers `202` with `X-Socials-Publish-Status: pending` and a same-origin `Location` under `{basePath}/requests/{id}`, poll that status URL (honoring a clamped `Retry-After`) until the original provider response arrives. The publish request is submitted once; polling stops after ten minutes with a message that points at post history. The header names and path segment are exported constants.
- `assets.normalize` re-encodes every image, including accepted formats, into a bounded JPEG rendition: EXIF orientation applied, transparency flattened to white, sRGB, metadata stripped, fitted without cropping onto a per-platform canvas (Facebook within 2048 pixels at its own proportions, Instagram stories 1080 by 1920, everything else a 1080 pixel square). Sources decode within a 64 megapixel budget and results must fit the platform byte limit. Renditions are cached per source URL, platform, presentation and quality.
- `assets.maxSourceImageBytes` (default 25 MiB) sets the download budget for conversions, `assets.maxConcurrentConversions` (default 1) bounds concurrent conversions per process so carousel and multi-photo publishes cannot exhaust worker memory, and `assets.renditionData` supplies required field values for rendition documents.
- `admin.mediaLibrary` scopes the composers' media library drawer to specific upload collections and serializable `Where` filters.
- The source composer's media pool has a search box, a visible count of matching and selected items, lazy-loaded tiles, captions from alt text that stay clear of the reorder controls, and select buttons named after the asset's alt text.

### Changed

- Instagram stories resolve their image with a `story` presentation so normalized renditions use the vertical canvas.
- Rendition conversions run through a process-wide limiter; a failed conversion releases its slot so later images still publish.
- The source composer remounts per record, so selections, search and fetched previews no longer carry over when the admin navigates between documents in place.

### Fixed

- Business Profile: a verified location (voice of merchant) is postable even when Google omits `canOperateLocalPost`, which Business Information v1 does for listings that take posts. Such locations were hidden from the location picker.

### Notes

- No plugin-owned schema changes; no host migration required. Defaults are unchanged: without `assets.normalize`, accepted formats pass through and unsupported formats transcode exactly as before, with the same rendition file names.

## [0.9.3] - 2026-07-23

### Added

- Opt-in, per-platform live lifecycle canaries exercise the real Pinterest, Facebook, and Instagram adapters. Pinterest and Facebook verify cleanup; Instagram requires a second residue opt-in and uses a self-expiring Story. The release runbook records preflight, canary evidence, tagging, npm bootstrap, and trusted-publishing ownership.

### Changed

- **Scheduling now follows the operator-owned model.** The plugin no longer writes to your `jobs.autoRun` array. When `scheduling.autoRun` crons are set, the plugin attaches Payload task-level `schedule` entries to its sweep/insights/connection tasks; you run a Payload Jobs worker that handles schedules and drains the queue (or use the internal endpoints / worker helpers). The previous behavior registered `autoRun` entries that only drained the queue and never enqueued the periodic tasks, so insights-refresh, connection-refresh, and the sweep silently never ran under that mode.
- `scheduling.autoRun.cron` is now optional; set only the refresh crons if you drive the sweep another way. Providing any one cron registers the block (previously the whole block was dropped unless the sweep cron was present).
- The task queue is now configured as `scheduling.queue`, independently of native task crons. The former `scheduling.autoRun.queue` nesting has been removed.
- A Payload config may contain only one plugin instance; applying a second now fails during config construction instead of creating first-wins/last-wins task registry behavior.
- The standalone multi-channel composer is split from the source-record composer, and its publish success/error orchestration is covered in the three-browser Playwright suite.
- Payload admin peers now require React and React DOM 19, matching the supported Payload 3 runtime.
- Public copy guidance now documents the optional commerce-style metadata convention used by Pinterest defaults and the provider-conditional availability of GBP Alert posts.
- npm provenance now comes from the steady-state trusted-publishing workflow rather than a package-level flag that prevents the one-time token bootstrap. The owner runbook reserves the package with a tagged, non-`latest` bootstrap prerelease before the real release workflow runs.

### Fixed

- Facebook stores the canonical post permalink returned by the Graph API, falling back to the redirect-safe bare `/{post_id}` URL when the lookup fails (never the `/{page_id}/posts/{post_id}` form, which 404s on new-experience Pages). Scheduled posts receive the canonical URL during reconciliation.
- Google Business Profile derives its idempotency key from the original image URL, so `assets.autoConvert` can no longer split a single publication into two `social-posts` rows.
- When `disabled`, the plugin retains hidden, deny-all, hook-free collection/global schemas so a host `migrate:create` run cannot generate a destructive drop; runtime endpoints, tasks, and admin surfaces remain absent. Schema-driving `sources` are still required.
- Host-collection Socials tab injection is idempotent and rejects a host field named `socials` with a clear collision error.
- Pinterest rejects an unknown `environment` value rather than silently routing a typo to production.
- Provider delete failures raise a sanitized platform error carrying the true upstream status instead of a 400 with the raw upstream body.
- Log redaction also masks bare provider token shapes (`pina_`, `pinr_`, `ya29.`, `EAA…`) that appear outside secret-named keys.
- Facebook insights use Meta's post media-view replacements instead of the impressions/reach/3-second-view metrics retired in June 2026. Facebook and Instagram now retry invalid-metric Graph code-100 failures per metric, preserve valid partial results, and record rejected names in `unavailableMetrics`; missing-object and permission-loss responses are rethrown instead of becoming empty snapshots.
- Shared image-format validation and retry-delay helpers replace adapter-local duplicates; the unused standalone Instagram delete export is removed.
- The clean script now removes `dist` and both TypeScript build-info files portably instead of relying on shell brace expansion, preventing stale build artifacts from entering a release.
- Injected source composers no longer assume a `product` source kind. A missing or blank `sourceKind` now renders a configuration error before access or source requests can run.

### Security

- The optional `sharp` peer now requires `^0.35.0`, and the development image pipeline runs against `0.35.3`, excluding libvips builds affected by the 2026 inherited Sharp advisories.
- Updated Next.js and pinned patched compatible transitive versions of PostCSS, fast-uri, brace-expansion, Mongoose, and Sharp. CI now audits the complete dependency graph at high severity instead of checking only published runtime dependencies; the sole incompatible dev-tooling-only brace-expansion advisory is explicitly documented in `audit-allowlist.json`.

### Notes

- No plugin-owned schema changes; no host migration required.
- JavaScript source maps are no longer included in the package tarball.

## [0.9.2] - 2026-07-22

### Fixed

- Preserve Payload/Pino as the receiver of logger methods and contain host logger failures so successful credential persistence, publication, scheduler, retry, and error-response operations cannot be converted into application failures by logging.
- Separate Pinterest authorization-scope serialization from token-response parsing, parse response scopes consistently during authorization-code exchange and refresh, and preserve stored scope metadata when Pinterest omits the response field.

### Notes

- Added a production board-discovery regression test (token refresh → encrypted persistence → real Pino logging → token caching → repeated board requests).
- This patch has no plugin-owned schema changes and requires no host migration.

## [0.9.1] - 2026-07-20

### Added

- Public Payload CMS 3 plugin factory with root, client, and RSC export maps.
- Production admin composer for source records plus a standalone multi-channel composer.
- Pinterest, Instagram Business, Facebook Pages, and Google Business Profile adapters with real API publication, discovery, OAuth or service credentials, insights, and supported deletion flows.
- `social-posts` audit/idempotency collection, `social-templates` collection, and encrypted `socials-connections` global.
- Host-defined source resolvers, access control, copy transforms, templates, distributed coordination hooks, scheduling helpers, internal scheduler endpoints, and Payload Jobs task definitions.
- Optional image preflight and deterministic JPEG rendition pipeline.
- `authCollection` configuration with single-auth-collection auto-detection and explicit selection for multi-auth hosts.
- Explicit `publicationKey` identities for campaigns and `idempotencyKeyOverride` for adopting known legacy rows.
- Publisher-only resolution endpoint for ambiguous provider outcomes: `POST /posts/:postId/resolve`.
- CI matrices for Node 22/24, SQLite/PostgreSQL/MongoDB boot coverage, package validation, dependency audit, CodeQL, and Chromium/Firefox/WebKit admin E2E.

### Changed

- Requires Payload `^3.84.1` and Node.js `>=22.12.0`.
- Template scope contains only universal source fields plus `metadata.*`. The prerelease ecommerce aliases `category`, `color`, `material`, and `dimensions` were removed; use the corresponding host-defined `metadata` paths.
- Platform adapters are isolated per normalized plugin options, while job runner state and task options are isolated per Payload instance. Version `0.9.x` supports one plugin instance per Payload config.
- Native Facebook schedules and accepted GBP Local Posts remain pending until provider reconciliation confirms publication.
- Scheduled publication uses revision tokens, due-time checks, best-effort cancellation of superseded Payload jobs, and unique-key race recovery.
- `social-posts.publishedBy` targets the configured host auth collection and is omitted for hosts without auth collections.

### Fixed

- Unsafe provider `POST` requests are no longer replayed after network failures or ambiguous 5xx responses. Provider-success/audit-write failures capture the provider ID and are fenced as non-retryable unknown outcomes across all four adapters.
- Facebook delete reconciliation recognizes an already-absent upstream post only from typed HTTP/upstream 404 status, never provider message substrings.
- GBP default publication identity now includes the primary image; Pinterest legacy identities can be adopted without changing their hash.
- GBP `PROCESSING`, `LIVE`, and `REJECTED` states and Facebook native schedules now persist truthful lifecycle states and reconciliation timestamps.
- Facebook deletion resolves the Page from stored metadata for bare video IDs; adapter deletion no longer competes with endpoint-owned local transitions.
- Queue-drain failures propagate to callers; per-Payload drain deduplication no longer leaks across Payload instances.
- Pinterest requires a provider post ID and stores a Pinterest permalink rather than the outbound destination link.
- OAuth scope parsing accepts provider-delivered comma or whitespace separators and does not reject token responses that omit the optional scope echo.
- Admin authorization, import-map component registration, local-time scheduling bounds, media selection, template field discovery, and composer response guards were corrected and covered by tests.

### Security

- Remote image reads require HTTPS, reject credentials and nonstandard ports, revalidate every redirect, resolve and reject non-public IP ranges including IPv4-mapped and transition IPv6 addresses, pin each TLS connection to the validated address, enforce a timeout, and stream under a 25 MB cap.
- Pinterest video sources use the same redirect-aware pinned-IP transport plus their exact-host allowlist, and streamed bytes cannot exceed or differ from the declared bounded length.
- Stored access and refresh tokens use authenticated AES-256-GCM envelopes with key-ring rotation and no plaintext fallback.
- Secret-bearing values are recursively redacted before reaching host loggers.
- Meta webhook bodies are size-bounded and authenticated with `X-Hub-Signature-256` before callbacks run.
- Internal scheduler API keys are compared through fixed-length SHA-256 digests with `timingSafeEqual`.

### Migration

- This release changes plugin-owned schemas, including publication status values and the optional `publishedBy` relationship. Hosts must run `payload migrate:create`, inspect the generated migration, and apply it through their normal deployment process. The plugin never creates or runs migration files.

## [0.9.0] - 2026-07-12

### Added

- Private prerelease containing the initial four adapters, admin composer, encrypted connection storage, source resolver registry, templates, scheduling, insights, and audit collection.

[Unreleased]: https://github.com/ContiDigital/payload-plugin-socials/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/ContiDigital/payload-plugin-socials/compare/v0.9.3...v0.10.0
[0.9.3]: https://github.com/ContiDigital/payload-plugin-socials/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/ContiDigital/payload-plugin-socials/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/ContiDigital/payload-plugin-socials/compare/d41a1c7d0fb88346e6dfb0c10ea3480d768042e4...v0.9.1
[0.9.0]: https://github.com/ContiDigital/payload-plugin-socials/commit/d41a1c7d0fb88346e6dfb0c10ea3480d768042e4
