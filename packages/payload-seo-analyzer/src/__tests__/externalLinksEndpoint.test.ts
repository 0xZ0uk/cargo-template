import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SeoCache, SeoSharedCache, type SeoCacheStore } from '../cache.js'
import { keyFor } from '../cacheKey.js'
import { createExternalLinksHandler, extractDocExternalLinks } from '../endpoints/externalLinks.js'
import type { HostResolver } from '../helpers/ssrfGuard.js'

const PUBLIC: HostResolver = async () => ['93.184.216.34']

function memoryStore(): SeoCacheStore & { keys: () => string[] } {
  const map = new Map<string, string>()
  return {
    get: async (k) => map.get(k) ?? null,
    put: async (k, v) => void map.set(k, v),
    delete: async (k) => void map.delete(k),
    keys: () => [...map.keys()],
  }
}

const link = (url: string) => ({ type: 'link', fields: { url }, children: [] })
const richText = (...urls: string[]) => ({ root: { type: 'root', children: [{ type: 'paragraph', children: urls.map(link) }] } })

/** `pages` docs, each carrying the given external links in its content. */
function fakePayload(pages: Array<{ slug: string; urls: string[] }>) {
  const docs = pages.map((p, i) => ({ id: i + 1, slug: p.slug, title: p.slug, content: richText(...p.urls) }))
  return {
    config: { admin: { user: 'users' } },
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    find: vi.fn(async (args: { collection: string; limit: number; page: number }) => {
      if (args.collection !== 'pages') return { docs: [], hasNextPage: false }
      const start = (args.page - 1) * args.limit
      return { docs: docs.slice(start, start + args.limit), hasNextPage: start + args.limit < docs.length }
    }),
    findGlobal: vi.fn(async () => null),
  }
}

function request(payload: unknown, body: unknown = {}, user: unknown = { id: 1, collection: 'users' }, query = '') {
  return {
    payload,
    user,
    method: 'POST',
    url: `http://localhost/api/seo-plugin/external-links${query}`,
    json: async () => body,
  } as never
}

function okFetch() {
  const calls: string[] = []
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push(`${init.method} ${String(input)}`)
    return new Response(null, { status: String(input).includes('/dead') ? 404 : 200 })
  }) as unknown as typeof fetch
  return { fn, calls }
}

const makeCache = () => new SeoSharedCache({ store: memoryStore(), memory: new SeoCache() })

beforeEach(() => {
  delete process.env.SEO_EXTERNAL_LINKS_MAX
  delete process.env.SEO_EXTERNAL_LINKS_MAX_SUBREQUESTS
})
afterEach(() => {
  delete process.env.SEO_EXTERNAL_LINKS_MAX
  delete process.env.SEO_EXTERNAL_LINKS_MAX_SUBREQUESTS
})

