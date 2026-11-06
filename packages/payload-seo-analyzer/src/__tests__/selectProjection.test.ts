/**
 * sitemap.xml and llms.txt load only the fields they read (a `select` projection),
 * not whole documents — Lexical trees and layout blocks stay in the database.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { seoCache } from '../cache.js'
import { buildSelect } from '../helpers/buildSelect.js'
import { fetchAllDocs } from '../helpers/fetchAllDocs.js'
import { createLlmsTxtHandler, LLMS_TXT_CACHE_BASE } from '../endpoints/llmsTxt.js'
import { createSitemapHandler, SITEMAP_XML_CACHE_BASE } from '../endpoints/sitemap.js'

type Doc = Record<string, unknown>

/** Flattened fields of a Pages-like collection: no `noindex`, no `meta.noindex`. */
const pagesFields = [
  { name: 'title' },
  { name: 'slug' },
  { name: 'updatedAt' },
  { name: '_status' },
  { name: 'layout' },
  { name: 'meta', flattenedFields: [{ name: 'title' }, { name: 'description' }] },
]
/** Same, plus the editor-facing flags from #57. */
const postsFields = [
  ...pagesFields.filter((f) => f.name !== 'meta'),
  { name: 'noindex' },
  {
    name: 'meta',
    flattenedFields: [{ name: 'title' }, { name: 'description' }, { name: 'noindex' }],
  },
]

const collections = {
  pages: { config: { flattenedFields: pagesFields } },
  posts: { config: { flattenedFields: postsFields } },
}

/** Apply an include-mode select the way Payload does: unknown keys are ignored. */
function project(doc: Doc, select: Record<string, unknown>): Doc {
  const out: Doc = {}
  for (const [key, value] of Object.entries(select)) {
    if (!(key in doc)) continue
    out[key] =
      value === true
        ? doc[key]
        : project(doc[key] as Doc, value as Record<string, unknown>)
  }
  return out
}

function makePayload(docsBySlug: Record<string, Doc[]>, { projecting = true } = {}) {
  return {
    collections,
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    find: vi.fn(async (args: Record<string, unknown>) => {
      if (args.collection === 'seo-settings') return { docs: [{ sitemap: {} }], hasNextPage: false }
      const docs = docsBySlug[args.collection as string] ?? []
      const select = args.select as Record<string, unknown> | undefined
      return {
        docs: projecting && select ? docs.map((d) => project(d, select)) : docs,
        hasNextPage: false,
      }
    }),
  }
}

const LAYOUT = [{ blockType: 'richText', content: { root: { children: ['x'.repeat(50)] } } }]

const pages: Doc[] = [
  {
    id: 1,
    slug: 'home',
    title: 'Home',
    _status: 'published',
    updatedAt: '2026-03-01T10:00:00.000Z',
    layout: LAYOUT,
    meta: { title: 'Welcome', description: 'The front door' },
  },
  {
    id: 2,
    slug: 'about',
    title: 'About us',
    _status: 'published',
    updatedAt: '2026-02-01T10:00:00.000Z',
    layout: LAYOUT,
    meta: {},
  },
  { id: 3, slug: 'wip', title: 'WIP', _status: 'draft', updatedAt: '2026-01-01T10:00:00.000Z' },
]
const posts: Doc[] = [
  {
    id: 4,
    slug: 'hello',
    title: 'Hello',
    _status: 'published',
    updatedAt: '2026-04-01T10:00:00.000Z',
    layout: LAYOUT,
    meta: { description: 'First post' },
  },
  {
    id: 5,
    slug: 'secret',
    title: 'Secret',
    _status: 'published',
    updatedAt: '2026-04-02T10:00:00.000Z',
    noindex: true,
  },
  {
    id: 6,
    slug: 'hidden',
    title: 'Hidden',
    _status: 'published',
    updatedAt: '2026-04-03T10:00:00.000Z',
    meta: { noindex: true },
  },
]

