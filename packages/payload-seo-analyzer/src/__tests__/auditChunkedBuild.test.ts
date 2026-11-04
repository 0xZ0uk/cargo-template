import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SeoCache, SeoSharedCache, type SeoCacheStore } from '../cache.js'
import { continuePausedAuditBuilds, createAuditHandler } from '../endpoints/audit.js'

const DOCS = Array.from({ length: 130 }, (_, i) => ({
  id: i + 1,
  slug: `page-${i + 1}`,
  title: `Page ${i + 1}`,
  _status: 'published',
  meta: { title: i % 2 ? `Page ${i + 1} title` : '', description: '' },
  content: {
    root: {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Some words here. '.repeat(10 + (i % 7)) }] }],
    },
  },
}))

function memoryStore(): SeoCacheStore & { keys: () => string[] } {
  const map = new Map<string, string>()
  return {
    get: async (k) => map.get(k) ?? null,
    put: async (k, v) => void map.set(k, v),
    delete: async (k) => void map.delete(k),
    keys: () => [...map.keys()],
  }
}

function fakePayload() {
  return {
    config: { admin: { user: 'users' } },
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    find: vi.fn(async (args: { collection: string; limit: number; page: number }) => {
      if (args.collection !== 'pages') return { docs: [], hasNextPage: false }
      const start = (args.page - 1) * args.limit
      return { docs: DOCS.slice(start, start + args.limit), hasNextPage: start + args.limit < DOCS.length }
    }),
    findGlobal: vi.fn(async () => null),
  }
}

type AuditBody = {
  building?: boolean
  processed?: number
  results: Array<{ id: number; score: number }>
  pagination?: { totalDocs: number }
}

const BUILD_KEY = (s: { store: { keys: () => string[] } }) =>
  s.store.keys().find((k) => k.startsWith('build/'))?.slice('build/'.length) ?? ''

function setup(opts: { chunked: boolean }) {
  const background: Promise<unknown>[] = []
  const store = memoryStore()
  const cache = new SeoSharedCache({
    memory: new SeoCache(),
    store,
    ...(opts.chunked ? { waitUntil: (p: Promise<unknown>) => void background.push(p) } : {}),
  })
  const payload = fakePayload()
  const handler = createAuditHandler(['pages'], {}, [], undefined, cache)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req = { user: { id: 1, collection: 'users' }, url: 'http://localhost/api/seo-plugin/audit?limit=500', payload } as any
  const call = async () => {
    const res = await handler(req)
    return { status: res.status, body: (await res.json()) as AuditBody }
  }
  const flush = async () => {
    while (background.length) await background.shift()
  }
  return { cache, store, payload, call, flush }
}

async function auditUntilDone(s: ReturnType<typeof setup>) {
  const seen: AuditBody[] = []
  for (let i = 0; i < 20; i++) {
    const { status, body } = await s.call()
    if (status === 200) return { body, seen }
    seen.push(body)
    await s.flush()
    // Without waitUntil the build is fire-and-forget (it yields after each doc); let it settle.
    for (let j = 0; j < 50 && (await s.cache.buildStatus(BUILD_KEY(s))).building; j++) {
      await new Promise((r) => setTimeout(r, 5))
    }
  }
  throw new Error('audit never finished')
}

async function auditUntilFresh(s: ReturnType<typeof setup>) {
  for (let i = 0; i < 20; i++) {
    const { status, body } = await s.call()
    if (status === 200 && !(body as { refreshing?: boolean }).refreshing) return { body }
    await s.flush()
    for (let j = 0; j < 50 && (await s.cache.buildStatus(BUILD_KEY(s))).building; j++) {
      await new Promise((r) => setTimeout(r, 5))
    }
  }
  throw new Error('audit never became current')
}

const ENV = {
  SEO_AUDIT_STEP_DOCS: '40',
  // The unchunked (Node) build pauses after each doc by default; not needed here.
  SEO_AUDIT_DOC_DELAY_MS: '0',
  SEO_AUDIT_BATCH_DELAY_MS: '0',
  SEO_AUDIT_THROTTLE_RATIO: '0',
}
beforeEach(() => {
  Object.assign(process.env, ENV)
})
afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k]
})

