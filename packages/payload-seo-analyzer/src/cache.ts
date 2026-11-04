/**
 * Simple in-memory cache for SEO plugin endpoints.
 * Caches expensive computations (audit, sitemap-audit, link-graph, etc.)
 * with a configurable TTL. Cache is invalidated when documents are saved
 * (via the afterChange hook in the plugin).
 */

interface CacheEntry<T> {
  data: T
  timestamp: number
}

const DEFAULT_TTL = 15 * 60 * 1000 // 15 minutes
/** Hard cap on the number of cached entries to bound memory (LRU eviction beyond this). */
const DEFAULT_MAX_ENTRIES = 200

export class SeoCache {
  private store = new Map<string, CacheEntry<unknown>>()
  private ttl: number
  private maxEntries: number
  /**
   * Epoch ms of the last invalidation (document save, manual refresh…). Used by the
   * build-time file cache: a pre-computed `seo-audit-cache.json` may only be hydrated
   * if it was generated AFTER the last invalidation, otherwise it would serve stale
   * scores once content has changed.
   */
  private _lastInvalidatedAt = 0

  constructor(ttl = DEFAULT_TTL, maxEntries = DEFAULT_MAX_ENTRIES) {
    this.ttl = ttl
    this.maxEntries = maxEntries
  }

  /** Epoch ms of the last invalidation (0 if never invalidated since boot). */
  get lastInvalidatedAt(): number {
    return this._lastInvalidatedAt
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key)
    if (!entry) return null
    if (Date.now() - entry.timestamp > this.ttl) {
      this.store.delete(key)
      return null
    }
    // LRU: re-insert to mark this key as most-recently-used (Map keeps insertion order).
    this.store.delete(key)
    this.store.set(key, entry)
    return entry.data as T
  }

  set<T>(key: string, data: T): void {
    // Refresh recency if present, then (re)insert at the end.
    this.store.delete(key)
    this.store.set(key, { data, timestamp: Date.now() })
    // Evict least-recently-used entries (front of the Map) until within bounds.
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value
      if (oldest === undefined) break
      this.store.delete(oldest)
    }
  }

  /** Invalidate all cached entries (called after document save) */
  invalidate(): void {
    this.store.clear()
    this._lastInvalidatedAt = Date.now()
  }

  /** Invalidate a specific key */
  invalidateKey(key: string): void {
    this.store.delete(key)
    this._lastInvalidatedAt = Date.now()
  }

  /**
   * Invalidate every entry whose key matches `base` exactly or as a scoped
   * variant (`base:<locale>`, `base-<param>`). Needed because cache keys are
   * locale-scoped (e.g. `audit:fr`, `audit:en`) — a plain `invalidateKey('audit')`
   * would never match them. Deleting during Map iteration is safe.
   */
  invalidateByPrefix(base: string): void {
    for (const key of this.store.keys()) {
      if (key === base || key.startsWith(`${base}:`) || key.startsWith(`${base}-`)) {
        this.store.delete(key)
      }
    }
    this._lastInvalidatedAt = Date.now()
  }

  /** Get cache stats for debugging */
  stats(): { size: number; keys: string[] } {
    return { size: this.store.size, keys: Array.from(this.store.keys()) }
  }
}

// Singleton instance shared across all endpoints
export const seoCache = new SeoCache()

// ---------------------------------------------------------------------------
// Shared (cross-isolate) cache layer
// ---------------------------------------------------------------------------

/**
 * Minimal async key/value store the host can plug in (`cacheStore` plugin option) so the
 * caches the admin UI relies on survive across isolates/processes. Values are opaque
 * strings (JSON). Keys only use `[a-z0-9:/._-]`. Backed by R2 in `apps/web`; any KV-like
 * service fits. The plugin never imports a host SDK.
 */
export interface SeoCacheStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

/** Keeps a promise alive after the response is sent (Workers' `waitUntil`). */
export type SeoWaitUntil = (promise: Promise<unknown>) => void

