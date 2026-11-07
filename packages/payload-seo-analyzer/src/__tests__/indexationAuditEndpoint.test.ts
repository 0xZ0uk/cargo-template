import { afterEach, describe, expect, it, vi } from 'vitest'
import { SeoCache, SeoSharedCache, type SeoCacheStore } from '../cache.js'
import { createIndexationAuditHandler } from '../endpoints/indexationAudit.js'
import { technicalOnlyInput } from '../helpers/analyzeDocument.js'
import { buildSeoInputFromDoc } from '../helpers/seoInputFromDoc.js'
import { analyzeSeo } from '../index.js'

function fakeStore(): SeoCacheStore {
  const data = new Map<string, string>()
  return {
    get: async (k) => data.get(k) ?? null,
    put: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  }
}

const isolate = (store: SeoCacheStore) => new SeoSharedCache({ store, memory: new SeoCache() })

const richDoc = (i: number, extra: Record<string, unknown> = {}) => ({
  id: i,
  slug: `page-${i}`,
  title: `Page ${i}`,
  _status: 'published',
  meta: { title: `Page ${i}`, description: 'A description long enough to be a description.' },
  content: {
    root: {
      type: 'root',
      children: [
        { type: 'heading', tag: 'h2', children: [{ type: 'text', text: 'Heading' }] },
        { type: 'paragraph', children: [{ type: 'text', text: 'Some body text for the page. '.repeat(40) }] },
      ],
    },
  },
  ...extra,
})

function makeReq(docs: Record<string, unknown>[], query = '') {
  const find = vi.fn(async (args: { collection: string; page?: number }) => {
    if (args.collection !== 'pages') return { docs: [], hasNextPage: false }
    const page = args.page ?? 1
    const slice = docs.slice((page - 1) * 100, page * 100)
    return { docs: slice, hasNextPage: page * 100 < docs.length }
  })
  return {
    find,
    req: {
      user: { id: 1, collection: 'users' },
      url: `http://localhost/api/seo-plugin/indexation-audit${query}`,
      payload: {
        config: { admin: { user: 'users' } },
        logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
        find,
        findGlobal: vi.fn(async () => null),
      },
    },
  }
}

afterEach(() => {
  delete process.env.SEO_INDEXATION_MAX_DOCS
})

describe('indexation-audit', () => {
  it('the technical-only input yields the same technical checks as a full analysis', () => {
    const docs = [
      richDoc(1),
      richDoc(2, { meta: { robots: 'noindex, nofollow' } }),
      richDoc(3, { meta: { canonicalUrl: 'https://elsewhere.example/x' } }),
      richDoc(4, { slug: 'mentions-legales', meta: { robots: 'noindex' } }),
    ]
    for (const doc of docs) {
      const input = buildSeoInputFromDoc(doc, 'pages')
      const technical = (checks: ReturnType<typeof analyzeSeo>['checks']) =>
        checks.filter((c) => c.group === 'technical').map(({ id, status, message }) => ({ id, status, message }))
      const full = technical(analyzeSeo(input, { siteUrl: 'https://site.example' }).checks)
      const slim = technical(analyzeSeo(technicalOnlyInput(input), { siteUrl: 'https://site.example' }).checks)
      expect(slim).toEqual(full)
    }
  })

  it('reads documents at depth 0', async () => {
    const { req, find } = makeReq([richDoc(1)])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await createIndexationAuditHandler(['pages'])(req as any)
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ depth: 0 }))
  })

  it('caps the scan at SEO_INDEXATION_MAX_DOCS and says so', async () => {
    process.env.SEO_INDEXATION_MAX_DOCS = '150'
    const docs = Array.from({ length: 250 }, (_, i) => richDoc(i + 1))
    const { req } = makeReq(docs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await createIndexationAuditHandler(['pages'], undefined, [], isolate(fakeStore()))(req as any)
    const body = (await res.json()) as { summary: { totalDocs: number; capped: boolean; maxDocs: number } }
    expect(body.summary).toMatchObject({ totalDocs: 150, capped: true, maxDocs: 150 })
  })

  it('serves the stored result across isolates until content is invalidated', async () => {
    const store = fakeStore()
    const a = isolate(store)
    const b = isolate(store)
    const { req, find } = makeReq([richDoc(1, { meta: { robots: 'noindex' } })])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r1 = await createIndexationAuditHandler(['pages'], undefined, [], a)(req as any)
    expect(((await r1.json()) as { cached: boolean }).cached).toBe(false)
    const scans = find.mock.calls.length

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r2 = await createIndexationAuditHandler(['pages'], undefined, [], b)(req as any)
    const body2 = (await r2.json()) as { cached: boolean; summary: { noindexCount: number } }
    expect(body2.cached).toBe(true)
    expect(body2.summary.noindexCount).toBe(1)
    expect(find.mock.calls.length).toBe(scans)

    await a.invalidate(['indexation-audit'])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r3 = await createIndexationAuditHandler(['pages'], undefined, [], b)(req as any)
    expect(((await r3.json()) as { cached: boolean }).cached).toBe(false)
  })

  it('ignores ?nocache=1 from a non-admin panel user', async () => {
    const store = fakeStore()
    const cache = isolate(store)
    const first = makeReq([richDoc(1)])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await createIndexationAuditHandler(['pages'], undefined, [], cache)(first.req as any)
    const second = makeReq([richDoc(1)], '?nocache=1')
    second.req.user = { id: 2, collection: 'users', role: 'editor' } as typeof second.req.user
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await createIndexationAuditHandler(['pages'], undefined, [], cache)(second.req as any)
    expect(((await res.json()) as { cached: boolean }).cached).toBe(true)
  })

  it('does not serve a stored result built with other config or other extractors', async () => {
    const store = fakeStore()
    const run = async (seoConfig?: { siteUrl: string }, extractContent?: Record<string, () => object>) => {
      const { req } = makeReq([richDoc(1)])
      ;(req.payload.config as Record<string, unknown>).custom = { seoAnalyzer: { extractContent } }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await createIndexationAuditHandler(['pages'], seoConfig, [], isolate(store))(req as any)
      return { cached: ((await res.json()) as { cached: boolean }).cached }
    }
    expect((await run()).cached).toBe(false)
    expect((await run()).cached).toBe(true)
    // Another config, then another extractor: each is a miss, and a repeat of it a hit.
    expect((await run({ siteUrl: 'https://a.example' })).cached).toBe(false)
    expect((await run({ siteUrl: 'https://a.example' })).cached).toBe(true)
    expect((await run(undefined, { pages: () => ({}) })).cached).toBe(false)
    expect((await run(undefined, { pages: () => ({}) })).cached).toBe(true)
    expect((await run(undefined, { pages: () => ({ text: ['x'] }) })).cached).toBe(false)
  })
})
