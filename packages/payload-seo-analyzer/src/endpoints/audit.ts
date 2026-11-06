/**
 * SEO Audit endpoint handler.
 * Returns enriched SEO data for all pages and posts — powers the dashboard.
 * Uses the real analyzeSeo() engine for consistent scoring (sidebar ↔ dashboard).
 *
 * NOTE: Rate limiting is not handled by this plugin. The consuming application
 * should implement rate limiting via its own middleware (e.g., express-rate-limit,
 * Next.js middleware, or a reverse proxy like Nginx/Caddy).
 */

import type { Payload, PayloadHandler } from 'payload'
import { getSeoDataStore, seoDatasetEnabled } from '../store/index.js'
import { analyzeSeo } from '../index.js'
import type { SeoConfig } from '../types.js'
import { buildSeoInputFromDoc } from './validate.js'
import {
  calculateFlesch,
  countWords,
} from '../helpers.js'
import { defaultSeoSharedCache, hashConfig, seoCache, type SeoSharedCache } from '../cache.js'
import { auditMaxDocs } from '../helpers/auditLimits.js'
import { loadMergedConfig } from '../helpers/loadMergedConfig.js'
import { extractDocContent } from '../helpers/extractDocContent.js'
import { isSeoAdminRequest, isSeoPanelUser } from '../helpers/isAdmin.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function analyzeDoc(doc: any, collection: string, seoConfig?: SeoConfig) {
  // Build SeoInput and run the real engine
  let seoInput = buildSeoInputFromDoc(doc, collection)
  // Mark as global if collection starts with 'global:'
  seoInput.isGlobal = collection.startsWith('global:')
  if (seoInput.isGlobal) {
    seoInput.slug = ''
  }
  // Dashboard audit skips the weight-0, non-scoring groups (geo/eeat/hreflang): they do
  // recursive Lexical walks per block and only matter for single-doc analysis (sidebar).
  // Disabling them here keeps SEO scores identical while cutting per-doc CPU/memory on the
  // site-wide audit (low-memory hosts).
  const analysis = analyzeSeo(seoInput, {
    ...seoConfig,
    disabledRules: [...(seoConfig?.disabledRules ?? []), 'geo', 'eeat', 'hreflang'],
  })

  // Extract enriched data for the dashboard using the shared helper
  // (single extraction pass instead of duplicating logic from analyzeSeo's buildContext)
  const extracted = extractDocContent(doc)
  const fullText = extracted.text
  const allLinks = extracted.links
  const allHeadings = extracted.headings

  const wordCount = countWords(fullText)
  // Use the block-aware text so list items / paragraphs are counted as separate
  // sentences (otherwise scannable, list-heavy content is wrongly scored unreadable).
  // Same formula as the sidebar's readability rule (Flesch reading ease).
  const readabilityScore =
    wordCount > 30 ? calculateFlesch(extracted.readabilityText || fullText) : 0

  const internalLinks = allLinks.filter(
    (l) => l.url.startsWith('/') || l.url.startsWith('#') || !l.url.startsWith('http'),
  )
  const externalLinks = allLinks.filter((l) => l.url.startsWith('http'))

  const h1FromPostHero = collection === 'posts' && doc.title ? 1 : 0
  const h1InContent = allHeadings.filter((h) => h.tag === 'h1').length
  const h1Count = h1InContent + h1FromPostHero
  const headingCount = allHeadings.length + h1FromPostHero

  const focusKeywordsArr: string[] = Array.isArray(doc.focusKeywords)
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      doc.focusKeywords.map((k: any) => k.keyword || '').filter(Boolean)
    : []

  return {
    id: doc.id,
    collection,
    title: doc.title || '',
    slug: doc.slug || '',
    metaTitle: doc.meta?.title || '',
    metaDescription: doc.meta?.description || '',
    focusKeyword: doc.focusKeyword || '',
    focusKeywords: focusKeywordsArr,
    hasOgImage: !!doc.meta?.image,
    wordCount,
    readingTime: Math.max(1, Math.round(wordCount / 200)),
    readabilityScore,
    internalLinkCount: internalLinks.length,
    externalLinkCount: externalLinks.length,
    headingCount,
    hasH1: h1Count > 0,
    h1Count,
    score: analysis.score,
    aiReadiness: analysis.aiReadiness ? analysis.aiReadiness.score : null,
    level: analysis.level,
    status: doc._status || 'published',
    updatedAt: doc.updatedAt || '',
    isCornerstone: !!doc.isCornerstone,
    contentLastReviewed: doc.contentLastReviewed || '',
    daysSinceUpdate: doc.updatedAt
      ? Math.floor((Date.now() - new Date(doc.updatedAt).getTime()) / (1000 * 60 * 60 * 24))
      : null,
  }
}

