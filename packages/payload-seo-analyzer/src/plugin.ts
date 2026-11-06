/**
 * Payload CMS SEO Analyzer Plugin.
 *
 * Adds SEO analysis capabilities to any Payload CMS project:
 * - SEO fields (focusKeyword, focusKeywords, isCornerstone) on target collections
 * - SeoAnalyzer UI component in the editor sidebar (real-time SEO scoring)
 * - SEO dashboard admin view at /admin/seo
 * - API endpoints for validation, keyword dedup, and audit
 *
 * Usage:
 *   import { seoAnalyzerPlugin } from '@cargo/payload-seo-analyzer'
 *
 *   export default buildConfig({
 *     plugins: [
 *       seoAnalyzerPlugin({ collections: ['pages', 'posts'] }),
 *     ],
 *   })
 *
 * Note: The legacy name `seoPlugin` is still available as an alias for
 * backward compatibility, but `seoAnalyzerPlugin` is preferred to avoid
 * naming conflicts with `@payloadcms/plugin-seo`.
 */

import type { Config, Field, Plugin } from 'payload'
import type { SeoConfig, SeoFeatures, RuleGroup, SeoThresholds } from './types.js'
import { seoFields } from './fields.js'
import { metaFields } from './metaFields.js'
import { createValidateHandler } from './endpoints/validate.js'
import { createCheckKeywordHandler } from './endpoints/checkKeyword.js'
import { createAuditHandler } from './endpoints/audit.js'
import { createIndexationAuditHandler } from './endpoints/indexationAudit.js'
import { createHistoryHandler } from './endpoints/history.js'
import { createSitemapAuditHandler } from './endpoints/sitemap-audit.js'
import { createSettingsHandler } from './endpoints/settings.js'
import { createSuggestLinksHandler } from './endpoints/suggestLinks.js'
import { createRedirectHandler } from './endpoints/createRedirect.js'
import { createRedirectsHandler } from './endpoints/redirects.js'
import { createAiGenerateHandler } from './endpoints/aiGenerate.js'
import { createAiOptimizeHandler } from './endpoints/aiOptimize.js'
import { createAiAltTextHandler, createAltTextAuditHandler } from './endpoints/aiAltText.js'
import { createAiContentBriefHandler } from './endpoints/aiContentBrief.js'
import { createAiOptimizeBulkHandler } from './endpoints/aiOptimizeBulk.js'
import { createCannibalizationHandler } from './endpoints/cannibalization.js'
import { createExternalLinksHandler } from './endpoints/externalLinks.js'
import { createSitemapConfigHandler } from './endpoints/sitemapConfig.js'
import { createPerformanceHandler } from './endpoints/performance.js'
import { createCoreWebVitalsHandler } from './endpoints/coreWebVitals.js'
import {
  createGscStatusHandler,
  createGscAuthStartHandler,
  createGscCallbackHandler,
  createGscDataHandler,
  createGscDisconnectHandler,
} from './endpoints/gscOAuth.js'
import { createKeywordResearchHandler } from './endpoints/keywordResearch.js'
import { createBreadcrumbHandler } from './endpoints/breadcrumb.js'
import { createLinkGraphHandler } from './endpoints/linkGraph.js'
import { createSchemaGeneratorHandler } from './endpoints/schemaGenerator.js'
import { createRedirectChainsHandler } from './endpoints/redirectChains.js'
import { createDuplicateContentHandler } from './endpoints/duplicateContent.js'
import { createAiRewriteHandler } from './endpoints/aiRewrite.js'
import { createRobotsHandler, createRobotsUpdateHandler } from './endpoints/robots.js'
import type { CollectionRoutes } from './helpers/docUrl.js'
import { createSitemapHandler } from './endpoints/sitemap.js'
import { createLlmsTxtHandler } from './endpoints/llmsTxt.js'
import {
  createNewsSitemapHandler,
  createImageSitemapHandler,
  createVideoSitemapHandler,
} from './endpoints/sitemapExtensions.js'
import { createSeoScoreHistoryCollection } from './collections/SeoScoreHistory.js'
import { createSeoPerformanceCollection } from './collections/SeoPerformance.js'
import { createSeoSettingsCollection } from './collections/SeoSettings.js'
import { createSeoRedirectsCollection } from './collections/SeoRedirects.js'
import { createTrackSeoScoreHook } from './hooks/trackSeoScore.js'
import { createSeoLogsCollection } from './collections/SeoLogs.js'
import { createSeoGscAuthCollection } from './collections/SeoGscAuth.js'
import { createSeoRankHistoryCollection } from './collections/SeoRankHistory.js'
import { createRankSnapshotHandler, createRankHistoryHandler } from './endpoints/rankTracking.js'
import { createCtrOpportunitiesHandler } from './endpoints/ctrOpportunities.js'
import { createContentGradeHandler } from './endpoints/contentGrade.js'
import { createSeoHealthHandler } from './endpoints/health.js'
import {
  createIndexNowKeyHandler,
  createIndexNowSubmitHandler,
  createIndexNowHook,
} from './endpoints/indexNow.js'
import { createSeoLogsHandler } from './endpoints/seoLogs.js'
import { createAutoRedirectHook } from './hooks/autoRedirect.js'
import { createTrackSeoScoreGlobalHook } from './hooks/trackSeoScore.js'
import { startCacheWarmUp } from './warmCache.js'
import { startRankTracker } from './rankTracker.js'
import { startAlertsScheduler } from './alertsScheduler.js'
import type { AlertWebhookFormat } from './alertWebhook.js'
import type { NotFoundProbeFilterOption } from './helpers/probePaths.js'
import { startRetentionPurge } from './retentionScheduler.js'
import { resolveSeoJobsOptions, seoJobTasks, type SeoJobsOptions } from './jobs.js'
import { resolveRetention, type RetentionConfig, type RetentionMaxRows } from './retention.js'
import type { RetentionRunOptions } from './retentionScheduler.js'
import { seoDataStoreResolver, type SeoDataStore, type SeoDataset, type SeoStoreRuntime } from './store/index.js'
import { createRetentionPurgeHandler, createRetentionStatusHandler } from './endpoints/retention.js'
import { createAlertsDigestHandler, createAlertsRunHandler } from './endpoints/alerts.js'
import { resolveGscSiteUrl } from './helpers/gscClient.js'
import { createGenerateHandler } from './endpoints/generate.js'
import { seoTranslations } from './translations.js'
import { createBucketRateLimiter, rateLimitKey, type BucketRateLimiter, type SeoRateLimit } from './rateLimiter.js'
import {
  CONTENT_CACHE_BASES,
  REDIRECT_CACHE_BASES,
  SeoSharedCache,
  type SeoCacheStore,
  type SeoWaitUntil,
} from './cache.js'
import { createInvalidateCachesHook } from './hooks/invalidateSeoCaches.js'

/** Arguments passed to generate functions (generateTitle, generateDescription, etc.) */
export interface GenerateFnArgs {
  doc: Record<string, unknown>
  locale?: string
  req: unknown
  collectionSlug?: string
  globalSlug?: string
}

