/**
 * Page-builder blocks (shipment #47): a page built only from section blocks in
 * `layout` (Hero, Features, Columns, FAQ…) must contribute its headings, text and FAQ to
 * the analysis — in `analyzeDocument` (`/validate`, the audit, score history) and the sidebar alike.
 *
 * The fixture mirrors the block `example`s in `apps/web/src/blocks/<Name>/meta.ts`
 * (hand-written: the plugin never imports from the app).
 */
import { describe, expect, it, vi } from 'vitest'

// Pass-through spy: counts the walks without changing them.
vi.mock('../helpers/blockContent', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../helpers/blockContent')>()
  return { ...mod, extractBlocksContent: vi.fn(mod.extractBlocksContent) }
})

import { analyzeSeo } from '../index'
import { analyzeLoadedDocument } from '../helpers/analyzeDocument'
import { extractBlocksContent } from '../helpers/blockContent'
import { buildSeoInputFromDoc, seoInputFromDoc } from '../helpers/seoInputFromDoc'
import { formStateToDoc } from '../helpers/sidebarContent'
import { toFormState } from './helpers/formState'
import { buildJsonLd } from '../helpers/buildSchema'
import { extractAllInternalLinks } from '../helpers/linkExtractor'
import { extractDocExternalLinks } from '../endpoints/externalLinks'

const text = (value: string) => ({ type: 'text', text: value, version: 1 })
const paragraph = (value: string) => ({ type: 'paragraph', children: [text(value)], version: 1 })
const heading = (tag: string, value: string) => ({
  type: 'heading',
  tag,
  children: [text(value)],
  version: 1,
})
const richText = (...children: unknown[]) => ({
  root: { type: 'root', children, direction: 'ltr', format: '', indent: 0, version: 1 },
})

const link = (label: string, url: string) => ({ link: { type: 'custom', url, label } })

const blockPage = {
  id: 1,
  title: 'Home',
  slug: 'home',
  meta: { title: 'Northwind | Project planning', description: 'Plan work with Northwind.' },
  layout: [
    {
      blockType: 'hero',
      variant: 'centered',
      section: { background: 'default', spacing: 'md' },
      eyebrow: 'New: reporting',
      title: 'Ship projects on time with Northwind',
      description: 'One workspace for planning, tracking and reporting.',
      links: [link('Start free trial', '/signup'), link('Book a demo', 'https://cal.example.com')],
    },
    {
      blockType: 'features',
      variant: 'grid',
      title: 'Everything in one place',
      description: 'The tools your team already reaches for.',
      items: [
        { icon: 'zap', title: 'Fast boards', description: 'Boards load instantly, even with thousands of cards.' },
        { icon: 'shield', title: 'Secure by default', description: 'Encryption in transit and at rest.' },
      ],
    },
    {
      blockType: 'columns',
      variant: 'halves',
      title: 'Why teams switch',
      columns: [
        {
          content: [
            {
              blockType: 'columnText',
              richText: richText(
                heading('h3', 'Plan work together'),
                paragraph('Turn goals into projects, assign owners and set deadlines in minutes.'),
              ),
            },
            { blockType: 'columnButtons', links: [link('See pricing', '/pricing')] },
          ],
        },
        {
          content: [
            { blockType: 'columnMedia', caption: 'The project board shows progress at a glance.' },
            {
              blockType: 'columnCard',
              title: 'Reports',
              description: 'Weekly status reports, written for you.',
              enableLink: true,
              link: { type: 'custom', url: '/reports', label: 'Reports' },
            },
          ],
        },
      ],
    },
    {
      blockType: 'faq',
      variant: 'accordion',
      title: 'Questions, answered',
      items: [
        {
          question: 'How does billing work?',
          answer: richText(paragraph('Northwind is billed per workspace, monthly or yearly.')),
        },
        {
          question: 'Can I cancel at any time?',
          answer: richText(paragraph('Yes. Cancel from your account settings whenever you like.')),
        },
      ],
    },
    {
      blockType: 'stats',
      variant: 'row',
      items: [{ value: '98%', label: 'On-time delivery', description: 'Across all customers.' }],
    },
    {
      blockType: 'testimonials',
      variant: 'grid',
      items: [{ quote: 'Northwind changed how we plan.', name: 'Ada Lovelace', role: 'CTO, Acme' }],
    },
    {
      blockType: 'cta',
      variant: 'banner',
      title: 'Ready to start?',
      links: [link('Start free trial', '/signup')],
    },
  ],
}

