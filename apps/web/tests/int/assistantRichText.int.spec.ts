import type { Field, SanitizedConfig } from 'payload'

import {
  markdownLosses,
  SET_RICH_TEXT_TOOL_NAME,
  unsupportedMarkdown,
} from '@shipment/payload-plugin-assistant/mcp'
import { beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'

/**
 * Rich text as Markdown (#67) on the app's real schema: every collection with rich text gets the
 * Markdown tool, and what the real editors keep in a Markdown round trip (the package tests cover
 * the tool itself, on a fixture schema).
 */

type Converters = {
  fromMarkdown: (args: { markdown: string }) => unknown
  toMarkdown: (args: { data: unknown }) => string
}
type AnyField = Field & {
  name?: string
  editor?: { converters?: Converters }
  fields?: AnyField[]
  flattenedFields?: AnyField[]
  blocks?: Array<string | { slug: string; fields: AnyField[] }>
  blockReferences?: Array<string | { slug: string; fields: AnyField[] }>
  tabs?: Array<{ fields: AnyField[] }>
}

let sanitized: SanitizedConfig

beforeAll(async () => {
  sanitized = await config
})

const blockFields = (slug: string): AnyField[] =>
  ((sanitized.blocks ?? []).find((b) => b.slug === slug)?.fields ?? []) as AnyField[]

function hasRichText(fields: AnyField[], seen = new Set<unknown>()): boolean {
  return fields.some((field) => {
    if (field.type === 'richText') return true
    if (seen.has(field)) return false
    seen.add(field)
    const nested: AnyField[] = [
      ...(field.fields ?? []),
      ...(field.tabs ?? []).flatMap((tab) => tab.fields),
      ...[...(field.blocks ?? []), ...(field.blockReferences ?? [])].flatMap((b) =>
        typeof b === 'string' ? blockFields(b) : b.fields,
      ),
    ]
    return nested.length > 0 && hasRichText(nested, seen)
  })
}

const converters = (fields: AnyField[], name: string): Converters => {
  const field = fields.find((f) => f.name === name)
  if (!field?.editor?.converters) throw new Error(`no Lexical field ${name}`)
  return field.editor.converters
}

const roundTrip = (c: Converters, markdown: string) => {
  const state = c.fromMarkdown({ markdown })
  return { state, markdown: c.toMarkdown({ data: state }).trim() }
}

describe('Markdown rich text wiring', () => {
  it('every collection with rich text has setRichTextFromMarkdown', () => {
    const withRichText = sanitized.collections
      .filter((c) => !c.slug.startsWith('payload-') && hasRichText(c.fields as AnyField[]))
      .map((c) => c.slug)
      .sort()
    expect(withRichText).toEqual(['media', 'pages', 'sections'])
    const mcp = sanitized.plugins?.find(
      (p) => (p as { slug?: string }).slug === '@payloadcms/plugin-mcp',
    ) as
      | { options?: { collections?: Record<string, { tools?: Record<string, unknown> }> } }
      | undefined
    for (const slug of withRichText) {
      expect(mcp?.options?.collections?.[slug]?.tools?.[SET_RICH_TEXT_TOOL_NAME], slug).toBeTruthy()
    }
  })
})

describe("the app's editors in a Markdown round trip", () => {
  it('Rich text block: h1–h4, bold, italic and links survive', () => {
    const source =
      '# Title\n\n## Section\n\n### Sub\n\nSome **bold**, *italic* and a [link](https://example.com).'
    const { state, markdown } = roundTrip(converters(blockFields('richText'), 'richText'), source)
    expect(markdown).toBe(source)
    expect(unsupportedMarkdown(state)).toEqual([])
  })

  it('lists survive on every app editor: bulleted, numbered, nested', () => {
    const source = '- one\n- two\n    - nested\n\n1. first\n2. second'
    const faqItems = blockFields('faq').find((f) => f.name === 'items')!
    const featureRows = blockFields('featureRows').find((f) => f.name === 'rows')!
    const media = sanitized.collections.find((c) => c.slug === 'media')!
    const fields: Array<[string, Converters]> = [
      ['Rich text block', converters(blockFields('richText'), 'richText')],
      ['FAQ answer', converters(faqItems.fields!, 'answer')],
      ['Feature rows', converters(featureRows.fields!, 'richText')],
      ['Media caption', converters(media.fields as AnyField[], 'caption')],
    ]
    for (const [name, c] of fields) {
      const { state, markdown } = roundTrip(c, source)
      expect(markdown, name).toBe(source)
      expect(unsupportedMarkdown(state), name).toEqual([])
      const types = JSON.stringify(state)
      expect(types, name).toContain('"type":"list"')
      expect(types, name).toContain('"listType":"bullet"')
      expect(types, name).toContain('"listType":"number"')
    }
  })

  it('FAQ answers have no headings, and checklists are not enabled: kept as plain text, and detected', () => {
    const faqItems = blockFields('faq').find((f) => f.name === 'items')!
    const answer = converters(faqItems.fields!, 'answer')
    expect(unsupportedMarkdown(roundTrip(answer, '## Heading\n\nText').state)).toEqual([
      'h2 headings',
    ])
    const richText = converters(blockFields('richText'), 'richText')
    const checklist = roundTrip(richText, '- [ ] todo\n- [x] done').state
    expect(JSON.stringify(checklist)).not.toContain('"listType":"check"')
  })

  it('Media caption: bold, italic, links; underline (in the editor) is named as lost', () => {
    const media = sanitized.collections.find((c) => c.slug === 'media')!
    const caption = converters(media.fields as AnyField[], 'caption')
    expect(roundTrip(caption, 'A **bold** [credit](https://example.com)').markdown).toBe(
      'A **bold** [credit](https://example.com)',
    )
    const underlined = {
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', text: 'u', format: 8, version: 1 }],
          },
        ],
      },
    }
    expect(markdownLosses(underlined)).toEqual(['underline'])
  })
})
