import { afterEach, describe, expect, it, vi } from 'vitest'
import { SeoCache, SeoSharedCache, type SeoCacheStore } from '../cache.js'
import { createCoreWebVitalsHandler } from '../endpoints/coreWebVitals.js'

function fakeStore(): SeoCacheStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    put: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  }
}

/** One "isolate": its own memory, the shared store. */
const isolate = (store: SeoCacheStore, opts: Partial<ConstructorParameters<typeof SeoSharedCache>[0]> = {}) =>
  new SeoSharedCache({ store, memory: new SeoCache(), ...opts })

const SITE = 'https://site.example'
const config = { siteUrl: SITE }

const psiResponse = () =>
  Response.json({
    loadingExperience: {
      metrics: {
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100 },
        INTERACTION_TO_NEXT_PAINT: { percentile: 150 },
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 },
      },
    },
    lighthouseResult: { audits: {} },
  })

function stubFetch() {
  const fetchMock = vi.fn(async () => psiResponse())
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function makeReq(query: string, user: Record<string, unknown> = { id: 1, collection: 'users', role: 'admin' }) {
  return {
    user,
    url: `http://localhost/api/seo-plugin/core-web-vitals?${query}`,
    payload: {
      config: { admin: { user: 'users' } },
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const ADMIN = { id: 1, collection: 'users', role: 'admin' }
const EDITOR = { id: 2, collection: 'users', role: 'editor' }
const urlQuery = (target: string, extra = '') => `url=${encodeURIComponent(target)}${extra}`

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('core-web-vitals — shared cache', () => {
  it('another isolate answers from the stored result without calling PSI', async () => {
    const fetchMock = stubFetch()
    const store = fakeStore()
    const q = urlQuery(`${SITE}/page`)

    const r1 = await createCoreWebVitalsHandler(config, isolate(store))(makeReq(q))
    const body1 = (await r1.json()) as { cached?: boolean; builtAt?: number }
    expect(body1.cached).toBeUndefined()
    expect(typeof body1.builtAt).toBe('number')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const r2 = await createCoreWebVitalsHandler(config, isolate(store))(makeReq(q))
    const body2 = (await r2.json()) as { cached?: boolean; builtAt?: number; metrics: unknown }
    expect(body2.cached).toBe(true)
    expect(body2.builtAt).toBe(body1.builtAt)
    expect(body2.metrics).toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports the builtAt it stored, even if the clock ticks between reads', async () => {
    stubFetch()
    const store = fakeStore()
    // Every clock read returns a later time, so two separate `Date.now()` calls can never agree.
    let now = 1_700_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => ++now)

    const res = await createCoreWebVitalsHandler(config, isolate(store))(makeReq(urlQuery(`${SITE}/page`)))
    const body = (await res.json()) as { builtAt?: number }

    const [entry] = [...store.data].filter(([k]) => k.startsWith('entry/')).map(([, v]) => JSON.parse(v) as { builtAt: number })
    expect(typeof body.builtAt).toBe('number')
    expect(body.builtAt).toBe(entry!.builtAt)
  })

  it('keeps strategies apart', async () => {
    const fetchMock = stubFetch()
    const cache = isolate(fakeStore())
    const handler = createCoreWebVitalsHandler(config, cache)
    await handler(makeReq(urlQuery(`${SITE}/page`, '&strategy=mobile')))
    await handler(makeReq(urlQuery(`${SITE}/page`, '&strategy=desktop')))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('nocache=1 from an SEO admin calls PSI again', async () => {
    const fetchMock = stubFetch()
    const store = fakeStore()
    const q = urlQuery(`${SITE}/page`)
    await createCoreWebVitalsHandler(config, isolate(store))(makeReq(q))
    await createCoreWebVitalsHandler(config, isolate(store))(makeReq(`${q}&nocache=1`, ADMIN))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('nocache=1 from a non-admin is served from the cache', async () => {
    const fetchMock = stubFetch()
    const store = fakeStore()
    const q = urlQuery(`${SITE}/page`)
    await createCoreWebVitalsHandler(config, isolate(store))(makeReq(q))
    const res = await createCoreWebVitalsHandler(config, isolate(store))(makeReq(`${q}&nocache=1`, EDITOR))
    expect(((await res.json()) as { cached?: boolean }).cached).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stores under a key within [a-z0-9:/._-] for a URL with a query string', async () => {
    stubFetch()
    const store = fakeStore()
    const target = `${SITE}/Page?Utm_Source=News Letter&q=é&x=a/b#Frag`
    await createCoreWebVitalsHandler(config, isolate(store))(makeReq(urlQuery(target)))
    const keys = [...store.data.keys()].filter((k) => k.startsWith('entry/'))
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(/^entry\/core-web-vitals:mobile:[0-9a-f]{64}$/)
    expect(keys[0]).toMatch(/^[a-z0-9:/._-]+$/)
  })

  it('does not collapse URLs that differ only in the query string', async () => {
    const fetchMock = stubFetch()
    const handler = createCoreWebVitalsHandler(config, isolate(fakeStore()))
    await handler(makeReq(urlQuery(`${SITE}/page?a=1`)))
    await handler(makeReq(urlQuery(`${SITE}/page?a=2`)))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('still works without a cacheStore (in-memory)', async () => {
    const fetchMock = stubFetch()
    const handler = createCoreWebVitalsHandler(config, new SeoSharedCache({ memory: new SeoCache() }))
    const q = urlQuery(`${SITE}/page`)
    await handler(makeReq(q))
    const res = await handler(makeReq(q))
    const body = (await res.json()) as { cached?: boolean; builtAt?: number }
    expect(body.cached).toBe(true)
    expect(body.builtAt).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('is not invalidated by content changes, and expires after 24 hours', async () => {
    vi.useFakeTimers()
    const fetchMock = stubFetch()
    const store = fakeStore()
    const q = urlQuery(`${SITE}/page`)
    await createCoreWebVitalsHandler(config, isolate(store))(makeReq(q))

    await isolate(store).invalidate(['audit', 'link-graph'])
    vi.setSystemTime(Date.now() + 23 * 60 * 60 * 1000)
    await createCoreWebVitalsHandler(config, isolate(store))(makeReq(q))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000)
    await createCoreWebVitalsHandler(config, isolate(store))(makeReq(q))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('SeoSharedCache — per-base TTL', () => {
  it('uses the base TTL, not the default one', async () => {
    vi.useFakeTimers()
    const store = fakeStore()
    const cache = isolate(store, { ttlMs: 1000, ttlMsByBase: { 'redirect-chains': 10_000 } })
    await cache.set('redirect-chains', 'redirect-chains:x', { n: 1 })
    await cache.set('sitemap-audit', 'sitemap-audit:x', { n: 2 })

    vi.setSystemTime(Date.now() + 5000)
    expect(await cache.get('redirect-chains', 'redirect-chains:x')).toEqual({ n: 1 })
    expect(await cache.get('sitemap-audit', 'sitemap-audit:x')).toBeNull()

    vi.setSystemTime(Date.now() + 6000)
    expect(await cache.get('redirect-chains', 'redirect-chains:x')).toBeNull()
  })

  it('keeps the 15 minute default for the other bases and 24 hours for core-web-vitals', async () => {
    vi.useFakeTimers()
    const cache = isolate(fakeStore())
    await cache.set('redirect-chains', 'redirect-chains:x', { n: 1 })
    await cache.set('core-web-vitals', 'core-web-vitals:mobile:x', { n: 2 })

    vi.setSystemTime(Date.now() + 16 * 60_000)
    expect(await cache.get('redirect-chains', 'redirect-chains:x')).toBeNull()
    expect(await cache.get('core-web-vitals', 'core-web-vitals:mobile:x')).toEqual({ n: 2 })

    vi.setSystemTime(Date.now() + 24 * 60 * 60_000)
    expect(await cache.get('core-web-vitals', 'core-web-vitals:mobile:x')).toBeNull()
  })
})