const CACHE_KEY = 'audit'

interface AuditStats {
  totalPages: number
  avgScore: number
  good: number
  needsWork: number
  critical: number
  noKeyword: number
  noMetaTitle: number
  noMetaDesc: number
  avgWordCount: number
  avgReadability: number
}

type EnrichedResult = ReturnType<typeof analyzeDoc> & { previousScore: number | null }
type CachedAudit = { enrichedResults: EnrichedResult[]; stats: AuditStats; capped: boolean }

/*
 * Single-flight + refresh throttle. The site-wide audit is the heaviest operation in the
 * plugin (it runs analyzeSeo on every page/post). Without a single-flight guard, a slow
 * first load on a low-memory host lets the admin reload the page, firing 2-3 FULL builds
 * concurrently until the process is OOM-killed. With it, concurrent requests get a 202
 * "building" and the UI polls until the cache is ready. The throttle bounds manual
 * `?nocache=1` refreshes: without it a loop of refreshes kept the rebuild running forever.
 *
 * Both live in the cache layer (`SeoSharedCache.tryStartBuild/buildStatus`): in-memory per
 * process without a `cacheStore`, persisted (`build/<key>` marker with a staleness timeout,
 * best-effort across isolates) with one. One key for the whole site (+ config hash when
 * persisted): the audit does not depend on the content locale.
 */

/** Minimum delay between two manual (nocache=1) full rebuilds, per build key. */
function minRefreshIntervalMs(): number {
  const raw = process.env.SEO_AUDIT_MIN_REFRESH_MS
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5 * 60_000
}

type AnalyzedResult = ReturnType<typeof analyzeDoc>

/**
 * Saved state of a chunked build between steps (`SeoSharedCache.writeProgress`). The scan
 * resumes at page `page` of `collections[collection]`, with the same page size.
 */
interface AuditProgress {
  v: 1
  /** Generation read when the build started; the finished audit is stamped with it. */
  gen: string
  collection: number
  page: number
  batchSize: number
  results: AnalyzedResult[]
  capped: boolean
}

/**
 * How much one build step may do before it saves its progress and pauses. Only builds
 * that run through `waitUntil` (Workers, ~30 s CPU and wall time per invocation) are
 * chunked; elsewhere a step runs to the end. The budget is checked between DB pages, so a
 * step can overrun it by one page. Env: `SEO_AUDIT_STEP_DOCS` (default 800, about 8 s CPU
 * on a deployed Worker) and `SEO_AUDIT_STEP_MS` (default 20 s of wall time).
 */
function auditStepBudget(chunked: boolean): { maxDocs: number; maxMs: number } {
  if (!chunked) return { maxDocs: Infinity, maxMs: Infinity }
  const docs = parseInt(process.env.SEO_AUDIT_STEP_DOCS || '800', 10)
  const ms = parseInt(process.env.SEO_AUDIT_STEP_MS || '20000', 10)
  return {
    maxDocs: Number.isFinite(docs) && docs > 0 ? docs : 800,
    maxMs: Number.isFinite(ms) && ms > 0 ? ms : 20000,
  }
}

/**
 * Scan the collections from `progress` until every doc is analyzed (returns true) or the
 * step budget is spent (returns false; `progress` holds the cursor). Mutates `progress`.
 */
