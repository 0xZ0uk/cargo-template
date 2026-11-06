import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  REDIRECT_CACHE_BASES,
  SeoCache,
  SeoSharedCache,
  defaultSeoSharedCache,
  seoCache,
  type SeoCacheStore,
} from '../cache.js'
import { FRONTEND_REDIRECTS_CACHE_BASE } from '../helpers/frontendRedirectsBase.js'
import { createAuditHandler } from '../endpoints/audit.js'
import { createSitemapAuditHandler } from '../endpoints/sitemap-audit.js'
import { createInvalidateCachesHook, invalidateForRequest } from '../hooks/invalidateSeoCaches.js'

/** In-memory stand-in for R2/KV. Shared between "isolates" the way a real store is. */
function fakeStore() {
  const data = new Map<string, string>()
  const store: SeoCacheStore & { data: Map<string, string> } = {
    data,
    get: vi.fn(async (k: string) => data.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => {
      data.set(k, v)
    }),
    delete: vi.fn(async (k: string) => {
      data.delete(k)
    }),
  }
  return store
}

/** One "isolate": its own memory, the shared store. */
function isolate(store: SeoCacheStore, opts: Partial<ConstructorParameters<typeof SeoSharedCache>[0]> = {}) {
  return new SeoSharedCache({ store, memory: new SeoCache(), ...opts })
}

