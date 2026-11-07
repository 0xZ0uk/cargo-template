/**
 * `analyzeDocument` (#129): the one "analyse a document" module behind `/validate`, the
 * audit, score history, the indexation audit and the content endpoints. Score and stats
 * come from one walk, so the numbers the dashboard, the history and the sidebar show are
 * the ones the checks measured.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SeoCache, SeoSharedCache } from '../cache.js'
import { MAX_RECURSION_DEPTH } from '../constants.js'
import { createAuditHandler } from '../endpoints/audit.js'
import { calculateFlesch } from '../helpers.js'
import { analyzeDocument, analyzeLoadedDocument, DocumentReadError } from '../helpers/analyzeDocument.js'
import type { SeoContentExtractors } from '../helpers/contentExtractor.js'
import { createTrackSeoScoreGlobalHook, createTrackSeoScoreHook } from '../hooks/trackSeoScore.js'
import type { SeoDataStoreResolver } from '../store/index.js'

const text = (value: string) => ({ type: 'text', text: value })
const paragraph = (value: string) => ({ type: 'paragraph', children: [text(value)] })
const richText = (...children: unknown[]) => ({ root: { type: 'root', children } })

const BODY =
  'The quick brown fox jumps over the lazy dog. It was a sunny day and the fox was happy. ' +
  'Readers like short sentences with simple words because they are easy to follow. '

/** A page with a hero (rich text, CTA links, background media), blocks and meta fields. */
const page = {
  id: 1,
  title: 'Many title words that are not body text at all',
  slug: 'page',
  _status: 'published',
  meta: {
    title: 'Meta title words that are not body text',
    description: 'Meta description words that are not body text either.',
  },
  hero: {
    richText: richText(paragraph(BODY)),
    links: [
      { link: { type: 'custom', url: '/signup', label: 'Sign up' } },
      { link: { type: 'custom', url: 'https://partner.example.com', label: 'Partner' } },
    ],
    media: { url: '/media/hero.jpg', alt: 'A fox' },
  },
  layout: [{ blockType: 'richText', richText: richText(paragraph(BODY), paragraph(BODY)) }],
}

const countWords = (value: string) => value.split(/\s+/).filter(Boolean).length

describe('analyzeLoadedDocument: score and stats from one walk', () => {
  const { analysis, text: body } = analyzeLoadedDocument(null, page, { collection: 'pages' })
  const { stats } = analysis

  it('counts what the content-wordcount rule counts', () => {
    expect(stats.wordCount).toBe(countWords(BODY) * 3)
    expect(analysis.checks.find((c) => c.id === 'content-wordcount')?.message).toContain(`${stats.wordCount} words`)
  })

  it('leaves the title and meta fields out of the body text', () => {
    expect(body).not.toContain('title words')
    expect(body).not.toContain('Meta description')
  })

  it('puts the title and meta fields before the body in the page text, for term matching', () => {
    const { pageText } = analyzeLoadedDocument(null, page, { collection: 'pages' }, { purpose: 'content' })
    expect(pageText.startsWith(`${page.title} Meta title words`)).toBe(true)
    expect(pageText).toContain('Meta description words')
    expect(pageText.endsWith(body)).toBe(true)
  })

  it('counts the hero links and the hero media', () => {
    expect(stats.internalLinkCount).toBe(1)
    expect(stats.externalLinkCount).toBe(1)
    expect(stats.imageCount).toBe(1)
    expect(stats.imagesWithAlt).toBe(1)
  })

  it('scores readability with the English Flesch formula, and 0 for 30 words or fewer', () => {
    expect(stats.readabilityScore).toBeCloseTo(calculateFlesch(`${BODY} ${BODY} ${BODY}`), 0)
    const short = analyzeLoadedDocument(null, { layout: [{ blockType: 'richText', richText: richText(paragraph('Few words.')) }] }, {
      collection: 'pages',
    })
    expect(short.analysis.stats.readabilityScore).toBe(0)
  })

  it('takes a post title as its h1 when the content has none', () => {
    const post = analyzeLoadedDocument(null, { title: 'Post title', content: richText(paragraph(BODY)) }, { collection: 'posts' })
    expect(post.analysis.stats.h1Count).toBe(1)
    expect(post.analysis.stats.headingCount).toBe(1)
  })
})