async function scanAuditDocs(
  payload: Payload,
  collections: string[],
  mergedConfig: SeoConfig,
  ignoredSlugs: string[],
  progress: AuditProgress,
  opts: { unthrottled: boolean; maxDocs: number; maxMs: number },
): Promise<boolean> {
  // Tiered + THROTTLED build to stay light on constrained shared hosting (e.g. Infomaniak).
  // Process SMALL batches and PAUSE between each (real delay, not just setImmediate): this caps
  // CPU usage and gives V8 time to reclaim the previous batch before loading the next, so the
  // site stays responsive during the (background) build instead of being saturated for minutes.
  // All three knobs are env-tunable — lower batch / raise delay on the tiniest hosts.
  //
  // `unthrottled` (set when the host provides `waitUntil`, i.e. Workers): background work
  // there gets ~30 s of wall time after the response and runs in its own isolate, so the
  // cooperative pauses only make the build overrun that budget. Defaults drop to zero
  // pauses and bigger batches; the env vars still override.
  const fast = opts.unthrottled === true
  const BATCH_SIZE = progress.batchSize
  const BATCH_DELAY_MS = Math.min(5000, Math.max(0, parseInt(process.env.SEO_AUDIT_BATCH_DELAY_MS || (fast ? '0' : '100'), 10) || 0))
  // Per-document throttle: a REAL pause (not just setImmediate) after each doc gives the event
  // loop idle time so the site stays responsive while the (background) build runs. Trades a
  // longer build for a much gentler CPU profile. Default 10ms; set 0 for the fastest build,
  // raise it (e.g. 25–50) on rich-content / constrained sites.
  const DOC_DELAY_MS = Math.min(1000, Math.max(0, parseInt(process.env.SEO_AUDIT_DOC_DELAY_MS || (fast ? '0' : '10'), 10) || 0))
  // The dominant cost is analyzeDoc() — synchronous and un-interruptible (one rich doc can block
  // the single Node event loop for 100-300ms). After each doc we pause for ~THROTTLE_RATIO × the
  // time it just took, so the event loop stays free ≈ ratio/(1+ratio) of the time and the admin/
  // site remains responsive regardless of content size. DOC_DELAY_MS is the floor; capped per doc.
  const THROTTLE_RATIO = Math.min(10, Math.max(0, parseFloat(process.env.SEO_AUDIT_THROTTLE_RATIO || (fast ? '0' : '2')) || 0))
  const MAX_DOC_PAUSE_MS = 750
  // depth:1 populates uploads/relations (heavier). Default 1 keeps scores identical to the
  // sidebar; set SEO_AUDIT_DEPTH=0 on the tiniest hosts to cut memory/CPU (image-dimension
  // sub-checks then see IDs instead of populated media — a minor, acceptable score difference).
  // Default depth 0 — the dashboard audit is a coarse overview; populating relations (media) for
  // every doc is the heaviest part on constrained hosts. depth:0 cuts CPU+memory a lot. Set
  // SEO_AUDIT_DEPTH=1 to restore exact parity with the sidebar on image-dimension sub-checks.
  const rawDepth = parseInt(process.env.SEO_AUDIT_DEPTH ?? '0', 10)
  const DEPTH = Number.isNaN(rawDepth) ? 0 : Math.min(2, Math.max(0, rawDepth))

  const MAX_DOCS = auditMaxDocs()
  const stepStart = Date.now()
  let stepDocs = 0

  for (; progress.collection < collections.length; progress.collection++, progress.page = 1) {
    const collectionSlug = collections[progress.collection]
    try {
      let hasMore = true
      while (hasMore) {
        // Budget check between pages, so the cursor always points at a whole page.
        if (stepDocs >= opts.maxDocs || Date.now() - stepStart >= opts.maxMs) return false
        const result = await payload.find({
          collection: collectionSlug,
          limit: BATCH_SIZE,
          page: progress.page,
          depth: DEPTH,
          // A stable order, so pages line up across the steps of a chunked build.
          sort: 'id',
          overrideAccess: true,
        })
        for (const doc of result.docs) {
          stepDocs++
          if (ignoredSlugs.includes(doc.slug as string)) continue
          // Skip drafts — the site-wide audit scores PUBLISHED content (collections without a
          // draft system have no _status, so they pass through unchanged).
          if ((doc as { _status?: string })._status === 'draft') continue
          if (progress.results.length >= MAX_DOCS) {
            progress.capped = true
            payload.logger.warn(
              `[seo] audit: capped at ${MAX_DOCS} docs (SEO_AUDIT_MAX_DOCS). Lower SEO_AUDIT_BATCH_SIZE on low-memory hosts, or raise the cap.`,
            )
            return true
          }
          const t0 = Date.now()
          try {
            progress.results.push(analyzeDoc(doc, collectionSlug, mergedConfig))
          } catch (e) {
            payload.logger.warn(
              `[seo] audit: skipped ${collectionSlug}/${(doc as { id?: unknown }).id}: ${e instanceof Error ? e.message : 'error'}`,
            )
          }
          // ADAPTIVE cooperative throttle. analyzeDoc() is synchronous and un-interruptible, so
          // while it runs the single Node process can't serve any other request. We pause for
          // ~THROTTLE_RATIO × the time this doc just took: the event loop then stays free roughly
          // ratio/(1+ratio) of the time, so the admin/site keeps responding even mid-build on heavy
          // docs. Floored at DOC_DELAY_MS and capped at MAX_DOC_PAUSE_MS so it never stalls forever.
          const elapsed = Date.now() - t0
          const pause = Math.min(MAX_DOC_PAUSE_MS, Math.max(DOC_DELAY_MS, Math.round(elapsed * THROTTLE_RATIO)))
          if (pause > 0) {
            await new Promise((resolve) => setTimeout(resolve, pause))
          } else {
            await yieldToEventLoop()
          }
        }
        hasMore = result.hasNextPage
        progress.page++
        // Extra throttle between DB pages (env-tunable). With the per-doc yield above this is
        // usually optional, but raising it cools the CPU further on the tiniest hosts.
        if (BATCH_DELAY_MS > 0) await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS))
      }
    } catch {
      // Collection might not exist — skip silently
    }
  }
  return true
}