describe('page-builder blocks: server extraction', () => {
  it('reads block headings, item text, columns and FAQ', () => {
    const { text, analysis } = analyzeLoadedDocument(null, blockPage, { collection: 'pages' })
    const extracted = { ...extractBlocksContent(blockPage.layout), text }

    expect(extracted.headings).toEqual(
      expect.arrayContaining([
        { tag: 'h1', text: 'Ship projects on time with Northwind' },
        { tag: 'h2', text: 'Everything in one place' },
        { tag: 'h2', text: 'Why teams switch' },
        { tag: 'h3', text: 'Plan work together' },
        { tag: 'h2', text: 'Questions, answered' },
        { tag: 'h2', text: 'Ready to start?' },
      ]),
    )
    expect(extracted.headings.filter((h) => h.tag === 'h1')).toHaveLength(1)
    expect(analysis.stats.h1Count).toBe(1)

    for (const fragment of [
      'New: reporting',
      'One workspace for planning',
      'Boards load instantly',
      'Turn goals into projects',
      'Weekly status reports',
      'The project board shows progress',
      'How does billing work?',
      'billed per workspace',
      'On-time delivery',
      'Northwind changed how we plan.',
    ]) {
      expect(extracted.text).toContain(fragment)
    }
    expect(extracted.links).toEqual(
      expect.arrayContaining([
        { url: '/signup', text: 'Start free trial' },
        { url: '/pricing', text: 'See pricing' },
        { url: '/reports', text: 'Reports' },
      ]),
    )
    // Settings and enum values never count as words.
    expect(extracted.text).not.toMatch(/\b(centered|halves|accordion|zap|columnText)\b/)
  })

  it('/validate: a block-built page with a Hero has an h1 and counts its words', () => {
    const { analysis } = analyzeLoadedDocument(null, blockPage, { collection: 'pages' })
    const check = (id: string) => analysis.checks.find((c) => c.id === id)

    expect(check('h1-missing')).toBeUndefined()
    expect(check('h1-unique')?.status).toBe('pass')
    expect(check('heading-hierarchy')?.status).toBe('pass')
    expect(analysis.stats.wordCount).toBeGreaterThan(60)
    // The stats are what the rule measured.
    expect(check('content-wordcount')?.message).toContain(`${analysis.stats.wordCount} words`)
  })

  it('detects the FAQ from its question/answer items', () => {
    expect(extractBlocksContent(blockPage.layout).hasFaq).toBe(true)
    expect(
      extractBlocksContent([
        { blockType: 'questions', items: [{ question: 'Why?', answer: richText(paragraph('Because.')) }] },
      ]).hasFaq,
    ).toBe(true)
    expect(extractBlocksContent([{ blockType: 'features', items: [{ title: 'A' }] }]).hasFaq).toBe(false)
  })

  it('counts the rich text of a block it does not know', () => {
    const doc = {
      title: 'Unknown',
      layout: [
        {
          blockType: 'futureBlock',
          panels: [{ body: richText(heading('h2', 'Future heading'), paragraph('Future words count too.')) }],
        },
      ],
    }
    const { text, analysis } = analyzeLoadedDocument(null, doc, { collection: 'pages' })
    expect(text).toContain('Future words count too.')
    expect(extractBlocksContent(doc.layout).headings).toContainEqual({ tag: 'h2', text: 'Future heading' })
    expect(analysis.stats.headingCount).toBe(1)
    // The page title is not body text.
    expect(analysis.stats.wordCount).toBe(6)
  })

  it('PageHeader titles are the h1; Logos and Embed titles are not headings', () => {
    const { headings, text: parts } = extractBlocksContent([
      { blockType: 'pageHeader', title: 'About us' },
      { blockType: 'logos', title: 'Trusted by teams at', items: [{ name: 'Acme' }] },
      { blockType: 'embed', url: 'https://youtu.be/x', title: 'Product walkthrough', caption: 'Watch it' },
    ])
    expect(headings).toEqual([{ tag: 'h1', text: 'About us' }])
    const joined = parts.join(' ')
    expect(joined).toContain('Trusted by teams at')
    expect(joined).toContain('Watch it')
    expect(joined).not.toContain('Product walkthrough')
    expect(joined).not.toContain('youtu.be')
  })

  it('reads a populated reusable section like the page\'s own blocks, and skips an unpopulated one', () => {
    const section = {
      blockType: 'globalSection',
      reusableSection: {
        id: 7,
        title: 'Admin-only section name',
        layout: [{ blockType: 'hero', title: 'Coffee subscriptions', description: 'Fresh beans every week.' }],
      },
    }
    const populated = extractBlocksContent([section])
    expect(populated.headings).toEqual([{ tag: 'h1', text: 'Coffee subscriptions' }])
    expect(populated.text).toContain('Fresh beans every week.')
    expect(populated.text).not.toContain('Admin-only section name')

    const unpopulated = extractBlocksContent([{ blockType: 'globalSection', reusableSection: 7 }])
    expect(unpopulated.headings).toEqual([])
  })

  it('keeps reading the upstream shapes (columns[].richText, services, testimonials)', () => {
    const layout = [
      { blockType: 'content', columns: [{ richText: richText(paragraph('Old column text.')) }] },
      { blockType: 'services', services: [{ title: 'SEO', description: 'Rank higher.', link: '/seo' }] },
      { blockType: 'testimonials', testimonials: [{ quote: 'Great work.' }] },
      { blockType: 'banner', content: 'Banner copy.' },
    ]
    const { text } = analyzeLoadedDocument(null, { layout }, { collection: 'pages' })
    for (const fragment of ['Old column text.', 'SEO', 'Rank higher.', 'Great work.', 'Banner copy.']) {
      expect(text).toContain(fragment)
    }
    expect(extractBlocksContent(layout).links).toContainEqual({ url: '/seo', text: 'SEO' })
  })
})