/**
 * Cache bases persisted in the `cacheStore` when one is configured. These are the caches
 * the admin UI polls or re-reads across requests (dashboard audit, indexation audit,
 * sitemap audit, redirect chains, external links), so a per-isolate copy would show stale or missing data. Every other
 * base stays in the per-isolate in-memory cache (bounded by its TTL).
 */
export const PERSISTENT_CACHE_BASES = [
  'audit',
  'indexation-audit',
  'sitemap-audit',
  'redirect-chains',
  // The external-links result, and the per-URL checks it is built from (`external-link-checks`
  // is not in CONTENT_CACHE_BASES: a link's health doesn't change when a page is saved). A
  // scan on Workers takes several requests when links are slow, so the checks must outlive an isolate.
  'external-links',
  'external-link-checks',
] as const

/**
 * Caches derived from document content. Invalidated on every save/delete of a target
 * collection or global, and on every seo-settings change (settings change the scoring).
 */
export const CONTENT_CACHE_BASES = [
  'audit',
  'indexation-audit',
  'cannibalization',
  'keyword-research',
  'external-links',
  'link-graph',
  'sitemap-audit',
  'duplicate-content',
  // Corpus index behind /suggest-links — see endpoints/suggestLinks.ts.
  'suggest-links-index',
  // Rendered sitemap.xml — see endpoints/sitemap.ts. Public, anonymous and cached,
  // so a publish/unpublish must drop it or the new URL waits for the TTL.
  'sitemap-xml',
  // Same deal for the three extension sitemaps — see endpoints/sitemapExtensions.ts.
  // The news one especially: a freshly published article must appear without waiting.
  'sitemap-news',
  'sitemap-images',
  'sitemap-video',
] as const

/**
 * Bases whose last finished value is kept and served when it goes out of date, until the next
 * build replaces it. It's marked stale only when a save moved the generation; once just the
 * TTL has run out it is served as current, since nothing it depends on has changed. Only
 * the dashboard audit: it's built in the background over several requests, so without this a
 * site edited often would show "building" most of the time. The other scans compute inside
 * the request and always answer with their own result.
 */
export const STALE_SERVABLE_BASES = ['audit'] as const

/** In-memory mode: cap on kept last-good values (keys are per locale, so a handful in practice). */
const MAX_LAST_GOOD = 50

/** Caches that depend on the redirects collection. */
export const REDIRECT_CACHE_BASES = ['sitemap-audit', 'link-graph', 'redirect-chains'] as const

const STORE_FORMAT = 1

interface StoredEntry<T> {
  v: number
  gen: string
  builtAt: number
  data: T
}

interface BuildRecord {
  /** Epoch ms when the current build step started (absent when idle). */
  buildingSince?: number
  /** Epoch ms when the last build finished (success or failure). */
  lastBuildAt?: number
  /**
   * Epoch ms when a chunked build last paused with work left (absent when there is none).
   * The build counts as running until it finishes, or until it has made no progress for
   * `pendingStaleMs` (then it's abandoned and the next build starts over).
   */
  pausedAt?: number
  /** Docs processed so far by a paused build (shown while it runs). */
  processed?: number
}

export interface CacheLookup<T> {
  /** The cached value: current, or (only with `allowStale`) the last finished one, see `stale`. */
  data: T | null
  /** Generation token to pass back to `set()` (read BEFORE computing the value). */
  gen: string
  /** Epoch ms when `data` was built, when known. */
  builtAt?: number
  /**
   * `data` is out of date: a save moved the generation since it was built. Only with
   * `allowStale`; an entry past its TTL whose generation still matches is returned as current.
   */
  stale?: boolean
}

export interface BuildStatus {
  building: boolean
  lastBuildAt: number
  /** A chunked build paused between steps (also counted in `building`). */
  paused: boolean
  /** Docs processed so far by a paused build. */
  processed?: number
}