describe('buildSelect', () => {
  it('keeps only paths a collection has and nests dotted paths', () => {
    const payload = makePayload({})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const select = buildSelect(payload as any, ['pages'], [
      'slug',
      'noindex',
      'meta.noindex',
      'meta.title',
    ])
    expect(select).toEqual({ slug: true, meta: { title: true } })
  })

  it('keeps a path when any of several collections has it', () => {
    const payload = makePayload({})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const select = buildSelect(payload as any, ['pages', 'posts'], ['noindex', 'meta.noindex'])
    expect(select).toEqual({ noindex: true, meta: { noindex: true } })
  })

  it('keeps every path when the collection config is not reachable', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const select = buildSelect({} as any, ['ghost'], ['slug', 'meta.noindex'])
    expect(select).toEqual({ slug: true, meta: { noindex: true } })
  })

  it('returns a fresh object each call (Payload mutates the select it receives)', () => {
    const payload = makePayload({})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = buildSelect(payload as any, ['pages'], ['slug', 'meta.title'])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = buildSelect(payload as any, ['pages'], ['slug', 'meta.title'])
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})

describe('sitemap.xml projection', () => {
  afterEach(() => {
    seoCache.invalidateByPrefix(SITEMAP_XML_CACHE_BASE)
  })
  const reqFor = (payload: unknown) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ payload, url: 'http://localhost/api/seo-plugin/sitemap.xml' }) as any

  it('selects exactly the fields the sitemap reads, only those the collections have', async () => {
    const payload = makePayload({ pages, posts })
    await createSitemapHandler(['pages', 'posts'])(reqFor(payload))
    const call = payload.find.mock.calls.find((c) => c[0].collection === 'pages')
    expect(call?.[0].select).toEqual({
      slug: true,
      updatedAt: true,
      _status: true,
      noindex: true,
      meta: { noindex: true },
    })
    expect(call?.[0].depth).toBe(0)
  })

  it('works on a collection without noindex and does not hit the select-less retry', async () => {
    const payload = makePayload({ pages })
    const res = await createSitemapHandler(['pages'])(reqFor(payload))
    expect(res.status).toBe(200)

    const pageCalls = payload.find.mock.calls.filter((c) => c[0].collection === 'pages')
    expect(pageCalls).toHaveLength(1)
    expect(pageCalls[0][0].select).toEqual({
      slug: true,
      updatedAt: true,
      _status: true,
    })
    expect(payload.logger.warn).not.toHaveBeenCalled()
  })

  it('renders the same XML as with whole documents', async () => {
    const whole = makePayload({ pages, posts }, { projecting: false })
    const projected = makePayload({ pages, posts })
    const handler = createSitemapHandler(['pages', 'posts'])

    const expected = await (await handler(reqFor(whole))).text()
    seoCache.invalidateByPrefix(SITEMAP_XML_CACHE_BASE)
    const actual = await (await handler(reqFor(projected))).text()

    expect(actual).toBe(expected)
    expect(actual).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <url>',
        '    <loc>http://localhost</loc>',
        '    <lastmod>2026-03-01</lastmod>',
        '    <changefreq>weekly</changefreq>',
        '    <priority>1.0</priority>',
        '  </url>',
        '  <url>',
        '    <loc>http://localhost/about</loc>',
        '    <lastmod>2026-02-01</lastmod>',
        '    <changefreq>monthly</changefreq>',
        '    <priority>0.8</priority>',
        '  </url>',
        '  <url>',
        '    <loc>http://localhost/posts/hello</loc>',
        '    <lastmod>2026-04-01</lastmod>',
        '    <changefreq>weekly</changefreq>',
        '    <priority>0.7</priority>',
        '  </url>',
        '</urlset>',
      ].join('\n'),
    )
  })
})

describe('llms.txt projection', () => {
  const prev = process.env.SEO_LLMS_TXT
  afterEach(() => {
    // llms.txt is cached now: start every case cold so each one really builds.
    seoCache.invalidateByPrefix(LLMS_TXT_CACHE_BASE)
    if (prev === undefined) delete process.env.SEO_LLMS_TXT
    else process.env.SEO_LLMS_TXT = prev
  })
  const reqFor = (payload: unknown) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ payload, url: 'http://localhost/api/seo-plugin/llms.txt' }) as any

  it('selects exactly the fields the entries read, only those the collections have', async () => {
    process.env.SEO_LLMS_TXT = '1'
    const payload = makePayload({ pages, posts })
    await createLlmsTxtHandler(['pages', 'posts'])(reqFor(payload))
    const call = payload.find.mock.calls.find((c) => c[0].collection === 'posts')
    expect(call?.[0].select).toEqual({
      slug: true,
      _status: true,
      noindex: true,
      title: true,
      meta: { title: true, description: true, noindex: true },
    })
  })

  it('works on a collection without noindex and does not hit the select-less retry', async () => {
    process.env.SEO_LLMS_TXT = '1'
    const payload = makePayload({ pages })
    const res = await createLlmsTxtHandler(['pages'])(reqFor(payload))
    expect(res.status).toBe(200)
    expect(payload.find).toHaveBeenCalledTimes(1)
    expect(payload.find.mock.calls[0][0].select).toEqual({
      slug: true,
      _status: true,
      title: true,
      meta: { title: true, description: true },
    })
    expect(payload.logger.warn).not.toHaveBeenCalled()
  })

  it('renders the same llms.txt as with whole documents', async () => {
    process.env.SEO_LLMS_TXT = '1'
    const handler = createLlmsTxtHandler(['pages', 'posts'])
    const expected = await (
      await handler(reqFor(makePayload({ pages, posts }, { projecting: false })))
    ).text()
    const actual = await (await handler(reqFor(makePayload({ pages, posts })))).text()

    expect(actual).toBe(expected)
    expect(actual).toBe(
      [
        '# localhost',
        '',
        '## Pages',
        '',
        '- [Home](http://localhost): The front door',
        '- [About us](http://localhost/about)',
        '',
        '## Posts',
        '',
        '- [Hello](http://localhost/posts/hello): First post',
        '',
      ].join('\n'),
    )
  })
})

describe('fetchAllDocs select', () => {
  it('accepts a nested Payload SelectType', async () => {
    const find = vi.fn(async () => ({ docs: [{ id: 1 }], hasNextPage: false }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = { find, logger: { warn: vi.fn() } } as any
    await fetchAllDocs(payload, { collections: ['pages'], select: { meta: { title: true } } })
    expect(find.mock.calls[0]).toMatchObject([{ select: { meta: { title: true } } }])
  })
})