/** Add globals, previous scores and stats to the scanned docs. */
async function finalizeAudit(
  payload: Payload,
  globals: string[],
  mergedConfig: SeoConfig,
  ignoredSlugs: string[],
  allResults: AnalyzedResult[],
  capped: boolean,
): Promise<CachedAudit> {
  // Fetch from globals
  for (const globalSlug of globals) {
    try {
      const doc = await payload.findGlobal({
        slug: globalSlug,
        depth: 1,
        overrideAccess: true,
      })
      if (doc) {
        // Skip if in ignored slugs
        if (ignoredSlugs.includes(globalSlug)) continue
        const result = analyzeDoc(doc, `global:${globalSlug}`, mergedConfig)
        // Override some fields for globals
        allResults.push({
          ...result,
          id: globalSlug,
          collection: `global:${globalSlug}`,
          slug: '',
          title: (doc as any).title || globalSlug,
        })
      }
    } catch {
      // Global might not exist — skip
    }
  }

  // Fetch previous scores from history for trend indicator. Bounded to avoid loading an
  // unbounded history into memory on sites with long score history.
  const previousScoreMap = new Map<string, number>()
  if (seoDatasetEnabled(payload, 'seo-score-history')) {
    try {
      const history = await getSeoDataStore(payload).scoreHistory.list({
        limit: Math.min(allResults.length * 2, 3000),
      })
      const seen = new Set<string>()
      for (const h of history) {
        const key = `${h.documentId}::${h.collection}`
        if (!seen.has(key)) {
          seen.add(key)
          continue
        }
        if (!previousScoreMap.has(key)) previousScoreMap.set(key, h.score)
      }
    } catch {
      // no score history (feature off, or the store is unreachable): no trend
    }
  }

  // Enrich results with previous score for trend display
  const enrichedResults: EnrichedResult[] = allResults.map((r) => ({
    ...r,
    previousScore: previousScoreMap.get(`${r.id}::${r.collection}`) ?? null,
  }))

  // Sort worst scores first
  enrichedResults.sort((a, b) => a.score - b.score)

  const totalDocs = enrichedResults.length
  const stats: AuditStats = {
    totalPages: totalDocs,
    avgScore:
      totalDocs > 0
        ? Math.round(enrichedResults.reduce((s, r) => s + r.score, 0) / totalDocs)
        : 0,
    good: enrichedResults.filter((r) => r.score >= 80).length,
    needsWork: enrichedResults.filter((r) => r.score >= 50 && r.score < 80).length,
    critical: enrichedResults.filter((r) => r.score < 50).length,
    noKeyword: enrichedResults.filter((r) => !r.focusKeyword).length,
    noMetaTitle: enrichedResults.filter((r) => !r.metaTitle).length,
    noMetaDesc: enrichedResults.filter((r) => !r.metaDescription).length,
    avgWordCount:
      totalDocs > 0
        ? Math.round(enrichedResults.reduce((s, r) => s + r.wordCount, 0) / totalDocs)
        : 0,
    avgReadability:
      totalDocs > 0
        ? Math.round(enrichedResults.reduce((s, r) => s + r.readabilityScore, 0) / totalDocs)
        : 0,
  }

  return { enrichedResults, stats, capped }
}