describe('analyzeLoadedDocument: purposes', () => {
  const score = analyzeLoadedDocument(null, page, { collection: 'pages' }).analysis
  const groups = (checks: Array<{ group: string }>) => new Set(checks.map((c) => c.group))

  it('audit: the same score without the weight-0 geo, eeat and hreflang groups', () => {
    const audit = analyzeLoadedDocument(null, page, { collection: 'pages' }, { purpose: 'audit' }).analysis
    expect(audit.score).toBe(score.score)
    expect(audit.stats).toEqual(score.stats)
    for (const group of ['geo', 'eeat', 'hreflang']) expect(groups(audit.checks).has(group)).toBe(false)
  })

  it('technical: only the technical group, on the full input', () => {
    const doc = { ...page, meta: { ...page.meta, robots: 'noindex' } }
    const { analysis, input } = analyzeLoadedDocument(null, doc, { collection: 'pages' }, { purpose: 'technical' })
    expect([...groups(analysis.checks)]).toEqual(['technical'])
    expect(analysis.checks.find((c) => c.id === 'robots-noindex')?.status).toBe('fail')
    expect(input.heroRichText).toBeDefined()
  })

  it('content: no checks, the stats and the text', () => {
    const { analysis, text: body } = analyzeLoadedDocument(null, page, { collection: 'pages' }, { purpose: 'content' })
    expect(analysis.checks).toEqual([])
    expect(analysis.stats).toEqual(score.stats)
    expect(body).toContain('quick brown fox')
  })

  it('keeps the rules the config disables', () => {
    const { analysis } = analyzeLoadedDocument(null, page, { collection: 'pages' }, {
      purpose: 'audit',
      config: { disabledRules: ['title'] },
    })
    expect(groups(analysis.checks).has('title')).toBe(false)
  })
})

describe('analyzeLoadedDocument: extractors, depth and globals', () => {
  const extractor = vi.fn<NonNullable<SeoContentExtractors['docs']>>(() => ({ text: ['Extractor words only.'] }))
  const payload = { config: { custom: { seoAnalyzer: { extractContent: { docs: extractor, settings: extractor } } } } }

  afterEach(() => extractor.mockClear())

  it('looks the extractor up on the Payload instance', () => {
    const { text: body } = analyzeLoadedDocument(payload, { ...page, hero: undefined }, { collection: 'docs' })
    expect(body).toBe('Extractor words only.')
  })

  it('hands the extractor the maxRecursionDepth setting (default MAX_RECURSION_DEPTH)', () => {
    analyzeLoadedDocument(payload, page, { collection: 'docs' })
    expect(extractor).toHaveBeenLastCalledWith(expect.objectContaining({ maxDepth: MAX_RECURSION_DEPTH }))
    analyzeLoadedDocument(payload, page, { collection: 'docs' }, { config: { maxRecursionDepth: 3 } })
    expect(extractor).toHaveBeenLastCalledWith(expect.objectContaining({ maxDepth: 3 }))
  })

  it('reads a global without a slug and without an extractor', () => {
    const { input, analysis } = analyzeLoadedDocument(payload, { ...page, slug: 'settings' }, { global: 'settings' })
    expect(input.isGlobal).toBe(true)
    expect(input.slug).toBe('')
    expect(extractor).not.toHaveBeenCalled()
    expect(analysis.checks.find((c) => c.group === 'url')?.id).toBe('slug-global-skip')
    expect(analysis.stats.wordCount).toBe(countWords(BODY) * 3)
  })
})