// ---------------------------------------------------------------------------
// Sidebar parity: the sidebar reads Payload form state, flattened by path.
// ---------------------------------------------------------------------------


/** The sidebar's own reading of a form: the form reduced to a document, then the one mapping. */
const sidebarInput = (formState: Record<string, unknown>) => seoInputFromDoc(formStateToDoc(formState), { collection: 'pages' })

describe('page-builder blocks: sidebar parity', () => {
  const pick = (analysis: ReturnType<typeof analyzeSeo>) =>
    analysis.checks
      .filter((c) => c.group === 'headings' || c.id === 'content-wordcount')
      .map((c) => ({ id: c.id, status: c.status, message: c.message }))

  it('the sidebar and /validate derive the same input and score from the same document', () => {
    const fromValidate = analyzeSeo(buildSeoInputFromDoc(blockPage, 'pages'))
    const sidebar = sidebarInput(toFormState(blockPage))
    const fromSidebar = analyzeSeo(sidebar)

    expect(sidebar.blocks).toHaveLength(blockPage.layout.length)
    expect(pick(fromSidebar)).toEqual(pick(fromValidate))
    expect(fromSidebar.score).toBe(fromValidate.score)
    expect(fromSidebar.checks.find((c) => c.id === 'h1-missing')).toBeUndefined()
  })
})