/** The whole audit in one pass (no budget, no saved progress). Used by `buildAuditToFile`. */
async function buildAuditCache(
  payload: Payload,
  collections: string[],
  globals: string[],
  seoConfig?: SeoConfig,
): Promise<CachedAudit> {
  const progress: AuditProgress = {
    v: 1,
    gen: '',
    collection: 0,
    page: 1,
    batchSize: auditBatchSize(false),
    results: [],
    capped: false,
  }
  const { config: mergedConfig, ignoredSlugs } = await loadMergedConfig(payload, seoConfig)
  await scanAuditDocs(payload, collections, mergedConfig, ignoredSlugs, progress, {
    unthrottled: false,
    maxDocs: Infinity,
    maxMs: Infinity,
  })
  return finalizeAudit(payload, globals, mergedConfig, ignoredSlugs, progress.results, progress.capped)
}

/** Page size of a new build. Fixed for the whole build (saved in its progress). */
function auditBatchSize(unthrottled: boolean): number {
  return Math.min(100, Math.max(1, parseInt(process.env.SEO_AUDIT_BATCH_SIZE || (unthrottled ? '50' : '10'), 10) || 10))
}

/**
 * Run one step of the audit build for `cacheKey`, which the caller has claimed
 * (`tryStartBuildStep`). Resumes saved progress when `resumed`, else starts over. Returns
 * 'done' once the audit is stored, 'paused' when the step budget ran out first (progress
 * saved). Doesn't release the claim; see `runClaimedAuditStep`.
 */
async function runAuditBuildStep(
  cache: SeoSharedCache,
  payload: Payload,
  collections: string[],
  globals: string[],
  seoConfig: SeoConfig | undefined,
  cacheKey: string,
  resumed: boolean,
): Promise<{ outcome: 'done' | 'paused'; processed: number }> {
  const unthrottled = cache.hasWaitUntil
  let progress = resumed ? await cache.readProgress<AuditProgress>(cacheKey) : null
  if (!progress || progress.v !== 1 || !Array.isArray(progress.results)) {
    progress = {
      v: 1,
      // Read the generation BEFORE building: a save during the build bumps it, so the
      // result is stored already stale instead of hiding that save.
      gen: await cache.generation(CACHE_KEY),
      collection: 0,
      page: 1,
      batchSize: auditBatchSize(unthrottled),
      results: [],
      capped: false,
    }
  }
  // Load merged config from DB settings + plugin config
  const { config: mergedConfig, ignoredSlugs } = await loadMergedConfig(payload, seoConfig)
  const finished = await scanAuditDocs(payload, collections, mergedConfig, ignoredSlugs, progress, {
    unthrottled,
    ...auditStepBudget(unthrottled),
  })
  if (!finished) {
    await cache.writeProgress(cacheKey, progress)
    return { outcome: 'paused', processed: progress.results.length }
  }
  const result = await finalizeAudit(payload, globals, mergedConfig, ignoredSlugs, progress.results, progress.capped)
  await cache.set(CACHE_KEY, cacheKey, result, progress.gen)
  await cache.clearProgress(cacheKey)
  return { outcome: 'done', processed: progress.results.length }
}

/** Run a claimed step and release the claim (pause or finish). Never throws. */
async function runClaimedAuditStep(
  cache: SeoSharedCache,
  payload: Payload,
  collections: string[],
  globals: string[],
  seoConfig: SeoConfig | undefined,
  cacheKey: string,
  resumed: boolean,
): Promise<'done' | 'paused' | 'failed'> {
  try {
    const step = await runAuditBuildStep(cache, payload, collections, globals, seoConfig, cacheKey, resumed)
    if (step.outcome === 'paused') {
      await cache.pauseBuild(cacheKey, step.processed)
      return 'paused'
    }
    await cache.finishBuild(cacheKey)
    return 'done'
  } catch (e) {
    payload.logger.error(`[seo] audit build failed: ${e instanceof Error ? e.message : 'unknown'}`)
    await cache.clearProgress(cacheKey)
    await cache.finishBuild(cacheKey)
    return 'failed'
  }
}