describe('chunked audit build', () => {
  it('builds in steps that resume from saved progress, with the same result as one pass', async () => {
    const chunked = setup({ chunked: true })
    const { body, seen } = await auditUntilDone(chunked)

    // Pages of 50 docs, budget 40 per step: 50, 100, then done at 130.
    expect(seen.map((b) => b.processed)).toEqual([undefined, 50, 100])
    expect(body.pagination?.totalDocs).toBe(130)
    expect(new Set(body.results.map((r) => r.id)).size).toBe(130)
    // Progress is dropped once the audit is stored.
    expect(chunked.store.keys().some((k) => k.startsWith('progress/'))).toBe(false)

    const single = setup({ chunked: false })
    const { body: singleBody, seen: singleSeen } = await auditUntilDone(single)
    expect(singleSeen).toHaveLength(1)
    const byId = (b: AuditBody) => [...b.results].sort((x, y) => x.id - y.id).map((r) => [r.id, r.score])
    expect(byId(body)).toEqual(byId(singleBody))
  })

  it('pages the collection in a stable order', async () => {
    const s = setup({ chunked: true })
    await auditUntilDone(s)
    const pageCalls = s.payload.find.mock.calls.filter(([a]) => a.collection === 'pages')
    expect(pageCalls.length).toBeGreaterThan(0)
    for (const [args] of pageCalls) expect(args).toMatchObject({ sort: 'id' })
  })

  it('lets a scheduled job finish a paused build nobody is polling', async () => {
    const s = setup({ chunked: true })
    expect((await s.call()).status).toBe(202)
    await s.flush()
    expect((await s.cache.buildStatus(s.store.keys().find((k) => k.startsWith('progress/'))!.slice('progress/'.length))).paused).toBe(true)

    const args = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: s.payload as any,
      collections: ['pages'],
      globals: [],
      seoConfig: {},
      cache: s.cache,
    }
    expect((await continuePausedAuditBuilds(args)).map((o) => o.outcome)).toEqual(['paused'])
    expect((await continuePausedAuditBuilds(args)).map((o) => o.outcome)).toEqual(['done'])
    // Nothing paused any more: the job does nothing (it never starts a build).
    expect(await continuePausedAuditBuilds(args)).toEqual([])

    const { status, body } = await s.call()
    expect(status).toBe(200)
    expect(body.pagination?.totalDocs).toBe(130)
  })

  it('serves a build that overlapped a save (marked stale) while the next one runs', async () => {
    const s = setup({ chunked: true })
    await s.call()
    await s.flush()
    // A save between two steps.
    await s.cache.invalidate(['audit'])
    let res = await s.call()
    for (let i = 0; i < 5 && res.status === 202; i++) {
      await s.flush()
      res = await s.call()
    }
    // The first build finished stamped with the old generation: it's served, stale, and the
    // request that found it started the next build.
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ stale: true, refreshing: true })
    expect(res.body.pagination?.totalDocs).toBe(130)

    // A save during that rebuild too: its result still replaces the shown one when it lands.
    const firstBuiltAt = (res.body as { builtAt?: number }).builtAt
    await s.flush() // first step of the rebuild (paused)
    await s.cache.invalidate(['audit'])
    for (let i = 0; i < 5; i++) {
      res = await s.call()
      await s.flush()
    }
    expect(res.status).toBe(200)
    expect((res.body as { builtAt?: number }).builtAt).toBeGreaterThanOrEqual(firstBuiltAt ?? 0)

    // Eventually a build with no save meanwhile is current again.
    for (let i = 0; i < 10 && (res.body as { stale?: boolean; refreshing?: boolean }).refreshing; i++) {
      await s.flush()
      res = await s.call()
    }
    expect(res.body).not.toHaveProperty('stale')
    expect(res.body).not.toHaveProperty('refreshing')
  })

  it('with no cacheStore at all (Node), a save serves the last audit stale while it rebuilds', async () => {
    const cache = new SeoSharedCache({ memory: new SeoCache() })
    const payload = fakePayload()
    const handler = createAuditHandler(['pages'], {}, [], undefined, cache)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = { user: { id: 1, collection: 'users' }, url: 'http://localhost/api/seo-plugin/audit?limit=500', payload } as any
    const call = async () => {
      const res = await handler(req)
      return { status: res.status, body: (await res.json()) as AuditBody & { stale?: boolean; refreshing?: boolean } }
    }
    const settle = async () => {
      for (let j = 0; j < 200 && (await cache.buildStatus('audit')).building; j++) {
        await new Promise((r) => setTimeout(r, 5))
      }
    }
    expect((await call()).status).toBe(202)
    await settle()
    expect((await call()).status).toBe(200)

    await cache.invalidate(['audit'])
    const during = await call()
    expect(during.status).toBe(200)
    expect(during.body).toMatchObject({ stale: true, refreshing: true })
    expect(during.body.pagination?.totalDocs).toBe(130)
    await settle()
    const after = await call()
    expect(after.body.stale).toBeUndefined()
    expect(after.body.refreshing).toBeUndefined()
  })

  it('without waitUntil (Node), a save serves the last audit stale while it rebuilds', async () => {
    const s = setup({ chunked: false })
    await auditUntilDone(s)
    await s.cache.invalidate(['audit'])
    const res = await s.call()
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ stale: true, refreshing: true })
    const { body } = await auditUntilFresh(s)
    expect(body.pagination?.totalDocs).toBe(130)
  })

  it('starts over when the saved progress belongs to an abandoned build', async () => {
    const s = setup({ chunked: true })
    await s.call()
    await s.flush()
    const key = s.store.keys().find((k) => k.startsWith('build/'))!.slice('build/'.length)
    // Age the pause past the default 1 h.
    const rec = JSON.parse((await s.store.get(`build/${key}`))!)
    await s.store.put(`build/${key}`, JSON.stringify({ ...rec, pausedAt: Date.now() - 2 * 60 * 60_000 }))
    expect((await s.cache.buildStatus(key)).building).toBe(false)

    s.payload.find.mockClear()
    await s.call()
    await s.flush()
    const first = s.payload.find.mock.calls.find(([a]) => a.collection === 'pages')
    expect(first?.[0]).toMatchObject({ page: 1 })
  })
})