describe('external-links endpoint', () => {
  it('dedupes URLs (fragments dropped), lists every source page, and filters the own domain', async () => {
    const f = okFetch()
    const payload = fakePayload([
      { slug: 'a', urls: ['https://ext.example/x#one', 'https://mine.example/home', 'https://ext.example/dead'] },
      { slug: 'b', urls: ['https://ext.example/x#two', 'https://ext.example/x'] },
    ])
    const handler = createExternalLinksHandler(['pages'], [], { siteUrl: 'https://mine.example' } as never, makeCache(), {
      checker: { fetchImpl: f.fn, resolver: PUBLIC },
    })
    const body = await (await handler(request(payload))).json()
    expect(body.results.map((r: { url: string }) => r.url).sort()).toEqual(['https://ext.example/dead', 'https://ext.example/x'])
    const x = body.results.find((r: { url: string }) => r.url === 'https://ext.example/x')
    expect(x.sourcePages.map((s: { slug: string }) => s.slug)).toEqual(['a', 'b'])
    expect(body.stats).toEqual({ total: 2, ok: 1, broken: 1, timeout: 0, error: 0, blocked: 0, unverified: 0 })
    expect(body.results[0].ok).toBe(false) // broken first
    expect(body.capped).toBe(false)
    expect(body.partial).toBe(false)
    // HEAD /x, HEAD /dead + the GET retry of the 404.
    expect(f.calls).toEqual(['HEAD https://ext.example/x', 'HEAD https://ext.example/dead', 'GET https://ext.example/dead'])
  })

  it('caps the unique URLs at SEO_EXTERNAL_LINKS_MAX and says so', async () => {
    process.env.SEO_EXTERNAL_LINKS_MAX = '5'
    const f = okFetch()
    const urls = Array.from({ length: 12 }, (_, i) => `https://ext${i}.example/`)
    const handler = createExternalLinksHandler(['pages'], [], undefined, makeCache(), { checker: { fetchImpl: f.fn, resolver: PUBLIC } })
    const body = await (await handler(request(fakePayload([{ slug: 'a', urls }])))).json()
    expect(body.capped).toBe(true)
    expect(body.totalFound).toBe(12)
    expect(body.maxLinks).toBe(5)
    expect(body.results).toHaveLength(5)
    expect(body.results.map((r: { url: string }) => r.url).sort()).toEqual(urls.slice(0, 5))
    expect(f.calls).toHaveLength(5)
  })

  it('defaults to 100 links', async () => {
    const f = okFetch()
    const urls = Array.from({ length: 130 }, (_, i) => `https://ext${i}.example/`)
    const handler = createExternalLinksHandler(['pages'], [], undefined, makeCache(), { checker: { fetchImpl: f.fn, resolver: PUBLIC } })
    const body = await (await handler(request(fakePayload([{ slug: 'a', urls }])))).json()
    expect(body.maxLinks).toBe(100)
    expect(body.results).toHaveLength(100)
    expect(body.capped).toBe(true)
  })

  it('stops at the subrequest budget, answers partial, and the next call resumes from the saved checks', async () => {
    process.env.SEO_EXTERNAL_LINKS_MAX_SUBREQUESTS = '9'
    const f = okFetch()
    const urls = Array.from({ length: 10 }, (_, i) => `https://ext${i}.example/`)
    const cache = makeCache()
    // lookupCost 2 + HEAD = 3 subrequests per distinct host → 3 links per call.
    const handler = createExternalLinksHandler(['pages'], [], undefined, cache, {
      checker: { fetchImpl: f.fn, resolver: PUBLIC, lookupCost: 2, concurrency: 1 },
    })
    const payload = fakePayload([{ slug: 'a', urls }])

    const first = await (await handler(request(payload))).json()
    expect(first.partial).toBe(true)
    expect(first.stoppedBy).toBe('budget')
    expect(first.results).toHaveLength(3)
    expect(first.pending).toBe(7)
    expect(first.subrequests).toBeLessThanOrEqual(9)

    const second = await (await handler(request(payload))).json()
    expect(second.results).toHaveLength(6)
    expect(second.pending).toBe(4)
    // Nothing was checked twice.
    expect(new Set(f.calls).size).toBe(f.calls.length)

    await (await handler(request(payload))).json()
    const last = await (await handler(request(payload))).json()
    expect(last.partial).toBe(false)
    expect(last.pending).toBe(0)
    expect(last.results).toHaveLength(10)
    expect(f.calls).toHaveLength(10)
  })

  it('does not cache a partial answer, but caches a finished scan', async () => {
    const f = okFetch()
    const cache = makeCache()
    const payload = fakePayload([{ slug: 'a', urls: ['https://a.example/', 'https://b.example/'] }])
    process.env.SEO_EXTERNAL_LINKS_MAX_SUBREQUESTS = '3'
    const handler = createExternalLinksHandler(['pages'], [], undefined, cache, {
      checker: { fetchImpl: f.fn, resolver: PUBLIC, lookupCost: 2, concurrency: 1 },
    })
    // The key a persistent cache stores the scan under: scoped by the config it ran with.
    const key = await keyFor('external-links', request(payload), {
      cache,
      config: { collections: ['pages'], globals: [], seoConfig: null },
    })
    expect((await (await handler(request(payload))).json()).partial).toBe(true)
    expect((await cache.get('external-links', key)) ?? null).toBeNull()

    const second = await (await handler(request(payload))).json()
    expect(second.partial).toBe(false)
    expect(await cache.get('external-links', key)).not.toBeNull()

    const calls = f.calls.length
    const third = await (await handler(request(payload))).json()
    expect(third.cached).toBe(true)
    expect(f.calls).toHaveLength(calls)
  })

  it('a forced rescan that stops partway drops the older finished result so the next call continues it', async () => {
    const f = okFetch()
    const cache = makeCache()
    const payload = fakePayload([{ slug: 'a', urls: Array.from({ length: 6 }, (_, i) => `https://ext${i}.example/`) }])
    const make = (max: string) => {
      process.env.SEO_EXTERNAL_LINKS_MAX_SUBREQUESTS = max
      return createExternalLinksHandler(['pages'], [], undefined, cache, {
        checker: { fetchImpl: f.fn, resolver: PUBLIC, lookupCost: 2, concurrency: 1 },
      })
    }
    // A finished scan is cached…
    expect((await (await make('1000')(request(payload))).json()).partial).toBe(false)
    // …a rescan with a small budget stops partway…
    const forced = await (await make('9')(request(payload, { forceRefresh: true }))).json()
    expect(forced.partial).toBe(true)
    expect(forced.cached).toBe(false)
    // …and the follow-up continues it instead of serving the old result.
    const next = await (await make('9')(request(payload))).json()
    expect(next.cached).toBe(false)
    expect(next.results).toHaveLength(6)
    expect(next.partial).toBe(false)
  })

  it('stops starting links after stepMs', async () => {
    const f = okFetch()
    const urls = Array.from({ length: 20 }, (_, i) => `https://ext${i}.example/`)
    const slow = vi.fn(async (...a: Parameters<typeof fetch>) => {
      await new Promise((r) => setTimeout(r, 15))
      return f.fn(...a)
    }) as unknown as typeof fetch
    const handler = createExternalLinksHandler(['pages'], [], undefined, makeCache(), {
      stepMs: 40,
      checker: { fetchImpl: slow, resolver: PUBLIC, concurrency: 1 },
    })
    const body = await (await handler(request(fakePayload([{ slug: 'a', urls }])))).json()
    expect(body.partial).toBe(true)
    expect(body.stoppedBy).toBe('deadline')
    expect(body.results.length + body.pending).toBe(20)
  })

  it('forceRefresh rechecks everything, but only for SEO admins', async () => {
    const f = okFetch()
    const payload = fakePayload([{ slug: 'a', urls: ['https://a.example/'] }])
    const handler = createExternalLinksHandler(['pages'], [], undefined, makeCache(), { checker: { fetchImpl: f.fn, resolver: PUBLIC } })
    await handler(request(payload))
    expect(f.calls).toHaveLength(1)

    await handler(request(payload, { forceRefresh: true }))
    expect(f.calls).toHaveLength(2)

    // A panel user with a role that isn't admin gets the cache, not a recheck.
    const editor = { id: 2, collection: 'users', role: 'editor' }
    const cached = await (await handler(request(payload, { forceRefresh: true }, editor))).json()
    expect(cached.cached).toBe(true)
    expect(f.calls).toHaveLength(2)
  })

  it('rejects anonymous callers', async () => {
    const handler = createExternalLinksHandler(['pages'], [], undefined, makeCache())
    const res = await handler(request(fakePayload([]), {}, null))
    expect(res.status).toBe(401)
  })

  it('counts every link in exactly one bucket: blocked, dns, timeout and unverified included', async () => {
    const answers: Record<string, number> = { '/good': 200, '/gone': 404, '/limited': 429, '/linkedin': 999, '/boom': 503 }
    const fn = vi.fn(async (input: string | URL | Request) => {
      const u = new URL(String(input))
      if (u.pathname === '/slow') throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
      const status = answers[u.pathname] ?? 200
      // `new Response` rejects 999 (outside 200–599); a real network answer can carry it.
      return status > 599 ? ({ status, ok: false, headers: new Headers(), body: null } as unknown as Response) : new Response(null, { status })
    }) as unknown as typeof fetch
    const resolver: HostResolver = async (host) => {
      if (host === 'dead.example') throw Object.assign(new Error('x'), { code: 'ENOTFOUND' })
      if (host === 'internal.example') return ['10.0.0.7']
      return ['93.184.216.34']
    }
    const urls = [
      'https://ext.example/good',
      'https://ext.example/gone',
      'https://ext.example/boom',
      'https://ext.example/limited',
      'https://ext.example/linkedin',
      'https://ext.example/slow',
      'https://dead.example/',
      'https://internal.example/',
    ]
    const handler = createExternalLinksHandler(['pages'], [], undefined, makeCache(), { checker: { fetchImpl: fn, resolver } })
    const body = await (await handler(request(fakePayload([{ slug: 'a', urls }])))).json()

    expect(body.stats).toEqual({ total: 8, ok: 1, broken: 2, timeout: 1, error: 1, blocked: 1, unverified: 2 })
    const { ok, broken, timeout, error, blocked, unverified, total } = body.stats
    expect(ok + broken + timeout + error + blocked + unverified).toBe(total)
    const state = (path: string) => body.results.find((r: { url: string }) => r.url.endsWith(path)).state
    expect(state('/good')).toBe('ok')
    expect(state('/gone')).toBe('broken')
    expect(state('/boom')).toBe('broken')
    expect(state('/limited')).toBe('unverified')
    expect(state('/linkedin')).toBe('unverified')
    expect(state('/slow')).toBe('timeout')
    expect(state('dead.example/')).toBe('error')
    expect(state('internal.example/')).toBe('blocked')
    // Worst first, ok last.
    expect(body.results.at(-1).state).toBe('ok')
    expect(body.results.slice(0, 2).map((r: { state: string }) => r.state)).toEqual(['broken', 'broken'])
    // The 429 / 999 links are reported with their status, and are not `ok`.
    expect(body.results.find((r: { url: string }) => r.url.endsWith('/limited'))).toMatchObject({ status: 429, ok: false, state: 'unverified' })
  })

  it('never fetches links that resolve to private addresses', async () => {
    const f = okFetch()
    const handler = createExternalLinksHandler(['pages'], [], undefined, makeCache(), {
      checker: { fetchImpl: f.fn, resolver: async () => ['10.0.0.7'] },
    })
    const body = await (await handler(request(fakePayload([{ slug: 'a', urls: ['https://rebind.example/', 'http://169.254.169.254/'] }])))).json()
    expect(body.results.map((r: { error: string }) => r.error)).toEqual(['blocked-private-ip', 'blocked-private-ip'])
    expect(f.calls).toHaveLength(0)
  })
})

describe('extractDocExternalLinks', () => {
  it('reads hero, blocks, columns and content', () => {
    const doc = {
      hero: { richText: richText('https://h.example/') },
      layout: [{ richText: richText('https://b.example/') }, { columns: [{ richText: richText('https://c.example/') }] }],
      content: richText('https://p.example/'),
    }
    expect(extractDocExternalLinks(doc)).toEqual(['https://h.example/', 'https://b.example/', 'https://c.example/', 'https://p.example/'])
  })
})