export interface SeoPluginConfig {
  /** Collections to add SEO fields to (default: ['pages', 'posts']) */
  collections?: string[]
  /** Globals to add SEO fields to (default: []) */
  globals?: string[]
  /** Whether to add the SEO dashboard view at /admin/seo (default: true) */
  addDashboardView?: boolean
  /** Rule groups to disable entirely */
  disabledRules?: RuleGroup[]
  /** Override the weight of all checks within a rule group */
  overrideWeights?: Partial<Record<RuleGroup, number>>
  /** Custom thresholds (override defaults from constants) */
  thresholds?: SeoThresholds
  /** Additional local SEO slugs for the project */
  localSeoSlugs?: string[]
  /** Site name (used for brand duplicate check in titles) */
  siteName?: string
  /** Base URL of the site (used for canonical URL validation, e.g. 'https://example.com') */
  siteUrl?: string
  /** Base path for API endpoints (default: '/seo-plugin') */
  endpointBasePath?: string
  /** Whether to track SEO score history (adds a collection + afterChange hook, default: true) */
  trackScoreHistory?: boolean
  /** Whether to add the sitemap audit view at /admin/sitemap-audit (default: true) */
  addSitemapAuditView?: boolean
  /** Collection slug for redirects (default: 'seo-redirects'). The plugin auto-creates this collection. */
  redirectsCollection?: string
  /**
   * Allow redirect destinations pointing to another origin (absolute http(s) URLs).
   * Default: `false` — an off-site 301 served from your own paths is a site-hijack
   * primitive (phishing with your domain's authority, OAuth redirect_uri abuse), and
   * nothing in the plugin used to forbid it. Turn it on only if you genuinely need
   * cross-origin redirects.
   */
  allowExternalRedirects?: boolean
  /** Known dynamic routes that are not stored as document slugs (e.g. ['blog', 'case-studies', 'posts']). These won't be flagged as broken links or orphan pages. */
  knownRoutes?: string[]
  /**
   * Public route prefix per collection, used by every URL the plugin generates
   * (sitemap.xml, canonical, JSON-LD, llms.txt, IndexNow).
   * Default: `{ posts: 'posts' }` — the convention llms.txt already shipped.
   * Set `{ posts: '' }` if your posts are served flat at `/<slug>`, or add your
   * own entries (e.g. `{ projects: 'work' }`).
   */
  collectionRoutes?: CollectionRoutes
  /**
   * Secret header value for the seo-logs POST endpoint. If set, POST requests must carry the
   * `X-SEO-Secret` header with this value — which is what lets a host's 404 middleware log hits
   * from ANONYMOUS visitors. If not set, POST requires an SEO-admin session (the same gate as the
   * collection's own `create` ACL), so a panel editor cannot write rows the collection refuses them.
   */
  seoLogsSecret?: string
  /**
   * Scanner probes (`*.php`, `/wp-login`, `/.env`, `/.git`, `/cgi-bin`, `/phpmyadmin`, root-level
   * `.sql` / `.zip` backups…) are dropped before they reach the 404 log, so they don't fill its row
   * cap. It looks at the path only, never the user agent: search-engine crawlers' 404s are the
   * rows worth keeping. Applies to `recordSeoNotFound` and `POST /seo-logs`; the built-in list is
   * `PROBE_PATH_PATTERNS`.
   *
   * - omitted / `true`: the built-in list
   * - `false`: log everything
   * - `{ extra: ['/xmlrpc-legacy', /\.cfm$/] }`: the built-in list plus yours (a string is a
   *   case-insensitive path prefix, a RegExp is tested against the lower-cased, decoded path)
   */
  notFoundProbeFilter?: NotFoundProbeFilterOption
  /**
   * Body format of the alerts digest webhook (`SEO_ALERT_WEBHOOK_URL`): `json` (the plugin's own
   * `{ type, siteUrl, digest }`), `slack` (`{ text }`) or `discord` (`{ content }`). The
   * `SEO_ALERT_WEBHOOK_FORMAT` env var overrides it; with neither set, the format follows the URL's
   * host (`hooks.slack.com` → slack, `discord.com/api/webhooks/` → discord, else json).
   */
  alertWebhookFormat?: AlertWebhookFormat
  /** Collection slug for uploads/media (used for meta.image relationTo). Default: 'media' */
  uploadsCollection?: string
  /** Auto-create meta fields (title, description, image) on target collections. Default: true */
  autoCreateMetaFields?: boolean
  /**
   * Path to a build-time audit cache file (JSON, produced by `buildAuditToFile()`).
   * When set, the heavy site-wide dashboard audit is hydrated from this file on a cache
   * miss instead of being recomputed live — offloading the cost to CI on memory-constrained
   * hosts (e.g. Infomaniak). Stale-guarded: ignored once content changes (a live rebuild
   * takes over). Runtime kill-switch: set env `SEO_AUDIT_FILE_CACHE=0` to ignore the file.
   */
  auditCacheFile?: string
  /**
   * Persistent key/value store for the caches the admin UI depends on across requests
   * (dashboard audit, sitemap audit, redirect chains), plus their invalidation markers.
   * Needed on multi-isolate/serverless hosts (Cloudflare Workers: every isolate has its
   * own memory, so an in-memory cache built in one is invisible to the next poll). Any
   * KV-like backend fits (R2, KV, Redis…): `get` returns `null` for a missing key.
   * Omitted: in-memory, per-process caches (fine on a single long-lived Node process).
   * When set, `auditCacheFile` is ignored.
   */
  cacheStore?: SeoCacheStore
  /**
   * Keeps background work alive after the response (the dashboard audit build). Pass
   * Workers' `waitUntil` (`import { waitUntil } from 'cloudflare:workers'`); it resolves the
   * current request on each call. Omitted: the build is fire-and-forget, which only works
   * on long-lived processes. When set, the audit build also drops its cooperative pauses
   * (see `SEO_AUDIT_*` env vars) to fit the host's post-response budget.
   */
  waitUntil?: SeoWaitUntil
  /**
   * Shared rate limiter for the plugin's limited endpoints. Called with the bucket
   * (`SEO_RATE_LIMITS` lists each bucket's limit) and the caller key; return `true` to
   * allow, `false` to answer 429, `undefined` to use the in-memory limiter. Omitted: the
   * in-memory limiters, which on Workers count per isolate. On Workers, back each bucket
   * with a Rate Limiting binding of the same limit.
   */
  rateLimit?: SeoRateLimit
  /**
   * Run background work as Payload jobs instead of in-process timers: continuing a
   * dashboard audit that paused between steps, the GSC rank snapshot, the alerts digest and
   * the retention purge. The plugin registers those tasks with schedules on one queue
   * (`'seo'` by default); the host runs that queue from a cron (`runSeoJobs(payload)` in a
   * Workers `scheduled` handler, or Payload's `jobs.autoRun`). Needed on Workers, where
   * timers don't survive the request. Adds Payload's jobs collection, so run a migration.
   */
  jobs?: boolean | SeoJobsOptions
  /** Granular feature flags — all default to true. Disable features you don't need
   *  to reduce collections, endpoints, and admin views loaded by the plugin.
   *  The core analyzer sidebar, validate endpoint, and meta fields are always active. */
  features?: SeoFeatures
  /** Custom function to generate meta title */
  generateTitle?: (args: GenerateFnArgs) => string | Promise<string>
  /** Custom function to generate meta description */
  generateDescription?: (args: GenerateFnArgs) => string | Promise<string>
  /** Custom function to generate meta image (returns media ID or URL) */
  generateImage?: (args: GenerateFnArgs) => string | number | Promise<string | number>
  /** Custom function to generate page URL */
  generateURL?: (args: GenerateFnArgs) => string | Promise<string>
  /** Override or reorganize the default meta fields inside the 'meta' group.
   *  Receives the default fields (overview, title, description, image, preview) and must return a Field[].
   *  Use this to add custom fields, remove defaults, or reorder them. */
  fields?: (args: { defaultFields: Field[] }) => Field[]
  /** If true, wraps collection/global fields in a tabbed UI with "Content" and "SEO" tabs.
   *  Compatible with collections that already use a tabs field as their first field. */
  tabbedUI?: boolean
  /** Custom TypeScript interface name for the generated meta group type (e.g. 'SharedSEO') */
  interfaceName?: string
  /**
   * Where the time-series data lives: score history, Search Console performance imports,
   * rank snapshots and 404 logs. Every endpoint, hook and job that reads or writes them
   * goes through this store.
   *
   * - Set (e.g. `createSqlSeoDataStore(env.SEO_D1)`, a second D1 database on Workers): the
   *   data stays out of the main database, and the four `seo-*` collections are NOT
   *   registered. The SQL store creates and migrates its own tables.
   * - Omitted: the upstream Payload collections (`seo-score-history`, `seo-performance`,
   *   `seo-rank-history`, `seo-logs`) in the main database, as before. Fine on a Node host;
   *   on Workers + D1 it puts append-only data in the main database (a warning is logged).
   */
  dataStore?: SeoDataStore
  /**
   * Days of history to keep, per time-series dataset. Retention is MANDATORY for enabled
   * features: a dataset whose feature is on is pruned daily with `RETENTION_DEFAULTS`
   * (rank history 400 days, score history 365, performance 490, 404 logs 90) unless this
   * names another window. Naming a dataset whose feature is off also purges it.
   *
   * Pruning runs as the `seoRetentionPurge` job (with `jobs`) or a daily timer (Node), and
   * `GET/POST <basePath>/retention` lets SEO admins preview it or run it now.
   *
   * A value that is not a finite number of at least 1 is ignored rather than clamped
   * (`0` would mean "delete everything"); the default applies instead.
   *
   * @example
   * ```ts
   * retentionDays: { 'seo-rank-history': 365, 'seo-logs': 30 }
   * ```
   */
  retentionDays?: RetentionConfig
  /**
   * Row cap per dataset, applied by the same purge after the age window (newest rows
   * kept). Defaults in `RETENTION_DEFAULTS`. The 404 log's cap is also enforced on every
   * new URL; `SEO_LOGS_MAX_ROWS` overrides its default.
   */
  retentionMaxRows?: RetentionMaxRows
}

