import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SeoCache, SeoSharedCache } from '../cache.js'
import { buildAuditToFile } from '../endpoints/audit.js'
import { createIndexationAuditHandler } from '../endpoints/indexationAudit.js'
import { createIndexNowHook, createIndexNowSubmitHandler } from '../endpoints/indexNow.js'
import { createLlmsTxtHandler } from '../endpoints/llmsTxt.js'
import { createSitemapHandler } from '../endpoints/sitemap.js'
import {
  createImageSitemapHandler,
  createNewsSitemapHandler,
  createVideoSitemapHandler,
} from '../endpoints/sitemapExtensions.js'
import { fetchAllDocs } from '../helpers/fetchAllDocs.js'
import { withExclusionSelect } from '../helpers/excludeDocs.js'
import type { SeoConfig } from '../types.js'

// The host's exclusion as apps/web wires it: A/B variants carry `_abVariantOf`.
const SITE = 'https://example.com'
const seoConfig: SeoConfig = {
  siteUrl: SITE,
  excludeDocs: (doc) => doc._abVariantOf != null,
  excludeDocsFields: ['_abVariantOf'],
}

const now = new Date().toISOString()
const body = {
  root: {
    type: 'root',
    children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Some words about the page. '.repeat(30) }] }],
  },
}
const image = { mimeType: 'image/png', url: '/media/hero.png' }
const video = { mimeType: 'video/mp4', url: '/media/clip.mp4' }

const ORIGINAL = {
  id: 1,
  slug: 'about',
  title: 'About',
  _status: 'published',
  _abVariantOf: null,
  publishedAt: now,
  updatedAt: now,
  meta: { title: 'About us', description: 'About the company and the team behind it.' },
  hero: image,
  clip: video,
  content: body,
}
const VARIANT = {
  ...ORIGINAL,
  id: 2,
  slug: 'about--4ji9qa',
  _abVariantOf: 1,
}

/** Applies a top-level `select` the way Payload does, so a projection that forgets a field hides it. */
function project(doc: Record<string, unknown>, select?: Record<string, unknown>) {
  if (!select) return doc
  return Object.fromEntries(Object.entries(doc).filter(([key]) => key === 'id' || key in select))
}

function fakePayload(docs: Record<string, unknown>[] = [ORIGINAL, VARIANT]) {
  return {
    config: { admin: { user: 'users' }, routes: { api: '/api' } },
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    find: vi.fn(async (args: { collection: string; select?: Record<string, unknown> }) => {
      if (args.collection !== 'pages') return { docs: [], hasNextPage: false, totalDocs: 0 }
      const out = docs.map((d) => project(d, args.select))
      return { docs: out, hasNextPage: false, totalDocs: out.length }
    }),
    findGlobal: vi.fn(async () => null),
  }
}

/** A cache of its own per call: the default one is shared by every handler in the process. */
const fresh = () => new SeoSharedCache({ memory: new SeoCache() })

const reqFor = (payload: ReturnType<typeof fakePayload>, path = '/api/seo-plugin/x') =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ({ payload, user: { id: 1, collection: 'users' }, url: `${SITE}${path}` }) as any

beforeEach(() => {
  process.env.SEO_LLMS_TXT = '1'
})
afterEach(() => {
  delete process.env.SEO_LLMS_TXT
  delete process.env.SEO_INDEXNOW_KEY
  vi.unstubAllGlobals()
})

