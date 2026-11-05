/**
 * Page-builder blocks (cargo-template #47): a page built only from section blocks in
 * `layout` (Hero, Features, Columns, FAQ…) must contribute its headings, text and FAQ to
 * the analysis — in `/validate`, the sidebar and `extractDocContent` alike.
 *
 * The fixture mirrors the block `example`s in `apps/web/src/blocks/<Name>/meta.ts`
 * (hand-written: the plugin never imports from the app).
 */
import { describe, expect, it } from 'vitest'

import { analyzeSeo } from '../index'
import { buildSeoInputFromDoc } from '../endpoints/validate'
import { extractDocContent } from '../helpers/extractDocContent'
import { extractBlocksContent } from '../helpers/blockContent'
import { buildSidebarContentInput } from '../helpers/sidebarContent'

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
  it('extractDocContent reads block headings, item text, columns and FAQ', () => {
    const extracted = extractDocContent(blockPage)

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
    const analysis = analyzeSeo(buildSeoInputFromDoc(blockPage, 'pages'))
    const check = (id: string) => analysis.checks.find((c) => c.id === id)

    expect(check('h1-missing')).toBeUndefined()
    expect(check('h1-unique')?.status).toBe('pass')
    expect(check('heading-hierarchy')?.status).toBe('pass')
    const words = Number(check('content-wordcount')?.message.match(/(\d+)\s*words/)?.[1])
    expect(words).toBeGreaterThan(60)
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
    const extracted = extractDocContent(doc)
    expect(extracted.text).toContain('Future words count too.')
    expect(extracted.headings).toContainEqual({ tag: 'h2', text: 'Future heading' })

    const analysis = analyzeSeo(buildSeoInputFromDoc(doc, 'pages'))
    const message = analysis.checks.find((c) => c.id === 'content-wordcount')?.message ?? ''
    expect(Number(message.match(/(\d+)\s*words/)?.[1])).toBe(6)
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

  it('keeps reading the upstream shapes (columns[].richText, services, testimonials)', () => {
    const extracted = extractDocContent({
      layout: [
        { blockType: 'content', columns: [{ richText: richText(paragraph('Old column text.')) }] },
        { blockType: 'services', services: [{ title: 'SEO', description: 'Rank higher.', link: '/seo' }] },
        { blockType: 'testimonials', testimonials: [{ quote: 'Great work.' }] },
        { blockType: 'banner', content: 'Banner copy.' },
      ],
    })
    for (const fragment of ['Old column text.', 'SEO', 'Rank higher.', 'Great work.', 'Banner copy.']) {
      expect(extracted.text).toContain(fragment)
    }
    expect(extracted.links).toContainEqual({ url: '/seo', text: 'SEO' })
  })
})

// ---------------------------------------------------------------------------
// Sidebar parity: the sidebar reads Payload form state, flattened by path.
// ---------------------------------------------------------------------------

type FormState = Record<string, { value: unknown; disableFormData?: boolean }>

const isLexical = (v: unknown) =>
  !!v && typeof v === 'object' && 'root' in (v as Record<string, unknown>)

/** Flatten a document into form state the way Payload's admin form holds it. */
function toFormState(value: unknown, path = '', state: FormState = {}): FormState {
  if (Array.isArray(value)) {
    // Array and blocks fields hold their row count and are left out of form data.
    if (path) state[path] = { value: value.length, disableFormData: true }
    value.forEach((row, i) => toFormState(row, path ? `${path}.${i}` : String(i), state))
  } else if (value && typeof value === 'object' && !isLexical(value)) {
    for (const [key, child] of Object.entries(value)) {
      toFormState(child, path ? `${path}.${key}` : key, state)
    }
  } else if (path) {
    state[path] = { value }
  }
  return state
}

describe('page-builder blocks: sidebar parity', () => {
  const pick = (analysis: ReturnType<typeof analyzeSeo>) =>
    analysis.checks
      .filter((c) => c.group === 'headings' || c.id === 'content-wordcount')
      .map((c) => ({ id: c.id, status: c.status, message: c.message }))

  it('the sidebar and /validate derive the same headings and word count', () => {
    const fromValidate = analyzeSeo(buildSeoInputFromDoc(blockPage, 'pages'))
    const sidebar = buildSidebarContentInput(toFormState(blockPage))
    const fromSidebar = analyzeSeo({
      metaTitle: blockPage.meta.title,
      metaDescription: blockPage.meta.description,
      slug: blockPage.slug,
      ...sidebar,
    })

    expect(sidebar.blocks).toHaveLength(blockPage.layout.length)
    expect(pick(fromSidebar)).toEqual(pick(fromValidate))
    expect(fromSidebar.checks.find((c) => c.id === 'h1-missing')).toBeUndefined()
  })
})
