import { describe, expect, it } from 'vitest'

import { buildJsonLd, detectSchemaType } from '../helpers/buildSchema.js'

const faqBlock = (items: unknown[]) => ({ blockType: 'faq', items })
const lexical = (text: string) => ({
  root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text }] }] },
})

describe('detectSchemaType', () => {
  it('calls the home page a WebPage, not an Article', () => {
    expect(detectSchemaType('pages', { slug: 'home', title: 'Home' })).toBe('WebPage')
    expect(detectSchemaType('pages', { slug: '', title: 'Home' })).toBe('WebPage')
    expect(detectSchemaType('pages', { title: 'Home' })).toBe('WebPage')
  })

  it('calls a generic page a WebPage', () => {
    expect(detectSchemaType('pages', { slug: 'about', title: 'About' })).toBe('WebPage')
    // A date alone, or an author alone, doesn't make an article.
    expect(detectSchemaType('pages', { slug: 'about', publishedAt: '2026-01-01' })).toBe('WebPage')
    expect(detectSchemaType('pages', { slug: 'about', populatedAuthors: [{ name: 'Ada' }] })).toBe('WebPage')
    expect(detectSchemaType('pages', { slug: 'about', populatedAuthors: [], publishedAt: '2026-01-01' })).toBe('WebPage')
  })

  it('calls posts-like collections Articles', () => {
    for (const collection of ['posts', 'post', 'articles', 'blog', 'blog-posts', 'news']) {
      expect(detectSchemaType(collection, { slug: 'x', title: 'X' })).toBe('Article')
    }
    expect(detectSchemaType('pages', { slug: 'x' })).not.toBe('Article')
  })

  it('calls a document with a publication date and an author an Article', () => {
    expect(detectSchemaType('pages', { slug: 'x', publishedAt: '2026-01-01', populatedAuthors: [{ name: 'Ada' }] })).toBe('Article')
    expect(detectSchemaType('pages', { slug: 'x', datePublished: '2026-01-01', author: 'Ada' })).toBe('Article')
  })

  it('keeps the other detections: FAQ with content, Product, LocalBusiness', () => {
    const layout = [faqBlock([{ question: 'Q?', answer: 'A.' }])]
    expect(detectSchemaType('pages', { slug: 'help', layout })).toBe('FAQPage')
    expect(detectSchemaType('pages', { slug: 'beans', price: 12 })).toBe('Product')
    expect(detectSchemaType('products', { slug: 'beans' })).toBe('Product')
    expect(detectSchemaType('pages', { slug: 'notre-boutique' })).toBe('LocalBusiness')
  })

  it('ignores an FAQ block with no complete question and answer', () => {
    const layout = [faqBlock([]), faqBlock([{ question: 'Q?' }, { answer: 'A.' }])]
    expect(detectSchemaType('pages', { slug: 'help', layout })).toBe('WebPage')
  })
})

describe('buildJsonLd WebPage', () => {
  it('builds a WebPage with its own title, URL and dates, and no empty properties', () => {
    const { type, jsonLd, warnings } = buildJsonLd(
      {
        slug: 'about',
        title: 'About',
        updatedAt: '2026-02-01T00:00:00.000Z',
        meta: { title: 'About | Cargo Template', description: 'Who we are', image: { url: '/media/a.png' } },
      },
      { collection: 'pages', collectionRoutes: { pages: '' }, siteUrl: 'https://s.test' },
    )
    expect(type).toBe('WebPage')
    expect(warnings).toEqual([])
    expect(jsonLd).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'About',
      description: 'Who we are',
      url: 'https://s.test/about',
      image: 'https://s.test/media/a.png',
      dateModified: '2026-02-01T00:00:00.000Z',
    })
    const bare = buildJsonLd({ slug: 'home', title: 'Home' }, { collection: 'pages', siteUrl: 'https://s.test' })
    expect(bare.type).toBe('WebPage')
    expect(bare.jsonLd).toEqual({ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Home', url: 'https://s.test' })
  })
})