/** Yield once to the event loop (setImmediate where available, else a 0 ms timer). */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setImmediate === 'function') setImmediate(resolve)
    else setTimeout(resolve, 0)
  })
}

/**
 * Start (or resume) a background build step if none is running for this key
 * (single-flight). The step runs after the response: through the host's `waitUntil` when
 * configured (Workers cancel un-awaited work otherwise), else fire-and-forget (long-lived
 * Node). On Workers a big site takes several steps; each poll of the dashboard starts the
 * next one, and the `seoAuditContinue` job (`jobs` option) finishes builds nobody watches.
 */
async function ensureAuditBuild(
  cache: SeoSharedCache,
  payload: Payload,
  collections: string[],
  globals: string[],
  seoConfig: SeoConfig | undefined,
  cacheKey: string,
): Promise<boolean> {
  const claim = await cache.tryStartBuildStep(cacheKey)
  if (!claim.claimed) return false
  cache.runInBackground(
    runClaimedAuditStep(cache, payload, collections, globals, seoConfig, cacheKey, claim.resumed),
  )
  return true
}

/** Hash of the config that shapes the audit; part of persisted keys. */
function auditConfigHash(collections: string[], globals: string[], seoConfig: SeoConfig | undefined): string {
  // v2: readability uses the English Flesch formula.
  return hashConfig({ v: 2, collections, globals, seoConfig: seoConfig ?? null })
}

/**
 * The audit never passes a locale to `payload.find` (it scores the default-locale
 * content of every doc), so every locale would build and store the same result:
 * the key is the same for all of them.
 */
function auditCacheKey(cache: SeoSharedCache, configHash: string): string {
  return cache.persistent ? `${CACHE_KEY}:${configHash}` : CACHE_KEY
}

/**
 * Run the next step of the paused audit build, if there is one, awaited. Used by the
 * `seoAuditContinue` job, so a chunked build finishes even when nobody keeps the
 * dashboard open. Builds that aren't paused are left alone (no prewarming).
 */
export async function continuePausedAuditBuilds(args: {
  payload: Payload
  collections: string[]
  globals: string[]
  seoConfig?: SeoConfig
  cache: SeoSharedCache
}): Promise<{ key: string; outcome: 'done' | 'paused' | 'failed' }[]> {
  const { payload, collections, globals, seoConfig, cache } = args
  const configHash = auditConfigHash(collections, globals, seoConfig)
  const key = auditCacheKey(cache, configHash)
  const status = await cache.buildStatus(key)
  if (!status.paused) return []
  const claim = await cache.tryStartBuildStep(key)
  if (!claim.claimed) return []
  return [
    {
      key,
      outcome: await runClaimedAuditStep(cache, payload, collections, globals, seoConfig, key, claim.resumed),
    },
  ]
}

/** Shape of the build-time audit cache file (one CachedAudit per key). */
interface AuditCacheFile {
  version: number
  generatedAt: number
  byKey: Record<string, CachedAudit>
}

/**
 * Build the site-wide audit and write it to a JSON file. Meant to run at
 * BUILD/CI time (where memory is plentiful) so a memory-constrained production host can
 * hydrate the cache from the file instead of recomputing the heavy audit. Uses the exact
 * same engine as the live dashboard build → identical scores.
 *
 * The audit is the same for every content locale, so it is built once.
 *
 * Node-only (writes the filesystem). The resulting file is read through the plugin's
 * `auditCacheFile` option, which is ignored when a `cacheStore` is configured (the store
 * already persists the audit) and on Workers (no filesystem).
 */
export async function buildAuditToFile(
  payload: Payload,
  opts: {
    collections: string[]
    globals?: string[]
    seoConfig?: SeoConfig
    outFile: string
  },
): Promise<{ file: string; entries: number; docs: number }> {
  const built = await buildAuditCache(payload, opts.collections, opts.globals ?? [], opts.seoConfig)
  const byKey: Record<string, CachedAudit> = { [CACHE_KEY]: built }
  const docs = built.enrichedResults.length
  const fileData: AuditCacheFile = { version: 1, generatedAt: Date.now(), byKey }
  // Dynamic import keeps node:fs out of the (tree-shaken) client bundle — this function is
  // server/CLI-only, so the import never reaches the admin UI.
  const { writeFile } = await import('node:fs/promises')
  await writeFile(opts.outFile, JSON.stringify(fileData))
  return { file: opts.outFile, entries: Object.keys(byKey).length, docs }
}