/** Build a resolved SeoConfig from plugin config for use by analyzeSeo() */
function buildSeoConfig(pluginConfig: SeoPluginConfig): SeoConfig {
  return {
    ...(pluginConfig.localSeoSlugs && { localSeoSlugs: pluginConfig.localSeoSlugs }),
    ...(pluginConfig.siteName && { siteName: pluginConfig.siteName }),
    ...(pluginConfig.siteUrl && { siteUrl: pluginConfig.siteUrl }),
    ...(pluginConfig.disabledRules && { disabledRules: pluginConfig.disabledRules }),
    ...(pluginConfig.overrideWeights && { overrideWeights: pluginConfig.overrideWeights }),
    ...(pluginConfig.thresholds && { thresholds: pluginConfig.thresholds }),
    ...(pluginConfig.collectionRoutes && { collectionRoutes: pluginConfig.collectionRoutes }),
  }
}

export const seoAnalyzerPlugin =
  (pluginConfig: SeoPluginConfig = {}): Plugin =>
  (incomingConfig: Config): Config => {
    const config = { ...incomingConfig }
    const targetCollections = pluginConfig.collections ?? ['pages', 'posts']
    const uploadsCollection = pluginConfig.uploadsCollection ?? 'media'
    const targetGlobals = pluginConfig.globals ?? []
    const basePath = pluginConfig.endpointBasePath ?? '/seo-plugin'
    const seoConfig = buildSeoConfig(pluginConfig)
    // Cache layer shared by the endpoints and invalidation hooks below. Without a store it
    // wraps the in-memory `seoCache` (per process), as before.
    const sharedCache = new SeoSharedCache({
      store: pluginConfig.cacheStore,
      waitUntil: pluginConfig.waitUntil,
    })
    const invalidateContentHook = createInvalidateCachesHook(CONTENT_CACHE_BASES, sharedCache)
    if (pluginConfig.auditCacheFile && pluginConfig.cacheStore) {
      console.warn(
        '[seo-analyzer] `auditCacheFile` is ignored because `cacheStore` is set: the store already persists the audit across isolates and restarts.',
      )
    }

    // Resolve feature flags — all default to true
    const features: Required<SeoFeatures> = {
      analyzer: true,
      dashboard: true,
      redirects: true,
      performance: true,
      linkGraph: true,
      keywords: true,
      cannibalization: true,
      schemaBuilder: true,
      sitemapAudit: true,
      seoLogs: true,
      scoreHistory: true,
      externalLinks: true,
      aiFeatures: true,
      duplicateContent: true,
      settings: true,
      gscApi: false, // opt-in — requires Google Cloud OAuth setup + secrets
      warmCache: true, // disable on low-memory hosts to skip startup pre-loading
      alerts: false, // opt-in — requires SEO_ALERT_WEBHOOK_URL and/or SEO_ALERT_EMAIL
      indexNow: false, // opt-in — requires SEO_INDEXNOW_KEY
      ...pluginConfig.features,
    }

    // Helper: detect if a collection already has @payloadcms/plugin-seo meta fields
    function hasExistingSeoMeta(fields: unknown[]): boolean {
      return fields.some((field) => {
        const f = field as Record<string, unknown>
        if (f.type === 'tabs' && Array.isArray(f.tabs)) {
          return (f.tabs as Array<Record<string, unknown>>).some((tab) => {
            if (tab.name !== 'meta') return false
            const tabFields = (tab.fields || []) as Array<Record<string, unknown>>
            const fieldNames = tabFields.map((tf) => tf.name).filter(Boolean)
            return fieldNames.includes('title') && fieldNames.includes('description')
          })
        }
        if (f.name === 'meta' && f.type === 'group') {
          const groupFields = (f.fields || []) as Array<Record<string, unknown>>
          const fieldNames = groupFields.map((gf) => gf.name).filter(Boolean)
          return fieldNames.includes('title') && fieldNames.includes('description')
        }
        return false
      })
    }

    // Build meta fields config
    const metaFieldsConfig = {
      uploadsCollection: pluginConfig.uploadsCollection ?? 'media',
      interfaceName: pluginConfig.interfaceName,
      hasGenerateTitle: !!pluginConfig.generateTitle,
      hasGenerateDescription: !!pluginConfig.generateDescription,
      hasGenerateImage: !!pluginConfig.generateImage,
    }

    // Build meta fields with optional user override
    function buildMetaFields(): Field[] {
      const defaults = metaFields(metaFieldsConfig)
      if (!pluginConfig.fields) return defaults
      // defaults is [{ name: 'meta', type: 'group', fields: [...] }]
      // Extract inner fields from the meta group, let user override, then re-wrap
      const metaGroup = defaults[0] as Record<string, unknown>
      const innerFields = (metaGroup.fields || []) as Field[]
      const overridden = pluginConfig.fields({ defaultFields: innerFields })
      return [{ ...metaGroup, fields: overridden } as Field]
    }

    const trackHistory = pluginConfig.trackScoreHistory !== false && features.scoreHistory

    // Time-series data (score history, performance, rank history, 404 logs): the host's
    // `dataStore`, else the upstream collections.
    const resolveStore = seoDataStoreResolver(pluginConfig.dataStore)
    const enabledDatasets: SeoDataset[] = [
      ...(features.gscApi ? (['seo-rank-history'] as const) : []),
      ...(trackHistory ? (['seo-score-history'] as const) : []),
      ...(features.performance ? (['seo-performance'] as const) : []),
      ...(features.seoLogs ? (['seo-logs'] as const) : []),
    ]
    const retentionOptions: RetentionRunOptions = {
      enabled: enabledDatasets,
      maxRows: pluginConfig.retentionMaxRows,
      resolveStore,
    }
    const trackScoreOptions = { resolveStore, waitUntil: pluginConfig.waitUntil }

    // Helper: build the final fields array, optionally wrapping in tabs
    function assembleFields(
      existingFields: Field[],
      fieldsToAdd: Field[],
      options?: { label?: string; isAuth?: boolean },
    ): Field[] {
      if (!pluginConfig.tabbedUI) {
        return [...existingFields, ...fieldsToAdd]
      }

      // Auth collections: keep email field outside tabs
      const isAuth = options?.isAuth ?? false
      const emailField = isAuth
        ? existingFields.find((f) => 'name' in f && f.name === 'email')
        : undefined
      const contentFields = emailField
        ? existingFields.filter((f) => !('name' in f && f.name === 'email'))
        : existingFields

      const firstField = contentFields[0] as Record<string, unknown> | undefined
      const hasExistingTabs = firstField?.type === 'tabs' && Array.isArray((firstField as Record<string, unknown>).tabs)

      const contentTabs = hasExistingTabs
        ? ((firstField as Record<string, unknown>).tabs as unknown[])
        : [{ fields: contentFields, label: options?.label || 'Content' }]

      const tabbedField = {
        type: 'tabs' as const,
        tabs: [
          ...contentTabs,
          { fields: fieldsToAdd, label: 'SEO' },
        ],
      }

      return [
        ...(emailField ? [emailField] : []),
        tabbedField as unknown as Field,
        ...(hasExistingTabs ? contentFields.slice(1) : []),
      ]
    }

    // 1. Add SEO fields + afterChange hook to target collections
    if (config.collections) {
      config.collections = config.collections.map((collection) => {
        if (targetCollections.includes(collection.slug)) {
          const existingFields = (collection.fields || []) as Field[]
          const hasSeoMeta = hasExistingSeoMeta(existingFields)

          // Determine which fields to add
          const fieldsToAdd = [...seoFields()]

          // Auto-create meta fields if:
          // - @payloadcms/plugin-seo is NOT detected
          // - autoCreateMetaFields is not explicitly set to false
          if (!hasSeoMeta && pluginConfig.autoCreateMetaFields !== false) {
            fieldsToAdd.push(...buildMetaFields())
          } else if (hasSeoMeta) {
            console.warn(
              `[seo-analyzer] Collection "${collection.slug}" already has SEO meta fields (likely from @payloadcms/plugin-seo). ` +
              `Meta fields will NOT be auto-created. Only SEO analyzer fields will be added.`
            )
          }

          const isAuth = !!(collection as Record<string, unknown>).auth
          const label = typeof collection.labels?.singular === 'string'
            ? collection.labels.singular
            : undefined

          const updated = {
            ...collection,
            fields: assembleFields(existingFields, fieldsToAdd, { label, isAuth }),
          }
          // Add auto-redirect hook (beforeChange — detects slug changes)
          if (features.redirects) {
            const existingBeforeHooks = updated.hooks?.beforeChange || []
            updated.hooks = {
              ...updated.hooks,
              beforeChange: [
                ...(Array.isArray(existingBeforeHooks) ? existingBeforeHooks : [existingBeforeHooks]),
                createAutoRedirectHook(pluginConfig.redirectsCollection ?? 'seo-redirects'),
              ],
            }
          }
          // Invalidate the content caches on every save/delete (independent of score history)
          {
            const existingAfterChange = updated.hooks?.afterChange || []
            const existingAfterDelete = updated.hooks?.afterDelete || []
            updated.hooks = {
              ...updated.hooks,
              afterChange: [
                ...(Array.isArray(existingAfterChange) ? existingAfterChange : [existingAfterChange]),
                invalidateContentHook,
              ],
              afterDelete: [
                ...(Array.isArray(existingAfterDelete) ? existingAfterDelete : [existingAfterDelete]),
                invalidateContentHook,
              ],
            }
          }
          // Add score tracking hook
          if (trackHistory) {
            const existingHooks = updated.hooks?.afterChange || []
            updated.hooks = {
              ...updated.hooks,
              afterChange: [
                ...(Array.isArray(existingHooks) ? existingHooks : [existingHooks]),
                createTrackSeoScoreHook(seoConfig, trackScoreOptions),
              ],
            }
          }
          // Add IndexNow proactive-indexing hook (submits the URL on publish)
          if (features.indexNow) {
            const existingHooks = updated.hooks?.afterChange || []
            updated.hooks = {
              ...updated.hooks,
              afterChange: [
                ...(Array.isArray(existingHooks) ? existingHooks : [existingHooks]),
                createIndexNowHook(basePath, seoConfig),
              ],
            }
          }
          return updated
        }
        return collection
      })
    }

    // 1a. Add SEO fields to target globals
    if (targetGlobals.length > 0 && config.globals) {
      config.globals = config.globals.map((global) => {
        if (!targetGlobals.includes(global.slug)) return global

        const existingFields = global.fields || []
        const hasSeoMeta = hasExistingSeoMeta(existingFields)

        const fieldsToAdd = [...seoFields()]
        if (!hasSeoMeta && pluginConfig.autoCreateMetaFields !== false) {
          fieldsToAdd.push(...buildMetaFields())
        }

        const label = typeof global.label === 'string' ? global.label : undefined

        const updated = {
          ...global,
          fields: assembleFields(existingFields as Field[], fieldsToAdd, { label }),
        }

        // Invalidate the content caches on every save
        {
          const existingAfterChange = updated.hooks?.afterChange || []
          updated.hooks = {
            ...updated.hooks,
            afterChange: [
              ...(Array.isArray(existingAfterChange) ? existingAfterChange : [existingAfterChange]),
              invalidateContentHook,
            ],
          }
        }

        // Add score tracking hook for globals (no auto-redirect — globals have no slug)
        if (trackHistory) {
          const existingHooks = updated.hooks?.afterChange || []
          updated.hooks = {
            ...updated.hooks,
            afterChange: [
              ...(Array.isArray(existingHooks) ? existingHooks : [existingHooks]),
              createTrackSeoScoreGlobalHook(seoConfig, trackScoreOptions),
            ],
          }
        }

        return updated
      })
    }

    // 1b. Add plugin-managed collections (conditionally based on features)
    const redirectsSlug = pluginConfig.redirectsCollection ?? 'seo-redirects'
    const allowExternalRedirects = pluginConfig.allowExternalRedirects === true
    const hasExistingRedirects = config.collections?.some((c) => c.slug === redirectsSlug)
    const pluginCollections = []
    // With a `dataStore`, the time-series collections are not registered at all.
    const timeSeriesCollections = !pluginConfig.dataStore
    if (trackHistory && timeSeriesCollections) pluginCollections.push(createSeoScoreHistoryCollection())
    if (features.settings) pluginCollections.push(createSeoSettingsCollection())
    if (features.redirects && !hasExistingRedirects) pluginCollections.push(createSeoRedirectsCollection(redirectsSlug, allowExternalRedirects))
    if (features.performance && timeSeriesCollections) pluginCollections.push(createSeoPerformanceCollection())
    if (features.seoLogs && timeSeriesCollections) pluginCollections.push(createSeoLogsCollection())
    // GSC OAuth tokens are small config data: always a collection in the main database.
    if (features.gscApi) pluginCollections.push(createSeoGscAuthCollection())
    if (features.gscApi && timeSeriesCollections) pluginCollections.push(createSeoRankHistoryCollection())
    config.collections = [
      ...(config.collections || []),
      ...pluginCollections,
    ]

    // Invalidation for the plugin's own data: redirects feed the sitemap audit, link graph
    // and chain detection; settings (ignored slugs, thresholds, sitemap config) feed every
    // content cache. Covers REST/admin CRUD as well as the plugin endpoints. Also applied
    // to a host-supplied redirects collection.
    const invalidateRedirectsHook = createInvalidateCachesHook(REDIRECT_CACHE_BASES, sharedCache)
    config.collections = config.collections.map((collection) => {
      const hook =
        features.redirects && collection.slug === redirectsSlug
          ? invalidateRedirectsHook
          : features.settings && collection.slug === 'seo-settings'
            ? invalidateContentHook
            : undefined
      if (!hook) return collection
      const existingAfterChange = collection.hooks?.afterChange || []
      const existingAfterDelete = collection.hooks?.afterDelete || []
      return {
        ...collection,
        hooks: {
          ...collection.hooks,
          afterChange: [
            ...(Array.isArray(existingAfterChange) ? existingAfterChange : [existingAfterChange]),
            hook,
          ],
          afterDelete: [
            ...(Array.isArray(existingAfterDelete) ? existingAfterDelete : [existingAfterDelete]),
            hook,
          ],
        },
      }
    })

    // Rate limiting, per caller (user, else IP) — limits in `SEO_RATE_LIMITS` (rateLimiter.ts).
    // The in-memory limiters are per process, so on Workers each isolate counts on its own;
    // the `rateLimit` option lets the host back them with a shared limiter (Workers Rate
    // Limiting bindings in apps/web).
    // - expensive (10/min): LLM calls and heavy crawls.
    // - audit-poll (120/min): the background-built audits are POLLED every 3 s while the
    //   (single-flight) build runs; the polls only read the cache or return a 202, and a
    //   10/min cap surfaced as HTTP 429 mid-build.
    // - ai-interactive (30/min): per-document LLM endpoints (/ai-rewrite, /ai-optimize),
    //   one human click at a time. A brake, not a spend cap: cap spend with a credit limit
    //   on the OpenRouter key.
    const expensiveEndpointLimiter = createBucketRateLimiter('expensive', pluginConfig.rateLimit)
    const auditPollLimiter = createBucketRateLimiter('audit-poll', pluginConfig.rateLimit)
    const aiInteractiveLimiter = createBucketRateLimiter('ai-interactive', pluginConfig.rateLimit)

    /** Wrap a handler with rate limiting. Returns 429 if limit exceeded. */
    function withRateLimit(
      handler: ReturnType<typeof createAuditHandler>,
      limiter: BucketRateLimiter = expensiveEndpointLimiter,
    ): typeof handler {
      return async (req) => {
        // Prefer the authenticated user id (not spoofable) over the client IP —
        // X-Forwarded-For is client-controlled, so an IP-only key is trivially
        // bypassed by varying the header. Shared with the other limited paths, so
        // the rule cannot drift between them — see rateLimiter.ts::rateLimitKey.
        if (!(await limiter.check(rateLimitKey(req)))) {
          return Response.json(
            { error: 'Too Many Requests. Please try again later.' },
            { status: 429 },
          )
        }
        return handler(req)
      }
    }

    // 2. Add SEO API endpoints (conditionally based on features)
    type EndpointDef = { path: string; method: 'get' | 'post' | 'patch' | 'delete'; handler: ReturnType<typeof createValidateHandler> }
    const pluginEndpoints: EndpointDef[] = [
      // Core — always active (analyzer sidebar needs these)
      {
        path: `${basePath}/validate`,
        method: 'post',
        handler: createValidateHandler(targetCollections, targetGlobals, seoConfig),
      },
      {
        path: `${basePath}/validate`,
        method: 'get',
        handler: createValidateHandler(targetCollections, targetGlobals, seoConfig),
      },
      {
        path: `${basePath}/check-keyword`,
        method: 'get',
        handler: createCheckKeywordHandler(targetCollections, targetGlobals),
      },
      // Generate meta values via custom functions — always active (used by meta field UI)
      {
        path: `${basePath}/generate`,
        method: 'post',
        handler: createGenerateHandler(
          {
            generateTitle: pluginConfig.generateTitle,
            generateDescription: pluginConfig.generateDescription,
            generateImage: pluginConfig.generateImage,
            generateURL: pluginConfig.generateURL,
          },
          targetCollections,
          targetGlobals,
        ),
      },
    ]

    // Dashboard: audit endpoint
    if (features.dashboard) {
      pluginEndpoints.push({
        path: `${basePath}/audit`,
        method: 'get',
        // Poll-friendly limiter: the dashboard polls this every 3s while the background build runs.
        handler: withRateLimit(createAuditHandler(targetCollections, seoConfig, targetGlobals, pluginConfig.auditCacheFile, sharedCache), auditPollLimiter),
      })
    }

    // Score history
    if (features.scoreHistory) {
      pluginEndpoints.push({
        path: `${basePath}/history`,
        method: 'get',
        handler: createHistoryHandler(resolveStore),
      })
    }

    // Sitemap audit
    if (features.sitemapAudit) {
      pluginEndpoints.push(
        {
          path: `${basePath}/sitemap-audit`,
          method: 'get',
          handler: withRateLimit(createSitemapAuditHandler(targetCollections, redirectsSlug, pluginConfig.knownRoutes || [], sharedCache)),
        },
        {
          path: `${basePath}/sitemap-config`,
          method: 'get',
          handler: createSitemapConfigHandler(targetCollections, seoConfig),
        },
      )
    }

    // Settings
    if (features.settings) {
      pluginEndpoints.push(
        { path: `${basePath}/settings`, method: 'get', handler: createSettingsHandler() },
        { path: `${basePath}/settings`, method: 'patch', handler: createSettingsHandler() },
      )
    }

    // Internal linking (suggest-links + breadcrumb — part of analyzer core helpers)
    pluginEndpoints.push(
      {
        path: `${basePath}/suggest-links`,
        method: 'post',
        // Rate limited, but with the POLL-friendly limiter: the editor debounces
        // this call to one every 2 s while typing, so the 10/min expensive
        // limiter would 429 a legitimate writer (the mistake already made once on
        // the audit endpoint). 120/min fits sustained editing and still caps abuse.
        handler: withRateLimit(createSuggestLinksHandler(targetCollections, targetGlobals), auditPollLimiter),
      },
      {
        path: `${basePath}/breadcrumb`,
        method: 'get',
        handler: createBreadcrumbHandler(targetCollections, seoConfig),
      },
    )

    // Redirects (CRUD + chain detection + auto-create)
    if (features.redirects) {
      const rSlug = pluginConfig.redirectsCollection ?? 'seo-redirects'
      pluginEndpoints.push(
        { path: `${basePath}/create-redirect`, method: 'post', handler: createRedirectHandler(rSlug, allowExternalRedirects, sharedCache) },
        { path: `${basePath}/redirects`, method: 'get', handler: createRedirectsHandler(rSlug, allowExternalRedirects) },
        { path: `${basePath}/redirects`, method: 'post', handler: createRedirectsHandler(rSlug, allowExternalRedirects) },
        { path: `${basePath}/redirects`, method: 'patch', handler: createRedirectsHandler(rSlug, allowExternalRedirects) },
        { path: `${basePath}/redirects`, method: 'delete', handler: createRedirectsHandler(rSlug, allowExternalRedirects) },
        { path: `${basePath}/redirect-chains`, method: 'get', handler: withRateLimit(createRedirectChainsHandler(rSlug, sharedCache)) },
      )
    }

    // AI features (generate + rewrite + optimize)
    if (features.aiFeatures) {
      pluginEndpoints.push(
        { path: `${basePath}/ai-generate`, method: 'post', handler: createAiGenerateHandler(seoConfig) },
        { path: `${basePath}/ai-rewrite`, method: 'post', handler: withRateLimit(createAiRewriteHandler(targetCollections, seoConfig), aiInteractiveLimiter) },
        { path: `${basePath}/ai-optimize`, method: 'post', handler: withRateLimit(createAiOptimizeHandler(targetCollections, seoConfig), aiInteractiveLimiter) },
        { path: `${basePath}/alt-text-audit`, method: 'get', handler: createAltTextAuditHandler(uploadsCollection) },
        { path: `${basePath}/ai-alt-text`, method: 'post', handler: withRateLimit(createAiAltTextHandler(uploadsCollection, seoConfig)) },
        { path: `${basePath}/ai-content-brief`, method: 'post', handler: withRateLimit(createAiContentBriefHandler(targetCollections, seoConfig)) },
        { path: `${basePath}/ai-optimize-bulk`, method: 'post', handler: withRateLimit(createAiOptimizeBulkHandler(targetCollections, seoConfig)) },
      )
    }

    // Cannibalization detection
    if (features.cannibalization) {
      pluginEndpoints.push({
        path: `${basePath}/cannibalization`,
        method: 'get',
        handler: withRateLimit(createCannibalizationHandler(targetCollections, targetGlobals)),
      })
    }

    // External links checker
    if (features.externalLinks) {
      pluginEndpoints.push({
        path: `${basePath}/external-links`,
        method: 'post',
        handler: withRateLimit(createExternalLinksHandler(targetCollections, targetGlobals, seoConfig, sharedCache)),
      })
    }

    // Performance (GSC import)
    if (features.performance) {
      pluginEndpoints.push(
        { path: `${basePath}/performance`, method: 'get', handler: withRateLimit(createPerformanceHandler(resolveStore)) },
        { path: `${basePath}/performance`, method: 'post', handler: withRateLimit(createPerformanceHandler(resolveStore)) },
        // Core Web Vitals via PageSpeed Insights — informational, on-demand, SSRF-safe
        { path: `${basePath}/core-web-vitals`, method: 'get', handler: withRateLimit(createCoreWebVitalsHandler(seoConfig, sharedCache)) },
        // Indexation hygiene (cross-page noindex / canonical problems). A whole-site scan, so
        // it lives with the only view that calls it (the Performance view's hygiene panel)
        // and is cached + capped like the dashboard audit.
        {
          path: `${basePath}/indexation-audit`,
          method: 'get',
          handler: withRateLimit(createIndexationAuditHandler(targetCollections, seoConfig, targetGlobals, sharedCache)),
        },
      )
    }

    // Google Search Console (OAuth2) — opt-in (requires Google Cloud setup + secrets)
    if (features.gscApi) {
      pluginEndpoints.push(
        { path: `${basePath}/gsc/status`, method: 'get', handler: createGscStatusHandler(basePath, seoConfig) },
        { path: `${basePath}/gsc/auth`, method: 'get', handler: createGscAuthStartHandler(basePath, seoConfig) },
        { path: `${basePath}/gsc/callback`, method: 'get', handler: createGscCallbackHandler(basePath, seoConfig) },
        { path: `${basePath}/gsc/data`, method: 'get', handler: withRateLimit(createGscDataHandler(basePath, seoConfig)) },
        { path: `${basePath}/gsc/disconnect`, method: 'post', handler: createGscDisconnectHandler() },
        { path: `${basePath}/rank-snapshot`, method: 'post', handler: withRateLimit(createRankSnapshotHandler(basePath, seoConfig, resolveStore)) },
        { path: `${basePath}/rank-history`, method: 'get', handler: createRankHistoryHandler(resolveStore) },
        { path: `${basePath}/ctr-opportunities`, method: 'get', handler: createCtrOpportunitiesHandler(basePath, targetCollections, seoConfig) },
        // Content grade (Surfer/Clearscope-lite via GSC) — A–F grade of ONE doc vs its real queries
        { path: `${basePath}/content-grade`, method: 'get', handler: withRateLimit(createContentGradeHandler(basePath, targetCollections, seoConfig)) },
      )
    }

    // Monitoring & alerts (opt-in)
    if (features.alerts) {
      pluginEndpoints.push(
        { path: `${basePath}/alerts-digest`, method: 'get', handler: createAlertsDigestHandler(resolveStore) },
        { path: `${basePath}/alerts-run`, method: 'post', handler: withRateLimit(createAlertsRunHandler(resolveGscSiteUrl(seoConfig), resolveStore)) },
      )
    }

    // Retention purge — mandatory for enabled time-series features, and for datasets
    // `retentionDays` names. With nothing to purge, no delete route exists at all.
    const retentionTargets = resolveRetention(pluginConfig.retentionDays, retentionOptions)
    if (retentionTargets.length > 0) {
      pluginEndpoints.push(
        { path: `${basePath}/retention`, method: 'get', handler: createRetentionStatusHandler(pluginConfig.retentionDays, retentionOptions) },
        { path: `${basePath}/retention`, method: 'post', handler: withRateLimit(createRetentionPurgeHandler(pluginConfig.retentionDays, retentionOptions)) },
      )
    }

    // IndexNow — proactive indexing (opt-in). Key file is PUBLIC (search engines verify it).
    if (features.indexNow) {
      pluginEndpoints.push(
        { path: `${basePath}/indexnow-key.txt`, method: 'get', handler: createIndexNowKeyHandler() },
        { path: `${basePath}/indexnow-submit`, method: 'post', handler: withRateLimit(createIndexNowSubmitHandler(basePath, targetCollections, seoConfig)) },
      )
    }

    // Keyword research
    if (features.keywords) {
      pluginEndpoints.push({
        path: `${basePath}/keyword-research`,
        method: 'get',
        handler: withRateLimit(createKeywordResearchHandler(targetCollections, targetGlobals)),
      })
    }

    // Link graph
    if (features.linkGraph) {
      pluginEndpoints.push({
        path: `${basePath}/link-graph`,
        method: 'get',
        handler: withRateLimit(createLinkGraphHandler(targetCollections, targetGlobals)),
      })
    }

    // SEO Logs (404 tracking)
    if (features.seoLogs) {
      pluginEndpoints.push(
        { path: `${basePath}/seo-logs`, method: 'get', handler: createSeoLogsHandler(pluginConfig.seoLogsSecret, pluginConfig.rateLimit, resolveStore, pluginConfig.retentionMaxRows) },
        { path: `${basePath}/seo-logs`, method: 'post', handler: createSeoLogsHandler(pluginConfig.seoLogsSecret, pluginConfig.rateLimit, resolveStore, pluginConfig.retentionMaxRows) },
        { path: `${basePath}/seo-logs`, method: 'delete', handler: createSeoLogsHandler(pluginConfig.seoLogsSecret, pluginConfig.rateLimit, resolveStore, pluginConfig.retentionMaxRows) },
      )
    }

    // Schema.org JSON-LD generator
    if (features.schemaBuilder) {
      pluginEndpoints.push({
        path: `${basePath}/schema-generator`,
        method: 'get',
        handler: createSchemaGeneratorHandler(targetCollections, seoConfig),
      })
    }

    // Duplicate content detection
    if (features.duplicateContent) {
      pluginEndpoints.push({
        path: `${basePath}/duplicate-content`,
        method: 'get',
        handler: withRateLimit(createDuplicateContentHandler(targetCollections)),
      })
    }

    // Module health / observability — always active (admin-only inside)
    pluginEndpoints.push({
      path: `${basePath}/health`,
      method: 'get' as const,
      handler: createSeoHealthHandler(basePath, seoConfig),
    })

    // robots.txt and sitemap.xml — always active (public endpoints)
    pluginEndpoints.push(
      {
        path: `${basePath}/robots.txt`,
        method: 'get' as const,
        handler: createRobotsHandler(targetCollections, seoConfig),
      },
      {
        path: `${basePath}/robots.txt`,
        method: 'post' as const,
        handler: createRobotsUpdateHandler(),
      },
      {
        path: `${basePath}/sitemap.xml`,
        method: 'get' as const,
        handler: createSitemapHandler(targetCollections, seoConfig, sharedCache),
      },
      {
        // AI discoverability (opt-in via SEO_LLMS_TXT=1; returns 404 when disabled). Not scored.
        path: `${basePath}/llms.txt`,
        method: 'get' as const,
        handler: createLlmsTxtHandler(targetCollections, seoConfig, sharedCache),
      },
      {
        path: `${basePath}/sitemap-news.xml`,
        method: 'get' as const,
        handler: createNewsSitemapHandler(targetCollections, seoConfig, sharedCache),
      },
      {
        path: `${basePath}/sitemap-images.xml`,
        method: 'get' as const,
        handler: createImageSitemapHandler(targetCollections, seoConfig, sharedCache),
      },
      {
        path: `${basePath}/sitemap-video.xml`,
        method: 'get' as const,
        handler: createVideoSitemapHandler(targetCollections, seoConfig, sharedCache),
      },
    )

    config.endpoints = [
      ...(config.endpoints || []),
      ...pluginEndpoints,
    ]

    // 3. Add admin views + nav link (conditionally based on features)
    // At least one view-based feature must be enabled to inject admin components
    const hasAnyView = features.dashboard || features.sitemapAudit || features.settings
      || features.redirects || features.cannibalization || features.performance
      || features.keywords || features.schemaBuilder || features.linkGraph

    if (pluginConfig.addDashboardView !== false && hasAnyView) {
      if (!config.admin) config.admin = {}
      if (!config.admin.components) config.admin.components = {}
      if (!config.admin.components.views) config.admin.components.views = {}

      const views = config.admin.components.views as Record<string, unknown>

      if (features.dashboard) {
        views.seo = {
          Component: '@cargo/payload-seo-analyzer/views#SeoView',
          path: '/seo',
        }
      }

      if (features.sitemapAudit && pluginConfig.addSitemapAuditView !== false) {
        views['sitemap-audit'] = {
          Component: '@cargo/payload-seo-analyzer/views#SitemapAuditView',
          path: '/sitemap-audit',
        }
      }

      if (features.settings) {
        views['seo-config'] = {
          Component: '@cargo/payload-seo-analyzer/views#SeoConfigView',
          path: '/seo-config',
        }
      }

      if (features.redirects) {
        views['redirects'] = {
          Component: '@cargo/payload-seo-analyzer/views#RedirectManagerView',
          path: '/redirects',
        }
      }

      if (features.cannibalization) {
        views['cannibalization'] = {
          Component: '@cargo/payload-seo-analyzer/views#CannibalizationView',
          path: '/cannibalization',
        }
      }

      if (features.performance) {
        views['performance'] = {
          Component: '@cargo/payload-seo-analyzer/views#PerformanceView',
          path: '/performance',
        }
      }

      if (features.keywords) {
        views['keyword-research'] = {
          Component: '@cargo/payload-seo-analyzer/views#KeywordResearchView',
          path: '/keyword-research',
        }
      }

      if (features.schemaBuilder) {
        views['schema-builder'] = {
          Component: '@cargo/payload-seo-analyzer/views#SchemaBuilderView',
          path: '/schema-builder',
        }
      }

      if (features.linkGraph) {
        views['link-graph'] = {
          Component: '@cargo/payload-seo-analyzer/views#LinkGraphView',
          path: '/link-graph',
        }
      }

      // Inject nav link into admin sidebar
      const navLinks = config.admin.components.afterNavLinks || []
      config.admin.components.afterNavLinks = [
        ...(Array.isArray(navLinks) ? navLinks : [navLinks]),
        '@cargo/payload-seo-analyzer/client#SeoNavLink',
      ]
    }

    // 4. Inject i18n translations for meta field UI labels (Payload plugin-seo languages)
    if (!config.i18n) config.i18n = {}
    const existingTranslations = (config.i18n as Record<string, unknown>).translations as
      Record<string, Record<string, unknown>> | undefined
    const merged: Record<string, Record<string, unknown>> = { ...(existingTranslations || {}) }
    for (const [locale, namespaces] of Object.entries(seoTranslations)) {
      merged[locale] = {
        ...(merged[locale] || {}),
        ...namespaces,
      }
    }
    ;(config.i18n as Record<string, unknown>).translations = merged

    // The admin components run in the browser with their own module copies, so
    // what they need from this config travels in `admin.custom`, which is part of
    // the client config: the feature flags (a panel then never calls an endpoint
    // that was not registered). Read by hooks/useSeoLocale.ts.
    if (!config.admin) config.admin = {}
    const adminCustom = (config.admin.custom ?? {}) as Record<string, unknown>
    config.admin.custom = {
      ...adminCustom,
      seoAnalyzer: {
        ...((adminCustom.seoAnalyzer as Record<string, unknown> | undefined) ?? {}),
        features,
        // Where the endpoints are mounted, so the UI builds URLs from the real
        // `routes.api` + this path (hooks/useSeoApi.ts) instead of '/api/seo-plugin'.
        endpointBasePath: basePath,
        // The analyzed collections that exist in this config (the schema builder's page picker).
        collections: targetCollections.filter((slug) => config.collections?.some((c) => c.slug === slug)),
      },
    }

    // Server-only: lets code holding just a `payload` (deep audit helpers, the host's
    // `recordSeoNotFound`) find the data store and the enabled datasets.
    const storeRuntime: SeoStoreRuntime = {
      resolveStore,
      enabled: enabledDatasets,
      maxRows: pluginConfig.retentionMaxRows,
      notFoundProbeFilter: pluginConfig.notFoundProbeFilter,
      alertWebhookFormat: pluginConfig.alertWebhookFormat,
    }
    const custom = (config.custom ?? {}) as Record<string, unknown>
    config.custom = {
      ...custom,
      seoAnalyzer: { ...((custom.seoAnalyzer as Record<string, unknown> | undefined) ?? {}), store: storeRuntime },
    }

    // 5. Background work as Payload jobs (`jobs` option)
    const jobsOptions = resolveSeoJobsOptions(pluginConfig.jobs)
    if (jobsOptions) {
      const tasks = seoJobTasks({
        jobs: jobsOptions,
        features,
        collections: targetCollections,
        globals: targetGlobals,
        seoConfig,
        basePath,
        gscSiteUrl: resolveGscSiteUrl(seoConfig),
        retentionDays: pluginConfig.retentionDays,
        retention: retentionOptions,
        resolveStore,
        cache: sharedCache,
      })
      if (tasks.length > 0) {
        config.jobs = { ...config.jobs, tasks: [...(config.jobs?.tasks ?? []), ...tasks] }
      }
    }

    // 6. Add cache warm-up on server init
    const existingOnInit = config.onInit
    config.onInit = async (payload) => {
      if (existingOnInit) await existingOnInit(payload)
      // Serverless isolates (Cloudflare Workers) have no long-lived process: onInit runs
      // inside the first request and any setTimeout/setInterval dies with it. The cache
      // warm-up would also burn that request's CPU budget on a full site audit. Skip the
      // background schedulers there; use the on-demand endpoints (or Payload jobs on a
      // cron trigger) instead.
      if (isServerlessIsolate()) {
        if (!pluginConfig.dataStore && enabledDatasets.length > 0) {
          payload.logger.warn(
            `[seo-analyzer] ${enabledDatasets.join(', ')} are stored as Payload collections in the main database. On Workers + D1, pass \`dataStore\` (e.g. \`createSqlSeoDataStore(env.SEO_D1)\`) to keep append-only data out of it.`,
          )
        }
        if (features.dashboard && (!pluginConfig.cacheStore || !pluginConfig.waitUntil)) {
          payload.logger.warn(
            '[seo-analyzer] On serverless isolates the dashboard audit needs both `cacheStore` (shared cache) and `waitUntil` (background build); without them it may never finish building.',
          )
        }
        if (pluginConfig.auditCacheFile && !pluginConfig.cacheStore) {
          payload.logger.warn(
            '[seo-analyzer] `auditCacheFile` needs a filesystem and is ignored on serverless isolates; set `cacheStore` instead.',
          )
        }
        if (!jobsOptions && (features.gscApi || features.alerts || retentionTargets.length > 0)) {
          payload.logger.warn(
            '[seo-analyzer] Background schedulers (rank tracking, alerts, retention purge) do not run on serverless isolates; set the `jobs` option and run them from a cron.',
          )
        }
        return
      }
      // Skip startup pre-loading on low-memory hosts (features.warmCache: false)
      if (features.warmCache) {
        startCacheWarmUp(payload, basePath, targetGlobals, targetCollections)
      }
      // With `jobs`, the host's job runner does the scheduled work below.
      if (jobsOptions) return
      // Daily GSC rank snapshots (only when Search Console is enabled)
      if (features.gscApi) {
        startRankTracker(payload, basePath, seoConfig, resolveStore)
      }
      // Proactive monitoring digest (only when alerts are enabled)
      if (features.alerts) {
        startAlertsScheduler(payload, resolveGscSiteUrl(seoConfig), resolveStore)
      }
      // Daily retention purge — a no-op when no time-series feature is on and
      // `retentionDays` names nothing
      startRetentionPurge(payload, pluginConfig.retentionDays, retentionOptions)
    }

    return config
  }

/** True on runtimes without a long-lived process, where background timers cannot run. */
function isServerlessIsolate(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'
}

/** @deprecated Use `seoAnalyzerPlugin` instead. Kept for backward compatibility. */
export { seoAnalyzerPlugin as seoPlugin }
