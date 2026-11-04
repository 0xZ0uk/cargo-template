import { describe, expect, it } from 'vitest'
import type { Block, Field } from 'payload'
import { hasConditions, hiddenPaths } from '../conditions.ts'

/** Payload's website template link: type picks reference or url. */
const link: Field = {
  name: 'link',
  type: 'group',
  fields: [
    { name: 'type', type: 'radio', options: ['reference', 'custom'] },
    {
      name: 'reference',
      type: 'relationship',
      relationTo: 'pages',
      admin: {
        condition: (_: unknown, sibling: { type?: string }) => sibling.type === 'reference',
      },
    },
    {
      name: 'url',
      type: 'text',
      admin: { condition: (_: unknown, sibling: { type?: string }) => sibling.type === 'custom' },
    },
    { name: 'label', type: 'text' },
  ],
}

const cta: Block = { slug: 'cta', fields: [{ name: 'links', type: 'array', fields: [link] }] }

describe('field conditions', () => {
  it('finds the paths a condition hides, through groups, arrays, blocks and tabs', () => {
    const fields: Field[] = [
      { name: 'title', type: 'text' },
      {
        type: 'tabs',
        tabs: [
          {
            label: 'Content',
            fields: [{ name: 'layout', type: 'blocks', blocks: ['cta'] }],
          },
          { name: 'meta', fields: [link] },
        ],
      },
    ] as Field[]
    const doc = {
      title: 'Home',
      layout: [
        {
          blockType: 'cta',
          links: [{ link: { type: 'custom', url: '/x' } }, { link: { type: 'reference' } }],
        },
      ],
      meta: { link: { type: 'reference' } },
    }
    expect(hiddenPaths(fields, doc, { user: null, blocks: [cta] }).sort()).toEqual([
      'layout.0.links.0.link.reference',
      'layout.0.links.1.link.url',
      'meta.link.url',
    ])
    expect(hasConditions(fields, [cta])).toBe(true)
    expect(hasConditions([{ name: 'title', type: 'text' }] as Field[])).toBe(false)
  })
  it('passes data, siblingData, blockData, path and user, as Payload does', () => {
    const seen: unknown[] = []
    const fields = [
      {
        name: 'layout',
        type: 'blocks',
        blocks: [
          {
            slug: 'hero',
            fields: [
              {
                name: 'note',
                type: 'text',
                admin: {
                  condition: (data: unknown, sibling: unknown, ctx: unknown) => {
                    seen.push({ data, sibling, ctx })
                    return true
                  },
                },
              },
            ],
          },
        ],
      },
    ] as Field[]
    const row = { blockType: 'hero', note: 'n' }
    const doc = { layout: [row] }
    hiddenPaths(fields, doc, { user: { id: 1 } as never })
    expect(seen).toEqual([
      {
        data: doc,
        sibling: row,
        ctx: { blockData: row, operation: 'update', path: ['layout', 0, 'note'], user: { id: 1 } },
      },
    ])
  })
  it('a condition on a row or collapsible hides its fields; one that throws hides nothing', () => {
    const fields = [
      {
        type: 'row',
        admin: { condition: () => false },
        fields: [
          { name: 'a', type: 'text' },
          { name: 'b', type: 'text' },
        ],
      },
      {
        name: 'c',
        type: 'text',
        admin: {
          condition: () => {
            throw new Error('bad')
          },
        },
      },
    ] as Field[]
    expect(hiddenPaths(fields, {}, { user: null })).toEqual(['a', 'b'])
  })
})