/**
 * Hydrate the in-memory cache from a build-time JSON file. Cheap (a file read) compared to
 * the live site-wide build. Returns false (→ caller falls back to a live build) when the
 * file is missing, invalid, or STALE — i.e. generated before the last cache invalidation,
 * which means content changed since the build and the pre-computed scores can't be trusted.
 */
async function tryHydrateAuditFromFile(
  filePath: string,
  /**
   * `false`: serves the file even if it is older than the last invalidation.
   *
   * The freshness check relies on `seoCache.lastInvalidatedAt`, an IN-MEMORY clock of the
   * process: it restarts from zero at every boot, and any content edit pushes it to
   * `Date.now()`. On a memory-constrained host that backfires — the slightest edit makes
   * the file "stale", the handler falls back to a site-wide rebuild, and the container
   * dies of OOM. The `auditCacheFile` option, meant to avoid exactly that cost, became
   * unusable on the very target it was written for, to the point that a consumer had to
   * neutralize the line with a patch-package.
   *
   * Freshness is then ensured another way: the file is regenerated on every deploy by
   * the CI prewarm.
   */
  checkFreshness = true,
): Promise<boolean> {
  try {
    // Dynamic import keeps node:fs out of the (tree-shaken) client bundle (server-only path).
    const { readFile } = await import('node:fs/promises')
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as AuditCacheFile
    const generatedAt = typeof parsed.generatedAt === 'number' ? parsed.generatedAt : 0
    if (!parsed.byKey || !generatedAt) return false
    if (checkFreshness && generatedAt < seoCache.lastInvalidatedAt) return false // stale: content changed since build
    let hydrated = false
    for (const [key, val] of Object.entries(parsed.byKey)) {
      seoCache.set(key, val)
      hydrated = true
    }
    return hydrated
  } catch {
    return false // no file / invalid JSON → fall back to a live build
  }
}