describe('SeoSharedCache with a store — consistency across isolates', () => {
  it('serves a value written by another isolate', async () => {
    const store = fakeStore()
    const a = isolate(store)
    const b = isolate(store)
    await a.set('audit', 'audit:x', { n: 1 })
    expect(await b.get('audit', 'audit:x')).toEqual({ n: 1 })
  })

  it('an invalidation in one isolate is seen by every other one', async () => {
    const store = fakeStore()
    const a = isolate(store)
    const b = isolate(store)
    await a.set('audit', 'audit:fr:h', { n: 1 })
    await a.set('audit', 'audit:en:h', { n: 2 })
    await a.set('sitemap-audit', 'sitemap-audit:h', { n: 3 })

    await b.invalidate(['audit'])

    expect(await a.get('audit', 'audit:fr:h')).toBeNull()
    expect(await a.get('audit', 'audit:en:h')).toBeNull()
    // Other bases are untouched.
    expect(await a.get('sitemap-audit', 'sitemap-audit:h')).toEqual({ n: 3 })
  })

  it('a value computed before an invalidation is stored stale, not fresh', async () => {
    const store = fakeStore()
    const builder = isolate(store)
    const editor = isolate(store)

    const { gen } = await builder.lookup('audit', 'audit')
    await editor.invalidate(['audit']) // a save lands while the build runs
    await builder.set('audit', 'audit', { stale: true }, gen)

    expect(await builder.get('audit', 'audit')).toBeNull()
    expect(await editor.get('audit', 'audit')).toBeNull()
  })

  it('keeps the last finished audit and returns it, marked stale, to allowStale readers', async () => {
    const store = fakeStore()
    const builder = isolate(store)
    const editor = isolate(store)

    await builder.set('audit', 'audit', { n: 1 })
    expect(await builder.lookup('audit', 'audit', { allowStale: true })).toMatchObject({ data: { n: 1 } })
    expect((await builder.lookup('audit', 'audit', { allowStale: true })).stale).toBeUndefined()

    // A save elsewhere: plain readers miss, allowStale readers get the old value, flagged.
    await editor.invalidate(['audit'])
    expect(await builder.get('audit', 'audit')).toBeNull()
    const stale = await builder.lookup('audit', 'audit', { allowStale: true })
    expect(stale).toMatchObject({ data: { n: 1 }, stale: true })
    expect(typeof stale.builtAt).toBe('number')

    // A build that overlapped another save still lands, stale.
    const { gen } = await builder.lookup('audit', 'audit')
    await editor.invalidate(['audit'])
    await builder.set('audit', 'audit', { n: 2 }, gen)
    expect(await editor.lookup('audit', 'audit', { allowStale: true })).toMatchObject({ data: { n: 2 }, stale: true })

    // The next build with the current generation is fresh again.
    await builder.set('audit', 'audit', { n: 3 }, await builder.generation('audit'))
    const fresh = await editor.lookup('audit', 'audit', { allowStale: true })
    expect(fresh).toMatchObject({ data: { n: 3 } })
    expect(fresh.stale).toBeUndefined()
  })

  it('serves an expired audit as current (no save since), and never serves other bases past their TTL', async () => {
    vi.useFakeTimers()
    try {
      const store = fakeStore()
      const a = isolate(store, { ttlMs: 1000 })
      await a.set('audit', 'audit', 1)
      await a.set('sitemap-audit', 'sitemap-audit', 1)
      vi.advanceTimersByTime(1001)
      const expired = await a.lookup('audit', 'audit', { allowStale: true })
      expect(expired.data).toBe(1)
      expect(expired.stale).toBeUndefined()
      // Without allowStale an expired entry is still a miss.
      expect((await a.lookup('audit', 'audit')).data).toBeNull()
      expect((await a.lookup('sitemap-audit', 'sitemap-audit', { allowStale: true })).data).toBeNull()
      // A save after that marks it stale.
      await a.invalidate(['audit'])
      expect(await a.lookup('audit', 'audit', { allowStale: true })).toMatchObject({ data: 1, stale: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('invalidateKey drops one key everywhere and keeps the rest of the base', async () => {
    const store = fakeStore()
    const a = isolate(store)
    const b = isolate(store)
    await a.set('audit', 'audit:fr', 1)
    await a.set('audit', 'audit:en', 2)
    await b.invalidateKey('audit', 'audit:fr')
    expect(await a.get('audit', 'audit:fr')).toBeNull()
    expect(await a.get('audit', 'audit:en')).toBe(2)
  })

  it('expires entries after the TTL', async () => {
    vi.useFakeTimers()
    try {
      const store = fakeStore()
      const a = isolate(store, { ttlMs: 1000 })
      await a.set('audit', 'audit', 1)
      vi.advanceTimersByTime(1001)
      expect(await a.get('audit', 'audit')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps non-persistent bases in the per-isolate memory and off the store', async () => {
    const store = fakeStore()
    const a = isolate(store)
    const b = isolate(store)
    await a.set('link-graph', 'link-graph:fr', { nodes: [] })
    expect(await a.get('link-graph', 'link-graph:fr')).toEqual({ nodes: [] })
    expect(await b.get('link-graph', 'link-graph:fr')).toBeNull()
    expect([...store.data.keys()].some((k) => k.includes('link-graph'))).toBe(false)

    await a.invalidate(['link-graph'])
    expect(await a.get('link-graph', 'link-graph:fr')).toBeNull()
    expect(store.put).not.toHaveBeenCalled()
  })

  it('ignores corrupt entries', async () => {
    const store = fakeStore()
    store.data.set('entry/audit', '{not json')
    expect(await isolate(store).get('audit', 'audit')).toBeNull()
  })
})

describe('SeoSharedCache — build coordination', () => {
  it('only one isolate claims a build; the others see it running', async () => {
    const store = fakeStore()
    const a = isolate(store)
    const b = isolate(store)

    expect(await a.tryStartBuild('audit:h')).toBe(true)
    expect(await a.tryStartBuild('audit:h')).toBe(false)
    expect(await b.tryStartBuild('audit:h')).toBe(false)
    expect((await b.buildStatus('audit:h')).building).toBe(true)

    await a.finishBuild('audit:h')
    const status = await b.buildStatus('audit:h')
    expect(status.building).toBe(false)
    expect(status.lastBuildAt).toBeGreaterThan(0)
    expect(await b.tryStartBuild('audit:h')).toBe(true)
  })

  it('a dead build (marker older than the staleness timeout) can be taken over', async () => {
    vi.useFakeTimers()
    try {
      const store = fakeStore()
      const a = isolate(store, { buildStaleMs: 1000 })
      const b = isolate(store, { buildStaleMs: 1000 })
      expect(await a.tryStartBuild('k')).toBe(true) // its isolate then dies, never finishes
      expect(await b.tryStartBuild('k')).toBe(false)
      vi.advanceTimersByTime(1001)
      expect((await b.buildStatus('k')).building).toBe(false)
      expect(await b.tryStartBuild('k')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs background work through waitUntil when given', () => {
    const waitUntil = vi.fn()
    const cache = new SeoSharedCache({ waitUntil })
    const p = Promise.resolve()
    cache.runInBackground(p)
    expect(waitUntil).toHaveBeenCalledWith(p)
  })
})

describe('SeoSharedCache without a store', () => {
  afterEach(() => seoCache.invalidate())

  it('keeps the last finished audit across a save, and stores a build that overlapped a save as stale', async () => {
    const memory = new SeoCache()
    const cache = new SeoSharedCache({ memory })
    await cache.set('audit', 'audit', { n: 1 })
    expect(await cache.lookup('audit', 'audit', { allowStale: true })).toMatchObject({ data: { n: 1 } })

    const gen = await cache.generation('audit')
    await cache.invalidate(['audit'])
    expect(await cache.get('audit', 'audit')).toBeNull()
    expect(await cache.lookup('audit', 'audit', { allowStale: true })).toMatchObject({ data: { n: 1 }, stale: true })

    // Finished across the save: served (stale), not fresh.
    await cache.set('audit', 'audit', { n: 2 }, gen)
    expect(memory.get('audit')).toBeNull()
    expect(await cache.lookup('audit', 'audit', { allowStale: true })).toMatchObject({ data: { n: 2 }, stale: true })

    await cache.set('audit', 'audit', { n: 3 }, await cache.generation('audit'))
    const fresh = await cache.lookup('audit', 'audit', { allowStale: true })
    expect(fresh).toMatchObject({ data: { n: 3 } })
    expect(fresh.stale).toBeUndefined()

    // invalidateKey forgets it entirely.
    await cache.invalidateKey('audit', 'audit')
    expect((await cache.lookup('audit', 'audit', { allowStale: true })).data).toBeNull()
  })

  it('reads and writes the in-memory seoCache singleton with the same keys', async () => {
    seoCache.set('audit', { n: 1 })
    expect(await defaultSeoSharedCache.get('audit', 'audit')).toEqual({ n: 1 })
    await defaultSeoSharedCache.invalidate(['audit'])
    expect(seoCache.get('audit')).toBeNull()
  })
})

describe('invalidation hooks', () => {
  it('invalidate at most once per base per request', async () => {
    const store = fakeStore()
    const cache = isolate(store)
    const req = { context: {}, payload: { logger: { error: vi.fn() } } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await invalidateForRequest(cache, req as any, ['audit', 'sitemap-audit'])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await invalidateForRequest(cache, req as any, ['audit', 'redirect-chains'])
    const genWrites = (store.put as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(genWrites.sort()).toEqual(['gen/audit', 'gen/redirect-chains', 'gen/sitemap-audit'])
  })

  it('a redirect save or delete bumps the frontend redirects generation', async () => {
    const store = fakeStore()
    const hook = createInvalidateCachesHook(REDIRECT_CACHE_BASES, isolate(store))
    const key = `gen/${FRONTEND_REDIRECTS_CACHE_BASE}`
    // One hook serves afterChange and afterDelete; each hook call is its own request.
    const run = () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (hook as any)({ doc: { id: 1 }, req: { context: {}, payload: { logger: { error: vi.fn() } } } })

    expect(store.data.has(key)).toBe(false)
    await run()
    const afterSave = store.data.get(key)
    expect(afterSave).toBeTruthy()

    await run()
    expect(store.data.get(key)).not.toBe(afterSave)
  })

  it('log a store failure instead of failing the save', async () => {
    const store = fakeStore()
    store.put = vi.fn(async () => {
      throw new Error('R2 down')
    })
    const error = vi.fn()
    const hook = createInvalidateCachesHook(['audit'], isolate(store))
    const doc = { id: 1 }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (hook as any)({ doc, req: { context: {}, payload: { logger: { error } } } })
    expect(out).toBe(doc)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('R2 down'))
  })
})

// ---------------------------------------------------------------------------
// The dashboard audit across two isolates sharing a store
// ---------------------------------------------------------------------------
describe('audit endpoint with a cacheStore', () => {
  const staff = { id: 1, collection: 'users' }

  function makePayload(titles: string[]) {
    return {
      config: { admin: { user: 'users' } },
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
      find: vi.fn(async (args: { collection: string }) => {
        if (args.collection === 'pages') {
          return {
            docs: titles.map((title, i) => ({ id: i + 1, title, slug: `p-${i}`, _status: 'published' })),
            hasNextPage: false,
          }
        }
        return { docs: [], hasNextPage: false }
      }),
      findGlobal: vi.fn(async () => null),
    }
  }

  function call(
    handler: ReturnType<typeof createAuditHandler>,
    payload: ReturnType<typeof makePayload>,
    query = '',
  ) {
    return handler({
      user: staff,
      url: `http://localhost/api/seo-plugin/audit${query}`,
      payload,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
  }

  it('builds in the background via waitUntil and serves the result from another isolate', async () => {
    const store = fakeStore()
    const background: Promise<unknown>[] = []
    const waitUntil = (p: Promise<unknown>) => {
      background.push(p)
    }
    const a = isolate(store, { waitUntil })
    const b = isolate(store, { waitUntil })
    const payload = makePayload(['Home', 'About'])
    const handlerA = createAuditHandler(['pages'], undefined, [], undefined, a)
    const handlerB = createAuditHandler(['pages'], undefined, [], undefined, b)

    // First poll on isolate A: 202, build handed to waitUntil.
    const first = await call(handlerA, payload)
    expect(first.status).toBe(202)
    expect(background).toHaveLength(1)

    // A poll landing on isolate B while A builds: still 202, no second build.
    const during = await call(handlerB, payload)
    expect(during.status).toBe(202)
    expect(background).toHaveLength(1)

    await Promise.all(background)

    // Next poll lands on B, which never built anything: it gets A's result.
    const after = await call(handlerB, payload)
    expect(after.status).toBe(200)
    const body = (await after.json()) as { results: unknown[]; stats: { totalPages: number } }
    expect(body.results).toHaveLength(2)
    expect(body.stats.totalPages).toBe(2)
  })

  it('a save handled by one isolate invalidates the audit for all of them', async () => {
    const store = fakeStore()
    const background: Promise<unknown>[] = []
    const a = isolate(store, { waitUntil: (p) => background.push(p) })
    const b = isolate(store, { waitUntil: (p) => background.push(p) })
    const payload = makePayload(['Home'])
    const handlerA = createAuditHandler(['pages'], undefined, [], undefined, a)

    await call(handlerA, payload)
    await Promise.all(background)
    expect((await call(handlerA, payload)).status).toBe(200)

    // The afterChange hook runs on isolate B.
    const hook = createInvalidateCachesHook(['audit'], b)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (hook as any)({ doc: {}, req: { context: {}, payload } })

    // Isolate A serves the pre-save audit marked stale, and starts the rebuild.
    background.length = 0
    const res = await call(handlerA, payload)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: unknown[]; stale?: boolean; refreshing?: boolean; builtAt?: number }
    expect(body).toMatchObject({ stale: true, refreshing: true })
    expect(body.results).toHaveLength(1)
    expect(typeof body.builtAt).toBe('number')
    expect(background).toHaveLength(1)

    await Promise.all(background)
    const after = (await (await call(handlerA, payload)).json()) as { stale?: boolean; refreshing?: boolean }
    expect(after.stale).toBeUndefined()
    expect(after.refreshing).toBeUndefined()
  })

  it('a peek serves the stale audit without starting a build', async () => {
    const store = fakeStore()
    const background: Promise<unknown>[] = []
    const cache = isolate(store, { waitUntil: (p) => background.push(p) })
    const payload = makePayload(['Home'])
    const handler = createAuditHandler(['pages'], undefined, [], undefined, cache)
    await call(handler, payload)
    await Promise.all(background)
    background.length = 0

    await cache.invalidate(['audit'])
    const res = await call(handler, payload, '?noBuild=1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: unknown[]; stale?: boolean; refreshing?: boolean }
    expect(body.stale).toBe(true)
    expect(body.refreshing).toBeUndefined()
    expect(body.results).toHaveLength(1)
    expect(background).toHaveLength(0)
  })

  it('a manual refresh keeps serving the current audit while it rebuilds', async () => {
    const prev = process.env.SEO_AUDIT_MIN_REFRESH_MS
    process.env.SEO_AUDIT_MIN_REFRESH_MS = '0'
    try {
      const store = fakeStore()
      const background: Promise<unknown>[] = []
      const cache = isolate(store, { waitUntil: (p) => background.push(p) })
      const payload = makePayload(['Home'])
      const handler = createAuditHandler(['pages'], undefined, [], undefined, cache)
      await call(handler, payload)
      await Promise.all(background)
      background.length = 0

      const res = await call(handler, payload, '?nocache=1')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { results: unknown[]; stale?: boolean; refreshing?: boolean }
      expect(body).toMatchObject({ refreshing: true })
      expect(body.stale).toBeUndefined()
      expect(body.results).toHaveLength(1)
      expect(background).toHaveLength(1)
      await Promise.all(background)
      expect(((await (await call(handler, payload)).json()) as { refreshing?: boolean }).refreshing).toBeUndefined()
    } finally {
      if (prev === undefined) delete process.env.SEO_AUDIT_MIN_REFRESH_MS
      else process.env.SEO_AUDIT_MIN_REFRESH_MS = prev
    }
  })

  it('peek mode reports "not built" without starting a build', async () => {
    const store = fakeStore()
    const waitUntil = vi.fn()
    const handler = createAuditHandler(['pages'], undefined, [], undefined, isolate(store, { waitUntil }))
    const res = await call(handler, makePayload(['Home']), '?noBuild=1')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { notBuilt?: boolean }).notBuilt).toBe(true)
    expect(waitUntil).not.toHaveBeenCalled()
  })

  it('throttles manual refreshes using the persisted last-build time', async () => {
    const store = fakeStore()
    const background: Promise<unknown>[] = []
    const a = isolate(store, { waitUntil: (p) => background.push(p) })
    const b = isolate(store, { waitUntil: (p) => background.push(p) })
    const payload = makePayload(['Home'])
    await call(createAuditHandler(['pages'], undefined, [], undefined, a), payload)
    await Promise.all(background)

    // A refresh right after the build, on another isolate, is throttled.
    const res = await call(createAuditHandler(['pages'], undefined, [], undefined, b), payload, '?nocache=1')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { refreshThrottled?: boolean }).refreshThrottled).toBe(true)
  })

  it('scopes persisted entries by config hash', async () => {
    const store = fakeStore()
    const background: Promise<unknown>[] = []
    const cache = isolate(store, { waitUntil: (p) => background.push(p) })
    const payload = makePayload(['Home'])
    await call(createAuditHandler(['pages'], undefined, [], undefined, cache), payload)
    await Promise.all(background)

    // Same store, different config (e.g. after a deploy): not served the old audit.
    const other = createAuditHandler(['pages'], { siteName: 'Other' }, [], undefined, isolate(store))
    expect((await call(other, payload, '?noBuild=1')).status).toBe(200)
    const body = (await (await call(other, payload, '?noBuild=1')).json()) as { notBuilt?: boolean }
    expect(body.notBuilt).toBe(true)
  })
})

describe('sitemap-audit endpoint with a cacheStore', () => {
  it('serves the result computed by another isolate until a redirect change invalidates it', async () => {
    const store = fakeStore()
    const a = isolate(store)
    const b = isolate(store)
    const find = vi.fn(async (args: { collection: string }) => {
      if (args.collection === 'pages') {
        return { docs: [{ id: 1, slug: 'home', title: 'Home', _status: 'published' }], hasNextPage: false, totalDocs: 1 }
      }
      return { docs: [], hasNextPage: false, totalDocs: 0 }
    })
    const req = {
      user: { id: 1, collection: 'users' },
      url: 'http://localhost/api/seo-plugin/sitemap-audit',
      payload: { config: { admin: { user: 'users' } }, logger: { warn: vi.fn(), error: vi.fn() }, find },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r1 = await createSitemapAuditHandler(['pages'], 'seo-redirects', [], a)(req as any)
    expect(((await r1.json()) as { cached: boolean }).cached).toBe(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r2 = await createSitemapAuditHandler(['pages'], 'seo-redirects', [], b)(req as any)
    expect(((await r2.json()) as { cached: boolean }).cached).toBe(true)

    await a.invalidate(['sitemap-audit'])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r3 = await createSitemapAuditHandler(['pages'], 'seo-redirects', [], b)(req as any)
    expect(((await r3.json()) as { cached: boolean }).cached).toBe(false)
  })
})