describe('buildJsonLd FAQPage without Q&A', () => {
  const doc = { slug: 'help', title: 'Help', layout: [faqBlock([{ question: 'Only a question' }]), { blockType: 'cta' }] }

  it('falls back to the detected type and says why', () => {
    const { type, jsonLd, warnings } = buildJsonLd(doc, { collection: 'pages', siteUrl: 'https://s.test', type: 'FAQPage' })
    expect(type).toBe('WebPage')
    expect(jsonLd['@type']).toBe('WebPage')
    expect(jsonLd).not.toHaveProperty('mainEntity')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/FAQPage/)
    expect(warnings[0]).toMatch(/Generated WebPage instead/)
  })

  it('falls back to an Article for a post', () => {
    const { type, warnings } = buildJsonLd({ ...doc, slug: 'my-post' }, { collection: 'posts', type: 'FAQPage' })
    expect(type).toBe('Article')
    expect(warnings[0]).toMatch(/Generated Article instead/)
  })

  it('still builds a FAQPage when there is a question and an answer, with no warning', () => {
    const { type, jsonLd, warnings } = buildJsonLd(
      { slug: 'help', layout: [faqBlock([{ question: 'Q?', answer: 'A.' }])] },
      { collection: 'pages', type: 'FAQPage' },
    )
    expect(type).toBe('FAQPage')
    expect(warnings).toEqual([])
    expect(jsonLd.mainEntity).toEqual([
      { '@type': 'Question', name: 'Q?', acceptedAnswer: { '@type': 'Answer', text: 'A.' } },
    ])
  })

  it('reads a rich-text answer as text, not as a Lexical object', () => {
    const { jsonLd } = buildJsonLd(
      { slug: 'help', layout: [faqBlock([{ question: 'Q?', answer: lexical('Rich answer') }])] },
      { collection: 'pages' },
    )
    expect(jsonLd['@type']).toBe('FAQPage')
    expect(jsonLd.mainEntity).toEqual([
      { '@type': 'Question', name: 'Q?', acceptedAnswer: { '@type': 'Answer', text: 'Rich answer' } },
    ])
  })
})

describe('buildJsonLd names', () => {
  const doc = { slug: 'coffee', title: 'Coffee brewing basics', meta: { title: 'Coffee brewing basics | Cargo Template' } }

  it("uses the document's title for the headline, not the meta title's suffix", () => {
    const { jsonLd } = buildJsonLd(doc, { collection: 'posts', siteUrl: 'https://s.test', type: 'Article' })
    expect(jsonLd.headline).toBe('Coffee brewing basics')
  })

  it('uses it for the other names and the last breadcrumb item', () => {
    for (const type of ['WebPage', 'Product', 'Event', 'Recipe', 'Video', 'Person'] as const) {
      const { jsonLd } = buildJsonLd(doc, { collection: 'pages', siteUrl: 'https://s.test', type })
      expect(jsonLd.name, type).toBe('Coffee brewing basics')
    }
    const crumbs = buildJsonLd(doc, { collection: 'pages', siteUrl: 'https://s.test', type: 'BreadcrumbList' }).jsonLd
    expect((crumbs.itemListElement as Array<{ name: string }>).map((i) => i.name)).toEqual(['Home', 'Coffee brewing basics'])
  })

  it('strips the configured site name from meta.title when there is no title', () => {
    const noTitle = { slug: 'coffee', meta: { title: 'Coffee | Cargo Template' } }
    expect(buildJsonLd(noTitle, { type: 'Article', siteName: 'Cargo Template' }).jsonLd.headline).toBe('Coffee')
    expect(buildJsonLd(noTitle, { type: 'Article' }).jsonLd.headline).toBe('Coffee | Cargo Template')
  })
})

describe('Article authors and dates follow the detection signals', () => {
  const opts = { collection: 'pages', siteUrl: 'https://s.test' }

  it('emits the author from `authors` / `author` and the date from `datePublished`', () => {
    for (const author of [{ authors: [{ name: 'Ada' }] }, { author: { name: 'Ada' } }, { author: 'Ada' }]) {
      const { type, jsonLd } = buildJsonLd({ slug: 'essay', title: 'Essay', datePublished: '2026-01-01', ...author }, opts)
      const article = (jsonLd['@graph'] as Record<string, unknown>[] | undefined)?.find((n) => n['@type'] === 'Article') ?? jsonLd
      expect(type).toBe('Article')
      expect(article.author).toEqual([{ '@type': 'Person', name: 'Ada' }])
      expect(article.datePublished).toBe('2026-01-01')
    }
  })

  it("doesn't call a page an Article when its author is an unpopulated id", () => {
    expect(detectSchemaType('pages', { slug: 'essay', publishedAt: '2026-01-01', author: 42 })).toBe('WebPage')
    expect(detectSchemaType('pages', { slug: 'essay', publishedAt: '2026-01-01', authors: ['64f0c0ffee0000000000abcd'] })).toBe('WebPage')
    expect(detectSchemaType('pages', { slug: 'essay', publishedAt: '2026-01-01', author: '64f0c0ffee0000000000abcd' })).toBe('WebPage')
  })
})