export interface SeoSharedCacheOptions {
  store?: SeoCacheStore
  waitUntil?: SeoWaitUntil
  /** TTL of persisted entries (default 15 min, same as the in-memory cache). */
  ttlMs?: number
  /**
   * A persisted "building" marker older than this is considered dead (its isolate was
   * evicted or its `waitUntil` budget ran out) and another build may start. Default:
   * 2 min with `waitUntil` (Workers give background work ~30 s after the response),
   * 15 min without. Env override: `SEO_AUDIT_BUILD_STALE_MS`.
   */
  buildStaleMs?: number
  /**
   * A paused chunked build with no new step for this long is abandoned (default 1 h).
   * Env override: `SEO_AUDIT_PAUSED_STALE_MS`.
   */
  pendingStaleMs?: number
  /** In-memory cache used for non-persistent bases and when no store is set. */
  memory?: SeoCache
}

function newGeneration(): string {
  return `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}`
}

function parseJson<T>(raw: string | null): T | null {
  if (raw == null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** FNV-1a (32-bit) of a JSON-serialisable value, base36. Used to scope persisted keys by config. */
export function hashConfig(value: unknown): string {
  const text = JSON.stringify(value) ?? ''
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * Cache layer used by the endpoints and hooks whose results the admin UI depends on.
 *
 * Without a store it is a thin async wrapper over the in-memory `seoCache` singleton
 * (today's behaviour: per-process cache, in-memory single-flight, `void` background work).
 *
 * With a store, for the bases in `PERSISTENT_CACHE_BASES`:
 * - Entries live at `entry/<key>` as `{ gen, builtAt, data }`.
 * - Each base has a generation at `gen/<base>`. Invalidating a base writes a new random
 *   generation; an entry is only served while its `gen` matches the current one and its
 *   TTL hasn't expired. Every isolate reads the generation from the store, so an
 *   invalidation in one isolate is seen by all of them (no per-isolate clock).
 * - Writers stamp entries with the generation read BEFORE computing, so a build that
 *   overlaps a save is stored already stale instead of masking the save.
 * - For `STALE_SERVABLE_BASES` (the audit), an out-of-date entry stays where it is and
 *   `lookup(..., { allowStale: true })` returns it with `stale: true`; the next build
 *   overwrites it. So the last finished audit is served while the next one builds, and a
 *   build that overlapped a save still lands (stale). The same `entry/<key>` object holds
 *   both, so there's nothing extra to store or expire. In-memory mode mirrors this with a
 *   local generation counter and a last-good map.
 * - There is deliberately no in-memory L1 for these bases: one parallel pair of store
 *   reads per request keeps every isolate consistent, and these are admin-only endpoints.
 * - Build coordination (audit): `build/<key>` holds `{ buildingSince, lastBuildAt, pausedAt }`.
 *   It is a best-effort cross-isolate single-flight (two isolates can race between the
 *   read and the write and both build — harmless, just duplicate work), with a staleness
 *   timeout so a build killed mid-way doesn't block forever.
 * - Chunked builds (audit on Workers): a step that runs out of budget saves its cursor and
 *   partial results at `progress/<key>` and pauses (`pausedAt`). The next step, from a poll
 *   or a scheduled job, claims the build again and resumes from there.
 */
export class SeoSharedCache {
  readonly persistent: boolean
  readonly hasWaitUntil: boolean
  private readonly store?: SeoCacheStore
  private readonly waitUntilFn?: SeoWaitUntil
  private readonly memory: SeoCache
  private readonly ttlMs: number
  private readonly buildStaleMs: number
  private readonly pendingStaleMs: number
  /** Builds started by THIS isolate/process (cheap first-line single-flight). */
  private readonly localBuilds = new Set<string>()
  /** In-memory mode only: last finished build per key (manual refresh throttle). */
  private readonly localLastBuild = new Map<string, number>()
  /** In-memory mode only: paused builds and their saved progress. */
  private readonly localPaused = new Map<string, { pausedAt: number; processed: number }>()
  private readonly localProgress = new Map<string, unknown>()
  /** In-memory mode: generation counter per base (bumped by `invalidate`), for `STALE_SERVABLE_BASES`. */
  private readonly localGen = new Map<string, number>()
  /** In-memory mode: last finished value per key of `STALE_SERVABLE_BASES`, kept across invalidations. */
  private readonly lastGood = new Map<string, { gen: string; builtAt: number; data: unknown }>()

  constructor(opts: SeoSharedCacheOptions = {}) {
    this.store = opts.store
    this.persistent = !!opts.store
    this.waitUntilFn = opts.waitUntil
    this.hasWaitUntil = !!opts.waitUntil
    this.memory = opts.memory ?? seoCache
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL
    const envStale = Number(process.env.SEO_AUDIT_BUILD_STALE_MS)
    this.buildStaleMs =
      opts.buildStaleMs ??
      (Number.isFinite(envStale) && envStale > 0
        ? envStale
        : opts.waitUntil
          ? 2 * 60_000
          : 15 * 60_000)
    const envPending = Number(process.env.SEO_AUDIT_PAUSED_STALE_MS)
    this.pendingStaleMs =
      opts.pendingStaleMs ?? (Number.isFinite(envPending) && envPending > 0 ? envPending : 60 * 60_000)
  }

  private storeFor(base: string): SeoCacheStore | undefined {
    return this.store && (PERSISTENT_CACHE_BASES as readonly string[]).includes(base) ? this.store : undefined
  }

  private isStaleServable(base: string): boolean {
    return (STALE_SERVABLE_BASES as readonly string[]).includes(base)
  }

  /** In-memory generation of a base: a local counter for `STALE_SERVABLE_BASES`, else ''. */
  private localGeneration(base: string): string {
    return this.isStaleServable(base) ? `m${this.localGen.get(base) ?? 0}` : ''
  }

  /** Current generation of a base ('' for other in-memory bases). */
  async generation(base: string): Promise<string> {
    const store = this.storeFor(base)
    if (!store) return this.localGeneration(base)
    return (await store.get(`gen/${base}`)) ?? '0'
  }

  /**
   * Read a cached value. With `allowStale` (only meaningful for `STALE_SERVABLE_BASES`), an
   * out-of-date value is returned too, with `stale: true`, instead of a miss.
   */
  async lookup<T>(base: string, key: string, opts: { allowStale?: boolean } = {}): Promise<CacheLookup<T>> {
    const allowStale = !!opts.allowStale && this.isStaleServable(base)
    const store = this.storeFor(base)
    if (!store) {
      const gen = this.localGeneration(base)
      const data = this.memory.get<T>(key)
      const good = allowStale ? this.lastGood.get(key) : undefined
      if (data != null) return { data, gen, ...(good?.data === data ? { builtAt: good.builtAt } : {}) }
      if (good) return { data: good.data as T, gen, builtAt: good.builtAt, ...(good.gen !== gen ? { stale: true } : {}) }
      return { data: null, gen }
    }
    const [genRaw, entryRaw] = await Promise.all([store.get(`gen/${base}`), store.get(`entry/${key}`)])
    const gen = genRaw ?? '0'
    const entry = parseJson<StoredEntry<T>>(entryRaw)
    if (!entry || entry.v !== STORE_FORMAT || typeof entry.builtAt !== 'number') return { data: null, gen }
    const stale = entry.gen !== gen
    if (!allowStale && (stale || Date.now() - entry.builtAt > this.ttlMs)) return { data: null, gen }
    return { data: entry.data, gen, builtAt: entry.builtAt, ...(stale ? { stale: true } : {}) }
  }

  async get<T>(base: string, key: string): Promise<T | null> {
    return (await this.lookup<T>(base, key)).data
  }

  /**
   * Store a value. `gen` should be the generation read before computing it (from
   * `lookup()`/`generation()`); omitted, the current generation is used.
   */
  async set<T>(base: string, key: string, data: T, gen?: string): Promise<void> {
    const store = this.storeFor(base)
    if (!store) {
      if (!this.isStaleServable(base)) {
        this.memory.set(key, data)
        return
      }
      const current = this.localGeneration(base)
      const stamped = gen ?? current
      // A value computed across an invalidation is kept as last-good (served stale), not fresh.
      if (stamped === current) this.memory.set(key, data)
      this.lastGood.delete(key)
      this.lastGood.set(key, { gen: stamped, builtAt: Date.now(), data })
      while (this.lastGood.size > MAX_LAST_GOOD) {
        const oldest = this.lastGood.keys().next().value
        if (oldest === undefined) break
        this.lastGood.delete(oldest)
      }
      return
    }
    // With a store, the entry is overwritten even when `gen` is already out of date: it is
    // then served stale (by `allowStale` readers) until the next build replaces it.
    const entry: StoredEntry<T> = {
      v: STORE_FORMAT,
      gen: gen ?? (await this.generation(base)),
      builtAt: Date.now(),
      data,
    }
    await store.put(`entry/${key}`, JSON.stringify(entry))
  }

  /** Invalidate every key of each base (all locales/variants), in every isolate for persistent bases. */
  async invalidate(bases: readonly string[]): Promise<void> {
    const writes: Promise<void>[] = []
    for (const base of new Set(bases)) {
      this.memory.invalidateByPrefix(base)
      if (this.isStaleServable(base)) this.localGen.set(base, (this.localGen.get(base) ?? 0) + 1)
      const store = this.storeFor(base)
      if (store) writes.push(store.put(`gen/${base}`, newGeneration()))
    }
    await Promise.all(writes)
  }

  /** Invalidate a single key. */
  async invalidateKey(base: string, key: string): Promise<void> {
    const store = this.storeFor(base)
    if (!store) {
      this.memory.invalidateKey(key)
      this.lastGood.delete(key)
      return
    }
    await store.delete(`entry/${key}`)
  }

  private async readBuild(key: string): Promise<BuildRecord> {
    return parseJson<BuildRecord>((await this.store?.get(`build/${key}`)) ?? null) ?? {}
  }

  private isFreshBuild(rec: BuildRecord): boolean {
    return typeof rec.buildingSince === 'number' && Date.now() - rec.buildingSince < this.buildStaleMs
  }

  private isFreshPause(pausedAt: number | undefined): boolean {
    return typeof pausedAt === 'number' && Date.now() - pausedAt < this.pendingStaleMs
  }

  async buildStatus(key: string): Promise<BuildStatus> {
    if (!this.store) {
      const pause = this.localPaused.get(key)
      const paused = this.isFreshPause(pause?.pausedAt)
      return {
        building: this.localBuilds.has(key) || paused,
        lastBuildAt: this.localLastBuild.get(key) ?? 0,
        paused,
        ...(paused ? { processed: pause!.processed } : {}),
      }
    }
    const rec = await this.readBuild(key)
    const paused = this.isFreshPause(rec.pausedAt)
    return {
      building: this.localBuilds.has(key) || this.isFreshBuild(rec) || paused,
      lastBuildAt: rec.lastBuildAt ?? 0,
      paused,
      ...(paused && typeof rec.processed === 'number' ? { processed: rec.processed } : {}),
    }
  }

  /**
   * Claim the next step of a build. Unlike `tryStartBuild`, a paused build doesn't block
   * the claim (resuming it is the point); only a step that is running right now does.
   * Returns the pause it resumes (`resumed: true`) so the caller knows whether saved
   * progress is still valid.
   */
  async tryStartBuildStep(key: string): Promise<{ claimed: boolean; resumed: boolean }> {
    if (this.localBuilds.has(key)) return { claimed: false, resumed: false }
    this.localBuilds.add(key)
    if (!this.store) {
      return { claimed: true, resumed: this.isFreshPause(this.localPaused.get(key)?.pausedAt) }
    }
    try {
      const rec = await this.readBuild(key)
      if (this.isFreshBuild(rec)) {
        this.localBuilds.delete(key)
        return { claimed: false, resumed: false }
      }
      const resumed = this.isFreshPause(rec.pausedAt)
      await this.store.put(
        `build/${key}`,
        JSON.stringify({
          buildingSince: Date.now(),
          lastBuildAt: rec.lastBuildAt,
          ...(resumed ? { pausedAt: rec.pausedAt, processed: rec.processed } : {}),
        } satisfies BuildRecord),
      )
      return { claimed: true, resumed }
    } catch (e) {
      this.localBuilds.delete(key)
      throw e
    }
  }

  /** Release a step's claim and mark the build paused with work left. Never throws. */
  async pauseBuild(key: string, processed: number): Promise<void> {
    this.localBuilds.delete(key)
    const now = Date.now()
    if (!this.store) {
      this.localPaused.set(key, { pausedAt: now, processed })
      return
    }
    try {
      const rec = await this.readBuild(key)
      await this.store.put(
        `build/${key}`,
        JSON.stringify({ lastBuildAt: rec.lastBuildAt, pausedAt: now, processed } satisfies BuildRecord),
      )
    } catch {
      // Without the pause marker the next request starts the build over.
    }
  }

  /** Saved progress of a paused build (any JSON value), or null. */
  async readProgress<T>(key: string): Promise<T | null> {
    if (!this.store) return (this.localProgress.get(key) as T | undefined) ?? null
    return parseJson<T>(await this.store.get(`progress/${key}`))
  }

  async writeProgress<T>(key: string, data: T): Promise<void> {
    if (!this.store) {
      this.localProgress.set(key, data)
      return
    }
    await this.store.put(`progress/${key}`, JSON.stringify(data))
  }

  /** Drop saved progress. Never throws. */
  async clearProgress(key: string): Promise<void> {
    this.localProgress.delete(key)
    try {
      await this.store?.delete(`progress/${key}`)
    } catch {
      // A leftover progress object is ignored once its build isn't paused any more.
    }
  }

  /** Claim the build for `key`. Returns false when a build is already running (here or, best-effort, elsewhere). */
  async tryStartBuild(key: string): Promise<boolean> {
    if (this.localBuilds.has(key)) return false
    this.localBuilds.add(key)
    if (!this.store) return true
    try {
      const rec = await this.readBuild(key)
      if (this.isFreshBuild(rec)) {
        this.localBuilds.delete(key)
        return false
      }
      await this.store.put(
        `build/${key}`,
        JSON.stringify({ buildingSince: Date.now(), lastBuildAt: rec.lastBuildAt } satisfies BuildRecord),
      )
      return true
    } catch (e) {
      this.localBuilds.delete(key)
      throw e
    }
  }

  /** Release the build claim and record its completion time. Never throws. */
  async finishBuild(key: string): Promise<void> {
    this.localBuilds.delete(key)
    const now = Date.now()
    if (!this.store) {
      this.localPaused.delete(key)
      this.localLastBuild.set(key, now)
      return
    }
    try {
      await this.store.put(`build/${key}`, JSON.stringify({ lastBuildAt: now } satisfies BuildRecord))
    } catch {
      // The marker goes stale on its own after `buildStaleMs`.
    }
  }

  /**
   * Run work after the response. Uses the host's `waitUntil` when given (required on
   * Workers, where un-awaited work is cancelled), else fire-and-forget (long-lived Node).
   * `task` must handle its own errors.
   */
  runInBackground(task: Promise<unknown>): void {
    if (this.waitUntilFn) this.waitUntilFn(task)
    else void task
  }
}

/** Default (in-memory) layer, used when handlers are created without an explicit cache. */
export const defaultSeoSharedCache = new SeoSharedCache()
