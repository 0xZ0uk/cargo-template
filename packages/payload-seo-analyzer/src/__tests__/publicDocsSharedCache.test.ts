import { afterEach, describe, expect, it, vi } from 'vitest'
import { SeoCache, SeoSharedCache, type SeoCacheStore } from '../cache.js'
import { createLlmsTxtHandler } from '../endpoints/llmsTxt.js'
import { createSitemapHandler } from '../endpoints/sitemap.js'
import {
  createImageSitemapHandler,
  createNewsSitemapHandler,
  createVideoSitemapHandler,
} from '../endpoints/sitemapExtensions.js'

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
const isolate = (store: SeoCacheStore) => new SeoSharedCache({ store, memory: new SeoCache() })

const KEY_CHARS = /^[a-z0-9:/._-]+$/

/** A corpus served by `payload.find`; `docs` can be swapped to simulate an edit. */
function makePayload(initial: Record<string, unknown>[]) {
  const state = { docs: initial }
  const find = vi.fn(async (args: Record<string, unknown>) => {
    if (args.collection === 'seo-settings') return { docs: [{ sitemap: {} }], hasNextPage: false }
    return { docs: state.docs, hasNextPage: false, totalDocs: state.docs.length }
  })
  return { state, find, config: {}, logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const req = (payload: unknown, url: string) => ({ payload, url }) as any

const SITE = 'https://site.example'
const config = { siteUrl: SITE }

const page = (slug: string, extra: Record<string, unknown> = {}) => ({ slug, _status: 'published', ...extra })

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('sitemap.xml with a cacheStore', () => {
  it('two isolates on one store build once', async () => {
    const store = fakeStore()
    const payload = makePayload([page('about')])
    const r = req(payload, 'http://localhost/api/seo-plugin/sitemap.xml')

    const first = await (await createSitemapHandler(['pages'], config, isolate(store))(r)).text()
    const callsAfterBuild = payload.find.mock.calls.length
    expect(callsAfterBuild).toBeGreaterThan(0)

    const second = await (await createSitemapHandler(['pages'], config, isolate(store))(r)).text()
    expect(second).toBe(first)
    expect(payload.find.mock.calls.length).toBe(callsAfterBuild)
  })

  it('an invalidation from one isolate makes the other rebuild', async () => {
    const store = fakeStore()
    const a = isolate(store)
    const b = isolate(store)
    const payload = makePayload([page('about')])
    const r = req(payload, 'http://localhost/api/seo-plugin/sitemap.xml')

    const first = await (await createSitemapHandler(['pages'], config, a)(r)).text()
    expect(first).not.toContain('/contact')
    const callsAfterBuild = payload.find.mock.calls.length

    // A publish: the content changes, then the afterChange hook of isolate A bumps the generation.
    payload.state.docs = [page('about'), page('contact')]
    await a.invalidate(['sitemap-xml'])

    const rebuilt = await (await createSitemapHandler(['pages'], config, b)(r)).text()
    expect(payload.find.mock.calls.length).toBeGreaterThan(callsAfterBuild)
    expect(rebuilt).toContain('/contact')

    // …and the rebuilt document is shared again.
    const callsAfterRebuild = payload.find.mock.calls.length
    expect(await (await createSitemapHandler(['pages'], config, a)(r)).text()).toBe(rebuilt)
    expect(payload.find.mock.calls.length).toBe(callsAfterRebuild)
  })

  it('a build that overlaps a save is stored stale, not served', async () => {
    const store = fakeStore()
    const a = isolate(store)
    const payload = makePayload([page('about')])
    const r = req(payload, 'http://localhost/api/seo-plugin/sitemap.xml')
    // The save lands while the build is reading documents.
    payload.find.mockImplementationOnce(async () => ({ docs: [{ sitemap: {} }], hasNextPage: false }))
    payload.find.mockImplementationOnce(async () => {
      await a.invalidate(['sitemap-xml'])
      return { docs: [page('about')], hasNextPage: false, totalDocs: 1 }
    })
    await createSitemapHandler(['pages'], config, a)(r)
    const callsAfterBuild = payload.find.mock.calls.length

    await createSitemapHandler(['pages'], config, isolate(store))(r)
    expect(payload.find.mock.calls.length).toBeGreaterThan(callsAfterBuild)
  })

  it('keeps every store key within [a-z0-9:/._-] for an uppercase or query-string origin', async () => {
    const store = fakeStore()
    const payload = makePayload([page('about')])
    // No configured siteUrl: the XML depends on the request origin.
    const handler = createSitemapHandler(['Pages', 'blog_posts'], undefined, isolate(store))

    vi.stubEnv('SITE_URL', '')
    const upper = await (await handler(req(payload, 'https://WWW.Example.COM:8443/api/x?Q=A&b=%C3%A9'))).text()
    const ipv6 = await (await handler(req(payload, 'http://[::1]:8787/api/seo-plugin/sitemap.xml'))).text()

    expect(store.data.size).toBeGreaterThan(0)
    for (const key of store.data.keys()) expect(key).toMatch(KEY_CHARS)
    // Different origins never share an entry.
    expect(upper).toContain('https://www.example.com:8443/about')
    expect(ipv6).toContain('http://[::1]:8787/about')
  })

  it('renders the same XML as without a cacheStore', async () => {
    const docs = [page('home'), page('about'), page('hidden', { noindex: true }), { slug: 'wip', _status: 'draft' }]
    const url = 'http://localhost/api/seo-plugin/sitemap.xml'
    const cached = await (await createSitemapHandler(['pages'], config, isolate(fakeStore()))(req(makePayload(docs), url))).text()
    const plain = await (
      await createSitemapHandler(['pages'], config, new SeoSharedCache({ memory: new SeoCache() }))(req(makePayload(docs), url))
    ).text()
    expect(cached).toBe(plain)
    expect(cached).toContain(`${SITE}/about`)
    expect(cached).not.toContain('hidden')
    expect(cached).not.toContain('wip')
  })

  it('still caches in memory when there is no cacheStore', async () => {
    const cache = new SeoSharedCache({ memory: new SeoCache() })
    const payload = makePayload([page('about')])
    const r = req(payload, 'http://localhost/api/seo-plugin/sitemap.xml')
    const handler = createSitemapHandler(['pages'], config, cache)
    await handler(r)
    const calls = payload.find.mock.calls.length
    await handler(r)
    expect(payload.find.mock.calls.length).toBe(calls)
  })
})

describe('extension sitemaps with a cacheStore', () => {
  const image = { mimeType: 'image/png', url: '/media/a.png' }
  const video = { mimeType: 'video/mp4', url: '/media/a.mp4' }
  const fresh = new Date().toISOString()
  const docs = [page('a', { title: 'A', publishedAt: fresh, meta: { image } }), page('b', { title: 'B', hero: video })]

  const cases = [
    ['sitemap-news', createNewsSitemapHandler, 'sitemap-news.xml', '/a'],
    ['sitemap-images', createImageSitemapHandler, 'sitemap-images.xml', '/media/a.png'],
    ['sitemap-video', createVideoSitemapHandler, 'sitemap-video.xml', '/media/a.mp4'],
  ] as const

  for (const [base, create, file, needle] of cases) {
    it(`${base}: two isolates build once, an invalidation rebuilds, keys stay valid`, async () => {
      const store = fakeStore()
      const a = isolate(store)
      const b = isolate(store)
      const payload = makePayload(docs)
      const r = req(payload, `http://localhost/api/seo-plugin/${file}`)

      const first = await (await create(['pages'], config, a)(r)).text()
      expect(first).toContain(needle)
      const calls = payload.find.mock.calls.length
      expect(await (await create(['pages'], config, b)(r)).text()).toBe(first)
      expect(payload.find.mock.calls.length).toBe(calls)

      await a.invalidate([base])
      await create(['pages'], config, b)(r)
      expect(payload.find.mock.calls.length).toBeGreaterThan(calls)

      for (const key of store.data.keys()) expect(key).toMatch(KEY_CHARS)
      expect([...store.data.keys()].some((k) => k.startsWith(`entry/${base}:`))).toBe(true)
    })

    it(`${base}: a different site URL does not reuse the entry`, async () => {
      const store = fakeStore()
      const payload = makePayload(docs)
      const r = req(payload, `http://localhost/api/seo-plugin/${file}`)
      await create(['pages'], { siteUrl: 'https://one.example' }, isolate(store))(r)
      const calls = payload.find.mock.calls.length
      const other = await (await create(['pages'], { siteUrl: 'https://two.example' }, isolate(store))(r)).text()
      expect(payload.find.mock.calls.length).toBeGreaterThan(calls)
      expect(other).not.toContain('one.example')
    })
  }
})

describe('llms.txt with a cacheStore', () => {
  const docs = [page('about', { title: 'About us' }), page('secret', { title: 'Secret', noindex: true })]
  const url = 'http://localhost/api/seo-plugin/llms.txt'

  it('two isolates build once, an invalidation rebuilds, output is unchanged', async () => {
    vi.stubEnv('SEO_LLMS_TXT', '1')
    const store = fakeStore()
    const a = isolate(store)
    const b = isolate(store)
    const payload = makePayload(docs)
    const r = req(payload, url)

    const first = await (await createLlmsTxtHandler(['pages'], config, a)(r)).text()
    expect(first).toContain(`- [About us](${SITE}/about)`)
    expect(first).not.toContain('Secret')
    const calls = payload.find.mock.calls.length

    const res = await createLlmsTxtHandler(['pages'], config, b)(r)
    expect(await res.text()).toBe(first)
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(payload.find.mock.calls.length).toBe(calls)

    payload.state.docs = [...docs, page('pricing', { title: 'Pricing' })]
    await a.invalidate(['llms-txt'])
    expect(await (await createLlmsTxtHandler(['pages'], config, b)(r)).text()).toContain('Pricing')
    expect(payload.find.mock.calls.length).toBeGreaterThan(calls)
  })

  it('keeps keys valid for an uppercase origin and matches the uncached output', async () => {
    vi.stubEnv('SEO_LLMS_TXT', '1')
    vi.stubEnv('SITE_URL', '')
    const store = fakeStore()
    const hostile = 'https://WWW.Example.COM/api/seo-plugin/llms.txt?X=Y'
    const cached = await (await createLlmsTxtHandler(['pages'], undefined, isolate(store))(req(makePayload(docs), hostile))).text()
    const plain = await (
      await createLlmsTxtHandler(['pages'], undefined, new SeoSharedCache({ memory: new SeoCache() }))(req(makePayload(docs), hostile))
    ).text()
    expect(cached).toBe(plain)
    expect(store.data.size).toBeGreaterThan(0)
    for (const key of store.data.keys()) expect(key).toMatch(KEY_CHARS)
  })

  it('stays disabled (404, nothing cached) unless SEO_LLMS_TXT=1', async () => {
    vi.stubEnv('SEO_LLMS_TXT', '')
    const store = fakeStore()
    const payload = makePayload(docs)
    const res = await createLlmsTxtHandler(['pages'], config, isolate(store))(req(payload, url))
    expect(res.status).toBe(404)
    expect(payload.find).not.toHaveBeenCalled()
    expect(store.data.size).toBe(0)
  })
})

describe('public documents survive a failing cacheStore, and are keyed by config', () => {
  const docs = [page('about', { title: 'About us', publishedAt: new Date().toISOString() })]

  const handlers = [
    ['sitemap.xml', (cache: SeoSharedCache, cfg: object) => createSitemapHandler(['pages'], cfg, cache), 'sitemap.xml', '/about'],
    ['sitemap-news', (cache: SeoSharedCache, cfg: object) => createNewsSitemapHandler(['pages'], cfg, cache), 'sitemap-news.xml', '/about'],
    ['sitemap-images', (cache: SeoSharedCache, cfg: object) => createImageSitemapHandler(['pages'], cfg, cache), 'sitemap-images.xml', '<urlset'],
    ['sitemap-video', (cache: SeoSharedCache, cfg: object) => createVideoSitemapHandler(['pages'], cfg, cache), 'sitemap-video.xml', '<urlset'],
    ['llms.txt', (cache: SeoSharedCache, cfg: object) => createLlmsTxtHandler(['pages'], cfg, cache), 'llms.txt', '/about'],
  ] as const

  for (const [name, create, file, needle] of handlers) {
    describe(name, () => {
      const url = `http://localhost/api/seo-plugin/${file}`

      it('a failing store read is a cache miss: built and served with 200', async () => {
        vi.stubEnv('SEO_LLMS_TXT', '1')
        const store = fakeStore()
        store.get = async () => {
          throw new Error('r2 read down')
        }
        const payload = makePayload(docs)
        const res = await create(isolate(store), config)(req(payload, url))
        expect(res.status).toBe(200)
        expect(await res.text()).toContain(needle)
        expect(payload.find).toHaveBeenCalled()
        expect(payload.logger.warn).toHaveBeenCalledWith(expect.stringContaining('cache read failed'))
        expect(payload.logger.error).not.toHaveBeenCalled()
      })

      it('a failing store write is logged and the built document is still returned with 200', async () => {
        vi.stubEnv('SEO_LLMS_TXT', '1')
        const store = fakeStore()
        store.put = async () => {
          throw new Error('r2 write down')
        }
        const payload = makePayload(docs)
        const res = await create(isolate(store), config)(req(payload, url))
        expect(res.status).toBe(200)
        expect(await res.text()).toContain(needle)
        expect(payload.logger.warn).toHaveBeenCalledWith(expect.stringContaining('cache write failed'))
        expect(payload.logger.error).not.toHaveBeenCalled()
      })

      it('a changed siteName / collectionRoutes rebuilds instead of reusing the persisted entry', async () => {
        vi.stubEnv('SEO_LLMS_TXT', '1')
        const store = fakeStore()
        const payload = makePayload(docs)
        const r = req(payload, url)
        const base = { siteUrl: SITE, siteName: 'One' }
        await create(isolate(store), base)(r)
        const keys = [...store.data.keys()].filter((k) => k.startsWith('entry/'))
        expect(keys).toHaveLength(1)

        // Same config on a fresh isolate: reused.
        const calls = payload.find.mock.calls.length
        await create(isolate(store), base)(r)
        expect(payload.find.mock.calls.length).toBe(calls)

        // Changed config: a new key and a rebuild.
        await create(isolate(store), { ...base, siteName: 'Two' })(r)
        expect(payload.find.mock.calls.length).toBeGreaterThan(calls)
        const afterName = [...store.data.keys()].filter((k) => k.startsWith('entry/'))
        expect(afterName).toHaveLength(2)

        const callsAfterName = payload.find.mock.calls.length
        await create(isolate(store), { ...base, collectionRoutes: { pages: '/p' } })(r)
        expect(payload.find.mock.calls.length).toBeGreaterThan(callsAfterName)
        const all = [...store.data.keys()].filter((k) => k.startsWith('entry/'))
        expect(new Set(all).size).toBe(3)
        for (const key of all) expect(key).toMatch(KEY_CHARS)
      })
    })
  }
})
