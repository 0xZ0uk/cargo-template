/**
 * The `extractContent` option (cargo-template #47): a collection's own extractor replaces the
 * block walker everywhere a document's content is read (score, sidebar mapping, link graph,
 * external links, FAQPage), and collections without one keep the walker.
 */
import { describe, expect, it } from 'vitest'

import { analyzeSeo } from '../index'
import { analyzeLoadedDocument, buildSeoInputFromDoc } from '../helpers/analyzeDocument'
import { extractDocExternalLinks } from '../endpoints/externalLinks'
import { buildJsonLd } from '../helpers/buildSchema'
import {
  contentExtractorsOf,
  extractDocBlocks,
  normalizeBlocksContent,
  type SeoContentExtractors,
} from '../helpers/contentExtractor'
import { contentInputFromDoc } from '../helpers/docContentInput'
import { extractAllInternalLinks } from '../helpers/linkExtractor'
import { pickDocContentInput } from '../helpers/sidebarContent'

const paragraph = (value: string) => ({ type: 'paragraph', children: [{ type: 'text', text: value }] })
const richText = (...children: unknown[]) => ({ root: { type: 'root', children } })

/** A collection whose content is not in `layout`: a `sections` array of `{ heading, body }`. */
const doc = {
  id: 7,
  title: 'Docs home',
  slug: 'docs-home',
  meta: { title: 'Docs home | Northwind', description: 'Read the Northwind docs.' },
  sections: [
    { heading: 'Getting started', body: 'Install the app and invite your team to the first project.' },
    { heading: 'Is there a free plan?', body: 'Yes, for up to three people.' },
  ],
  links: [
    { url: '/pricing', text: 'Pricing' },
    { url: 'https://status.example.com', text: 'Status' },
  ],
  // The walker would read this; the extractor ignores it.
  layout: [{ blockType: 'richText', richText: richText(paragraph('Walker-only words.')) }],
}

const extractors: SeoContentExtractors = {
  docs: ({ doc: d }) => {
    const sections = d.sections as Array<{ heading: string; body: string }>
    const links = d.links as Array<{ url: string; text: string }>
    return {
      text: sections.flatMap((s) => [s.heading, s.body]),
      headings: [{ tag: 'h1', text: 'Docs home' }, ...sections.map((s) => ({ tag: 'h2', text: s.heading }))],
      links,
      faqPairs: sections
        .filter((s) => s.heading.endsWith('?'))
        .map((s) => ({ question: s.heading, answer: s.body })),
    }
  },
}
const payload = { config: { custom: { seoAnalyzer: { extractContent: extractors } } } }

describe('extractContent: lookup and shape', () => {
  it('finds the extractors in the map or on the Payload instance', () => {
    expect(contentExtractorsOf(extractors)).toBe(extractors)
    expect(contentExtractorsOf(payload)).toBe(extractors)
    expect(contentExtractorsOf({ config: { custom: {} } })).toBeUndefined()
    expect(contentExtractorsOf(undefined)).toBeUndefined()
  })

  it('fills what an extractor leaves out, and derives readability parts and hasFaq', () => {
    const content = normalizeBlocksContent({ text: ['One.'], faqPairs: [{ question: 'Q?', answer: 'A' }] })
    expect(content.readability).toEqual(['One.'])
    expect(content.hasFaq).toBe(true)
    expect(content.images).toEqual({ total: 0, withAlt: 0, altTexts: [] })
    expect(content.links).toEqual([])
    expect(normalizeBlocksContent(null).text).toEqual([])
  })

  it('uses the walker for collections without an extractor, and without a collection', () => {
    expect(extractDocBlocks(doc, { collection: 'pages', extractors }).text).toEqual(['Walker-only words.'])
    expect(extractDocBlocks(doc, { extractors }).text).toEqual(['Walker-only words.'])
    expect(extractDocBlocks(doc, { collection: 'docs', extractors }).text).not.toContain('Walker-only words.')
  })

  it('hands the extractor the walker for part of the document', () => {
    const content = extractDocBlocks(
      { body: [{ blockType: 'richText', richText: richText(paragraph('Nested blocks.')) }] },
      { collection: 'wiki', extractors: { wiki: ({ doc: d, defaultExtract }) => defaultExtract(d.body) } },
    )
    expect(content.text).toEqual(['Nested blocks.'])
  })
})

describe('extractContent: every consumer', () => {
  it('the score reads the extractor (headings, words, FAQ) and not the walker', () => {
    const input = buildSeoInputFromDoc(doc, 'docs', { extractors: payload })
    expect(input.blockContent?.headings[0]).toEqual({ tag: 'h1', text: 'Docs home' })
    const checks = analyzeSeo(input).checks
    expect(checks.find((c) => c.id === 'h1-missing')).toBeUndefined()
    expect(checks.find((c) => c.id === 'h1-unique')?.status).toBe('pass')

    // Without the option, the same document is read through `layout`.
    const walked = buildSeoInputFromDoc(doc, 'docs')
    expect(walked.blockContent).toBeUndefined()
    expect(analyzeSeo(walked).checks.find((c) => c.id === 'h1-missing')?.status).toBe('fail')
  })

  it('the sidebar mapping is the score mapping (same input for the same document)', () => {
    const fromValidate = buildSeoInputFromDoc(doc, 'docs', { extractors: payload })
    const fromSidebar = contentInputFromDoc(doc, 'docs', { extractors: payload })
    for (const [key, value] of Object.entries(fromSidebar)) {
      expect(fromValidate[key as keyof typeof fromValidate], key).toEqual(value)
    }
    // What `/sidebar-content` returns survives the JSON round trip and the client's pick.
    expect(pickDocContentInput(JSON.parse(JSON.stringify(fromSidebar)))?.blockContent).toEqual(
      fromSidebar.blockContent,
    )
  })

  it('analyzeDocument (audit, score history, AI endpoints): score, stats and text', () => {
    const { text, analysis } = analyzeLoadedDocument(payload, doc, { collection: 'docs' })
    expect(text).toContain('Install the app')
    expect(text).not.toContain('Walker-only')
    expect(analysis.checks.find((c) => c.id === 'h1-unique')?.status).toBe('pass')
    expect(analysis.stats.h1Count).toBe(1)
  })

  it('the link graph and the external-links scan', () => {
    expect(extractAllInternalLinks(doc, { collection: 'docs', extractors: payload }).map((l) => l.slug)).toEqual([
      'pricing',
    ])
    expect(extractDocExternalLinks(doc, undefined, { collection: 'docs', extractors: payload })).toEqual([
      'https://status.example.com',
    ])
  })

  it('the FAQPage builder', () => {
    const { type, jsonLd } = buildJsonLd(doc, { collection: 'docs', siteUrl: 'https://example.com', extractors })
    expect(type).toBe('FAQPage')
    expect(jsonLd.mainEntity).toEqual([
      {
        '@type': 'Question',
        name: 'Is there a free plan?',
        acceptedAnswer: { '@type': 'Answer', text: 'Yes, for up to three people.' },
      },
    ])
    expect(buildJsonLd(doc, { collection: 'docs', siteUrl: 'https://example.com' }).type).not.toBe('FAQPage')
  })
})