describe('page-builder blocks: link graph, external links, FAQPage, GEO', () => {
  it('extractAllInternalLinks reads hero links, Columns nested links and CTA links', () => {
    const urls = extractAllInternalLinks(blockPage).map((l) => l.url)
    expect(urls).toEqual(expect.arrayContaining(['/signup', '/pricing', '/reports']))
    // The external hero link is not internal.
    expect(urls).not.toContain('https://cal.example.com')
    // Nested Columns content is reached through `columns[].content`, not `columns[].richText`.
    expect(extractAllInternalLinks(blockPage).find((l) => l.url === '/pricing')?.text).toBe('See pricing')
  })

  it('extractAllInternalLinks keeps the upstream block shapes', () => {
    const urls = extractAllInternalLinks({
      layout: [
      { blockType: 'services', services: [{ title: 'Web', link: '/web' }] },
        { blockType: 'latestPosts', ctaLink: '/blog', ctaLabel: 'All posts' },
        { blockType: 'banner', link: { type: 'custom', url: '/promo', label: 'Promo' } },
        { columns: [{ richText: richText('x'), enableLink: true, link: { type: 'custom', url: '/col' } }] },
      ],
    }).map((l) => l.url)
    expect(urls).toEqual(['/web', '/blog', '/promo', '/col'])
  })

  it('extractDocExternalLinks reads block link and links fields', () => {
    const urls = extractDocExternalLinks(blockPage)
    expect(urls).toContain('https://cal.example.com')
    expect(urls).not.toContain('/signup')
    expect(
      extractDocExternalLinks({
        layout: [{ blockType: 'banner', link: { type: 'custom', url: 'https://b.example/', label: 'B' } }],
      }),
    ).toEqual(['https://b.example/'])
  })

  it('builds a FAQPage from a faq block, with the pairs checkSchema detects', () => {
    const { jsonLd } = buildJsonLd(blockPage as Record<string, unknown>, { type: 'FAQPage' })
    expect(jsonLd['@type']).toBe('FAQPage')
    expect(jsonLd.mainEntity).toEqual([
      {
        '@type': 'Question',
        name: 'How does billing work?',
        acceptedAnswer: { '@type': 'Answer', text: 'Northwind is billed per workspace, monthly or yearly.' },
      },
      {
        '@type': 'Question',
        name: 'Can I cancel at any time?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes. Cancel from your account settings whenever you like.',
        },
      },
    ])
    // Detection picks FAQPage on its own when the page has nothing else to say.
    expect(extractBlocksContent(blockPage.layout).faqPairs).toHaveLength(2)
  })

  it('builds the FAQPage from Q/A items in any block, and still reads a `title` question in an faq block', () => {
    const nested = extractBlocksContent([
      { blockType: 'columns', columns: [{ content: [{ blockType: 'questions', items: [{ question: 'Why?', answer: 'Because.' }] }] }] },
      { blockType: 'faq', items: [{ title: 'Where?', answer: 'Here.' }, { question: 'Skipped?' }] },
    ])
    expect(nested.faqPairs).toEqual([
      { question: 'Why?', answer: 'Because.' },
      { question: 'Where?', answer: 'Here.' },
    ])
  })

  it('geo-faq-howto passes on a page with a faq block, and warns without one', () => {
    // GEO checks need 150+ words.
    const filler = {
      blockType: 'richText',
      richText: richText(paragraph('Planning software helps teams. '.repeat(40))),
    }
    const geo = (layout: unknown[]) =>
      analyzeSeo(
        buildSeoInputFromDoc({ ...blockPage, slug: 'planning-software', layout: [...layout, filler] }, 'pages'),
      ).checks.find((c) => c.id === 'geo-faq-howto')
    // The faq block alone (its heading is not a question), then the page without it.
    const faq = blockPage.layout.filter((b) => b.blockType === 'faq')
    expect(geo(faq)?.status).toBe('pass')
    expect(geo(blockPage.layout.filter((b) => b.blockType === 'features'))?.status).toBe('warning')
  })

  it('walks the blocks once per analysis, score and stats together', () => {
    vi.mocked(extractBlocksContent).mockClear()
    const { analysis, text } = analyzeLoadedDocument(null, { ...blockPage, slug: 'planning-software' }, { collection: 'pages' })
    expect(extractBlocksContent).toHaveBeenCalledTimes(1)
    expect(analysis.stats.wordCount).toBeGreaterThan(0)
    expect(text).toContain('Weekly status reports')
  })

  it('carries robotsMeta from the noindex checkbox, so robots-noindex shows live', () => {
    const ticked = sidebarInput(toFormState({ ...blockPage, noindex: true }))
    expect(ticked.robotsMeta).toBe('noindex')
    expect(analyzeSeo(ticked).checks.find((c) => c.id === 'robots-noindex')?.status).toBe('fail')

    expect(sidebarInput(toFormState({ ...blockPage, noindex: false })).robotsMeta).toBeUndefined()
    // Same precedence as /validate: a raw robots string wins over the checkbox.
    expect(
      sidebarInput(toFormState({ ...blockPage, noindex: true, meta: { ...blockPage.meta, robots: 'nofollow' } })).robotsMeta,
    ).toBe('nofollow')
  })
})