describe('excludeDocs', () => {
  it('leaves excluded docs out of sitemap.xml, even with its trimmed projection', async () => {
    const xml = await (await createSitemapHandler(['pages'], seoConfig, fresh())(reqFor(fakePayload()))).text()
    expect(xml).toContain(`<loc>${SITE}/about</loc>`)
    expect(xml).not.toContain('about--4ji9qa')
  })

  it('lists both without an exclusion', async () => {
    const xml = await (await createSitemapHandler(['pages'], { siteUrl: SITE }, fresh())(reqFor(fakePayload()))).text()
    expect(xml).toContain('about--4ji9qa')
  })

  it('reads whole documents when the exclusion declares no fields', async () => {
    const payload = fakePayload()
    const config: SeoConfig = { siteUrl: SITE, excludeDocs: seoConfig.excludeDocs }
    const xml = await (await createSitemapHandler(['pages'], config, fresh())(reqFor(payload))).text()
    expect(xml).not.toContain('about--4ji9qa')
    expect(payload.find).toHaveBeenCalledWith(expect.not.objectContaining({ select: expect.anything() }))
  })

  it('leaves excluded docs out of the news, image and video sitemaps', async () => {
    for (const create of [createNewsSitemapHandler, createImageSitemapHandler, createVideoSitemapHandler]) {
      const xml = await (await create(['pages'], seoConfig, fresh())(reqFor(fakePayload()))).text()
      expect(xml).toContain(`${SITE}/about<`)
      expect(xml).not.toContain('about--4ji9qa')
    }
  })

  it('leaves excluded docs out of llms.txt', async () => {
    const text = await (await createLlmsTxtHandler(['pages'], seoConfig, fresh())(reqFor(fakePayload()))).text()
    expect(text).toContain(`${SITE}/about`)
    expect(text).not.toContain('about--4ji9qa')
  })

  it('skips excluded docs in the dashboard audit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'seo-exclude-'))
    try {
      const outFile = join(dir, 'audit.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await buildAuditToFile(fakePayload() as any, { collections: ['pages'], seoConfig, outFile })
      const file = JSON.parse(await readFile(outFile, 'utf8')) as {
        byKey: Record<string, { enrichedResults: Array<{ slug: string }> }>
      }
      const slugs = Object.values(file.byKey)[0]!.enrichedResults.map((r) => r.slug)
      expect(slugs).toEqual(['about'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('skips excluded docs in the indexation audit', async () => {
    type Body = { summary: { totalDocs: number } }
    const res = await createIndexationAuditHandler(['pages'], seoConfig, [], fresh())(reqFor(fakePayload()))
    expect(((await res.json()) as Body).summary.totalDocs).toBe(1)
    const all = await createIndexationAuditHandler(['pages'], { siteUrl: SITE }, [], fresh())(reqFor(fakePayload()))
    expect(((await all.json()) as Body).summary.totalDocs).toBe(2)
  })

  it('never pings IndexNow for an excluded doc', async () => {
    process.env.SEO_INDEXNOW_KEY = 'abcdef0123456789'
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const payload = fakePayload()
    const hook = createIndexNowHook('/seo-plugin', seoConfig)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hook({ doc: VARIANT, req: reqFor(payload), collection: { slug: 'pages' } } as any)
    expect(fetchMock).not.toHaveBeenCalled()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hook({ doc: ORIGINAL, req: reqFor(payload), collection: { slug: 'pages' } } as any)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockClear()
    const res = await createIndexNowSubmitHandler('/seo-plugin', ['pages'], seoConfig)(reqFor(payload))
    expect(((await res.json()) as { submitted: number }).submitted).toBe(1)
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body) as {
      urlList: string[]
    }
    expect(sent.urlList).toEqual([`${SITE}/about`])
  })

  it('filters fetchAllDocs and widens its select to the declared fields', async () => {
    const payload = fakePayload()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docs = await fetchAllDocs(payload as any, {
      collections: ['pages'],
      select: { slug: true },
      exclude: { test: seoConfig.excludeDocs!, fields: ['_abVariantOf'] },
    })
    expect(docs.map((d) => d.doc.slug)).toEqual(['about'])
    expect(payload.find).toHaveBeenCalledWith(expect.objectContaining({ select: { slug: true, _abVariantOf: true } }))
  })

  it('merges declared fields into a nested select without narrowing a whole-field read', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = {} as any
    const test = () => false
    expect(withExclusionSelect(payload, ['pages'], { meta: true }, { test, fields: ['meta.robots', 'x'] })).toEqual({
      meta: true,
      x: true,
    })
    expect(withExclusionSelect(payload, ['pages'], { meta: { title: true } }, { test, fields: ['meta.robots'] })).toEqual({
      meta: { title: true, robots: true },
    })
    expect(withExclusionSelect(payload, ['pages'], undefined, { test, fields: ['x'] })).toBeUndefined()
  })
})