describe('analyzeDocument: read and config', () => {
  function fakePayload(doc: Record<string, unknown> | null = page, settings: Record<string, unknown>[] = []) {
    return {
      config: {},
      find: vi.fn(async () => ({ docs: settings })),
      findByID: vi.fn(async () => {
        if (!doc) throw new Error('Not Found')
        return doc
      }),
      findGlobal: vi.fn(async () => doc),
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const asReq = (payload: ReturnType<typeof fakePayload>, user: unknown = { id: 9 }) => ({ payload, user }) as any

  afterEach(() => vi.unstubAllEnvs())

  it('reads at depth 1 with the read-access options, and merges the saved settings', async () => {
    const payload = fakePayload(page, [{ disabledRules: ['title'] }])
    const { analysis, doc } = await analyzeDocument(asReq(payload), { collection: 'pages', id: 1 }, { locale: 'en' })
    expect(doc).toBe(page)
    expect(payload.findByID).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'pages', id: 1, depth: 1, overrideAccess: true, locale: 'en' }),
    )
    expect(analysis.checks.some((c) => c.group === 'title')).toBe(false)
  })

  it("reads with the caller's access in strict mode, unless overrideAccess", async () => {
    vi.stubEnv('SEO_STRICT_READ_ACCESS', '1')
    const payload = fakePayload()
    await analyzeDocument(asReq(payload), { global: 'settings' })
    expect(payload.findGlobal).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'settings', depth: 1, overrideAccess: false, user: { id: 9 } }),
    )
    await analyzeDocument(asReq(payload), { collection: 'pages', id: 1 }, { overrideAccess: true })
    expect(payload.findByID).toHaveBeenCalledWith(expect.objectContaining({ overrideAccess: true }))
  })

  it('skips the read for a document passed in, and the settings for a merged config or content', async () => {
    const payload = fakePayload()
    await analyzeDocument(asReq(payload), { collection: 'pages', doc: page }, { mergedConfig: {} })
    await analyzeDocument(asReq(payload), { collection: 'pages', id: 1 }, { purpose: 'content' })
    expect(payload.findByID).toHaveBeenCalledTimes(1)
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('throws DocumentReadError when the read fails', async () => {
    const payload = fakePayload(null)
    await expect(analyzeDocument(asReq(payload), { collection: 'pages', id: 404 })).rejects.toBeInstanceOf(
      DocumentReadError,
    )
    await expect(analyzeDocument(asReq(payload), { global: 'missing' })).rejects.toThrow('Global not found: missing')
  })
})

describe('consumers show the analysis stats', () => {
  function historyStore() {
    const insert = vi.fn(async () => {})
    const resolveStore = (() => ({
      scoreHistory: { list: async () => [], insert },
    })) as unknown as SeoDataStoreResolver
    return { insert, resolveStore }
  }

  it('score history (collections and globals) stores the analysis word count', async () => {
    const expected = analyzeLoadedDocument(null, page, { collection: 'pages' }).analysis
    const payload = { config: {}, find: vi.fn(async () => ({ docs: [] })), logger: { error: vi.fn() } }

    const pending: Promise<unknown>[] = []
    const waitUntil = (p: Promise<unknown>) => void pending.push(p)
    const collectionStore = historyStore()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await createTrackSeoScoreHook(undefined, { resolveStore: collectionStore.resolveStore, waitUntil })({ doc: page, collection: { slug: 'pages' }, req: { payload } } as any)
    const globalStore = historyStore()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await createTrackSeoScoreGlobalHook(undefined, { resolveStore: globalStore.resolveStore, waitUntil })({ doc: page, global: { slug: 'home' }, req: { payload } } as any)
    await Promise.all(pending)

    expect(collectionStore.insert).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'pages', score: expected.score, wordCount: expected.stats.wordCount }),
    )
    expect(globalStore.insert).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'global:home', wordCount: expected.stats.wordCount }),
    )
  })

  it('the dashboard audit row', async () => {
    const background: Promise<unknown>[] = []
    const cache = new SeoSharedCache({ memory: new SeoCache(), waitUntil: (p) => void background.push(p) })
    const payload = {
      config: { admin: { user: 'users' } },
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
      find: vi.fn(async (args: { collection: string }) =>
        args.collection === 'pages' ? { docs: [page], hasNextPage: false } : { docs: [], hasNextPage: false },
      ),
      findGlobal: vi.fn(async () => null),
    }
    const handler = createAuditHandler(['pages'], {}, [], undefined, cache)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = { user: { id: 1, collection: 'users' }, url: 'http://localhost/api/seo-plugin/audit', payload } as any
    expect((await handler(req)).status).toBe(202)
    await Promise.all(background)
    const body = (await (await handler(req)).json()) as { results: Array<Record<string, unknown>> }

    const { analysis } = analyzeLoadedDocument(null, page, { collection: 'pages' }, { purpose: 'audit' })
    expect(body.results[0]).toMatchObject({
      score: analysis.score,
      wordCount: analysis.stats.wordCount,
      readabilityScore: analysis.stats.readabilityScore,
      internalLinkCount: 1,
      externalLinkCount: 1,
      headingCount: analysis.stats.headingCount,
      h1Count: analysis.stats.h1Count,
    })
  })
})
