/**
 * Real Payload rich text (from Basic Pages: an upload node, a Payload link, a
 * long document of lists and headings) must survive a trip through the inline
 * editor unchanged. The one tolerated difference is `textFormat` on element
 * nodes — Lexical's cached "format of the next typed character", which has no
 * visible effect.
 */
import { describe, expect, it } from 'vitest'
import { $getRoot, $isElementNode, createEditor } from 'lexical'
import { RICH_TEXT_NODES } from '../nodeList.ts'
import { fromEditorState, hasOpaque, plainText, toEditorState, EMPTY_STATE } from '../convert.ts'
import { $createPayloadLinkNode, $isPayloadLinkNode } from '../nodes.tsx'
import { normalizeRichText } from '@shipment/onpage-core'
import fixtures from './fixtures.json'

const roundTrip = (state: unknown) => {
  const editor = createEditor({
    nodes: RICH_TEXT_NODES,
    onError: (e) => {
      throw e
    },
  })
  editor.setEditorState(editor.parseEditorState(JSON.stringify(toEditorState(state))))
  return {
    editor,
    out: fromEditorState(editor.getEditorState().toJSON()),
  }
}

const withoutTextFormat = (node: any): any => {
  if (Array.isArray(node)) return node.map(withoutTextFormat)
  if (!node || typeof node !== 'object') return node
  const { textFormat: _textFormat, ...rest } = node
  const isText = node.type === 'text'
  const out: any = isText ? { ...node } : rest
  for (const k of Object.keys(out)) out[k] = withoutTextFormat(out[k])
  return out
}

const collect = (node: any, type: string, acc: any[] = []): any[] => {
  if (node?.type === type) acc.push(node)
  ;(node?.children ?? []).forEach((c: any) => collect(c, type, acc))
  return acc
}

describe('rich text round trip', () => {
  for (const [name, state] of Object.entries(fixtures as Record<string, any>)) {
    it(`${name} comes back unchanged`, () => {
      const { out } = roundTrip(state)
      expect(withoutTextFormat(out)).toEqual(withoutTextFormat(state))
    })
  }

  it('keeps upload nodes byte-identical (carried as opaque)', () => {
    const state = (fixtures as any).withUpload
    const before = collect(state.root, 'upload')
    expect(before.length).toBeGreaterThan(0)
    expect(collect(roundTrip(state).out.root, 'upload')).toEqual(before)
  })

  it('keeps Payload link fields and ids', () => {
    const state = (fixtures as any).withLink
    const before = collect(state.root, 'link')
    expect(before[0]!.fields.linkType).toBeDefined()
    expect(collect(roundTrip(state).out.root, 'link')).toEqual(before)
  })

  it("writes new links in Payload's shape", () => {
    const { editor } = roundTrip(EMPTY_STATE)
    editor.update(
      () => {
        const p = $getRoot().getFirstChild()
        if (!$isElementNode(p)) throw new Error('no paragraph')
        const link = $createPayloadLinkNode({
          url: 'https://example.com',
          newTab: true,
          linkType: 'custom',
        })
        p.append(link)
      },
      { discrete: true },
    )
    const json = fromEditorState(editor.getEditorState().toJSON())
    const link = collect(json.root, 'link')[0]
    expect(link).toMatchObject({
      type: 'link',
      version: 3,
      fields: { url: 'https://example.com', newTab: true, linkType: 'custom' },
    })
    editor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChild()
      expect($isElementNode(paragraph) && $isPayloadLinkNode(paragraph.getFirstChild())).toBe(true)
    })
  })

  it('treats a missing value as an empty paragraph and reads plain text', () => {
    expect(toEditorState(null).root.children).toHaveLength(1)
    expect(plainText((fixtures as any).withLink).length).toBeGreaterThan(0)
  })

  it('normalizes populated relations inside rich text to ids for saving', () => {
    const state = {
      root: {
        type: 'root',
        children: [
          { type: 'upload', relationTo: 'media', value: { id: 42, url: '/a.jpg' } },
          {
            type: 'paragraph',
            children: [
              {
                type: 'link',
                fields: {
                  linkType: 'internal',
                  doc: { relationTo: 'posts', value: { id: 7, title: 'x' } },
                },
                children: [],
              },
            ],
          },
        ],
      },
    }
    const out: any = normalizeRichText(state)
    expect(out.root.children[0]!.value).toBe(42)
    expect(out.root.children[1]!.children[0]!.fields.doc).toEqual({ relationTo: 'posts', value: 7 })
    expect(state.root.children[0]!.value).toEqual({ id: 42, url: '/a.jpg' })
  })
})

describe('conversion edge cases', () => {
  it('never mutates the input or shares the empty paragraph between documents', () => {
    const input = { root: { type: 'root', version: 1, children: [] } }
    const snapshot = structuredClone(input)
    const a = toEditorState(input)
    const b = toEditorState({ root: { type: 'root', version: 1, children: [] } })
    expect(input).toEqual(snapshot)
    expect(a.root.children).not.toBe(b.root.children)
    expect(a.root.children).not.toBe(EMPTY_STATE.root.children)
  })
  it('treats only placeholder nodes as content, not empty editable blocks', () => {
    const blank = {
      root: {
        type: 'root',
        version: 1,
        children: [
          { type: 'heading', tag: 'h2', version: 1, children: [{ type: 'tab', version: 1 }] },
        ],
      },
    }
    expect(hasOpaque(blank)).toBe(false)
    const withUpload = {
      root: { type: 'root', version: 1, children: [{ type: 'upload', version: 3, value: 1 }] },
    }
    expect(hasOpaque(withUpload)).toBe(true)
  })
})