export function createAuditHandler(
  collections: string[],
  seoConfig?: SeoConfig,
  globals: string[] = [],
  auditCacheFile?: string,
  cache: SeoSharedCache = defaultSeoSharedCache,
): PayloadHandler {
  // Persisted entries outlive deploys, so their key includes a hash of the config that
  // shapes the audit: a deploy that changes collections/rules starts from a clean slate.
  const configHash = auditConfigHash(collections, globals, seoConfig)
  // The build-time file cache is a filesystem feature for long-lived Node hosts. With a
  // persistent store the audit already survives restarts, so the file is ignored there
  // (the plugin warns at init).
  const fileCache = cache.persistent ? undefined : auditCacheFile
  return async (req) => {
    try {
      if (!isSeoPanelUser(req)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Pagination params
      const url = new URL(req.url as string)
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
      const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '300', 10)))
      const noCache = url.searchParams.get('nocache') === '1'

      // One cache entry + single-flight for the whole site: the audit is the same for every
      // content locale, and keying on the request's `?locale=` would let a caller mint
      // unlimited keys (each a guaranteed miss, hence a fresh site-wide build).
      const cacheKey = auditCacheKey(cache, configHash)

      // Manual refresh: start a rebuild now. The current audit keeps being served (marked
      // `refreshing`) until the new one replaces it.
      //
      // Gated twice, because forcing a site-wide rebuild is the most expensive thing any
      // caller can ask of this plugin:
      //  - only an SEO admin may trigger it (the legitimate caller is the dashboard's
      //    "refresh" button), not merely an authenticated panel user;
      //  - and never more than once per `minRefreshIntervalMs()`, so a loop of
      //    `?nocache=1` cannot keep the rebuild running back-to-back.
      // A refused refresh is NOT an error: the caller gets the cached audit with
      // `refreshThrottled: true` so the UI can say "showing cached results".
      let refreshThrottled = false
      let forceRebuild = false
      const build = await cache.buildStatus(cacheKey)
      if (noCache && !build.building) {
        if (!isSeoAdminRequest(req)) {
          refreshThrottled = true
        } else if (Date.now() - build.lastBuildAt < minRefreshIntervalMs()) {
          refreshThrottled = true
        } else {
          forceRebuild = true
        }
      }

      // `allowStale`: after a save the last finished audit is still returned, flagged `stale`, so
      // the dashboard keeps showing it while the next build runs. An audit past its TTL with no
      // save since is served as current: nothing it depends on changed, so no rebuild starts.
      const lookup = await cache.lookup<CachedAudit>(CACHE_KEY, cacheKey, { allowStale: true })
      let cached = lookup.data
      let stale = !!lookup.stale
      // Peek mode (`noBuild=1`): the request itself never starts a build; it returns cached
      // results if present, or "not built" otherwise, and runs the next step of a build that's
      // already running. A first build is opt-in (the user asks for it). When the peek finds a
      // stale audit (a save since it was built), the dashboard follows up with a normal poll,
      // which starts the rebuild while the old audit stays on screen.
      const noBuild = url.searchParams.get('noBuild') === '1'

      // Build-time file cache: on a miss, hydrating from the pre-computed JSON is cheap (a file
      // read) vs the heavy live build. Done BEFORE the build decision so even a peek (noBuild)
      // serves pre-computed scores with zero rebuild on memory-constrained hosts. The freshness
      // guard inside tryHydrateAuditFromFile() falls back to a live build once content changes.
      // Runtime kill-switch: SEO_AUDIT_FILE_CACHE=0/false ignores the file (forces a live build).
      const fileCacheOff =
        process.env.SEO_AUDIT_FILE_CACHE === '0' || process.env.SEO_AUDIT_FILE_CACHE === 'false'
      // `SEO_AUDIT_TRUST_FILE=1`: serves the file without checking its freshness.
      //
      // Meant for memory-constrained hosts, where the site-wide rebuild triggered by the
      // freshness check kills the container. Freshness is then guaranteed by the CI
      // prewarm, which regenerates the file on every deploy.
      const trustFile = process.env.SEO_AUDIT_TRUST_FILE === '1'
      if (
        (!cached || stale) &&
        fileCache &&
        !fileCacheOff &&
        (await tryHydrateAuditFromFile(fileCache, !trustFile))
      ) {
        const hydrated = seoCache.get<CachedAudit>(cacheKey)
        if (hydrated) {
          cached = hydrated
          stale = false
        }
      }

      // Start (or continue) a build when one is needed: the audit is missing or stale (unless
      // this is a peek), a refresh was asked for, or a chunked build is waiting for its next step.
      const wantsBuild = forceRebuild || build.building || (!noBuild && (!cached || stale))
      const started = wantsBuild
        ? await ensureAuditBuild(cache, req.payload, collections, globals, seoConfig, cacheKey)
        : false
      const refreshing = build.building || started
      // Docs analyzed so far by a chunked build (absent before its first pause).
      const progress = refreshing && typeof build.processed === 'number' ? { processed: build.processed } : {}

      if (!cached) {
        if (noBuild && !refreshing) {
          return Response.json(
            { building: false, notBuilt: true, results: [], stats: null },
            { status: 200, headers: { 'Cache-Control': 'no-store' } },
          )
        }
        // Cache miss — never build synchronously on the request path (that's what OOM-killed
        // the process on low-memory hosts). The single-flight background build was started
        // above; tell the client to poll. The 202 response is tiny and returns immediately.
        return Response.json(
          { building: true, results: [], stats: null, ...progress },
          { status: 202, headers: { 'Cache-Control': 'no-store' } },
        )
      }

      const { enrichedResults, stats, capped } = cached
      const totalDocs = enrichedResults.length
      const totalPages = Math.ceil(totalDocs / limit)
      const startIdx = (page - 1) * limit
      const paginatedResults = enrichedResults.slice(startIdx, startIdx + limit)

      return Response.json({
        results: paginatedResults,
        stats,
        ...(refreshThrottled ? { refreshThrottled: true } : {}),
        pagination: {
          page,
          limit,
          totalDocs,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        cached: true,
        capped,
        // When this audit was built (absent for one hydrated from the build-time file).
        ...(typeof lookup.builtAt === 'number' && cached === lookup.data ? { builtAt: lookup.builtAt } : {}),
        // Out of date: content or settings changed since it was built.
        ...(stale ? { stale: true } : {}),
        // A newer audit is being built; poll again to get it.
        ...(refreshing ? { refreshing: true, ...progress } : {}),
      }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[seo] audit error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
