// @vitest-environment happy-dom
import { $getRoot, createEditor, type LexicalEditor } from 'lexical'
import { describe, expect, it } from 'vitest'
import { RICH_TEXT_NODES } from '../nodeList.ts'
import {
  $createPayloadLinkNode,
  $isPayloadLinkNode,
  OpaqueNode,
  PayloadLinkNode,
  describeNode,
} from '../nodes.tsx'
import * as editorEntry from '../editor.ts'
import { EDITABLE_NODE_TYPES } from '../convert.ts'

const editor = (): LexicalEditor =>
  createEditor({
    nodes: RICH_TEXT_NODES,
    onError: (e) => {
      throw e
    },
  })

describe('PayloadLinkNode', () => {
  it("renders an anchor, updates on change, and round-trips Payload's link JSON", () => {
    const ed = editor()
    ed.update(
      () => {
        const link = $createPayloadLinkNode(
          { url: '/about', newTab: true, linkType: 'custom' },
          'abc',
        )
        expect($isPayloadLinkNode(link)).toBe(true)
        expect(link.isInline()).toBe(true)
        expect(link.canBeEmpty()).toBe(false)
        const dom = link.createDOM()
        expect(dom.tagName).toBe('A')
        expect(dom.getAttribute('href')).toBe('/about')
        expect(dom.getAttribute('target')).toBe('_blank')
        const json = link.exportJSON()
        expect(json).toMatchObject({
          type: 'link',
          version: 3,
          id: 'abc',
          fields: { url: '/about', newTab: true, linkType: 'custom' },
        })
        const back = PayloadLinkNode.importJSON(json)
        expect(back.getFields()).toEqual(link.getFields())
        expect(PayloadLinkNode.clone(link).getFields()).toEqual(link.getFields())
        const changed = $createPayloadLinkNode({ url: '/x', newTab: false, linkType: 'custom' })
        expect(changed.updateDOM(link, dom)).toBe(false)
        expect(dom.getAttribute('href')).toBe('/x')
        expect(dom.hasAttribute('target')).toBe(false)
        $getRoot().clear()
      },
      { discrete: true },
    )
  })
})

describe('PayloadLinkNode ids', () => {
  it('gives a link from an older Payload version an id, since we export version 3', () => {
    const ed = editor()
    ed.update(
      () => {
        const old = PayloadLinkNode.importJSON({
          type: 'link',
          version: 2,
          fields: { url: '/a', linkType: 'custom' },
          children: [],
          direction: null,
          format: '',
          indent: 0,
        })
        const json = old.exportJSON()
        expect(json.version).toBe(3)
        expect(json.id).toMatch(/^[0-9a-f]{24}$/)
        $getRoot().clear()
      },
      { discrete: true },
    )
  })
})

describe('node registry', () => {
  it('lists every registered node type as editable, except the placeholder', () => {
    const types = RICH_TEXT_NODES.map((n) => n.getType()).filter((t) => t !== OpaqueNode.getType())
    for (const t of types) expect(EDITABLE_NODE_TYPES.has(t), t).toBe(true)
  })
})

describe('OpaqueNode', () => {
  it('keeps Payload nodes byte-for-byte and describes them', () => {
    const upload = { type: 'upload', value: { filename: 'a.png' }, relationTo: 'media' }
    const ed = editor()
    ed.update(
      () => {
        const node = OpaqueNode.importJSON({ type: 'onpage-opaque', version: 1, data: upload })
        expect(node.exportJSON().data).toEqual(upload)
        expect(node.isInline()).toBe(false)
        expect(node.createDOM().tagName).toBe('DIV')
        expect(node.updateDOM()).toBe(false)
        expect(OpaqueNode.clone(node).exportJSON().data).toEqual(upload)
      },
      { discrete: true },
    )
    expect(describeNode(upload)).toBe('Image · a.png — edit in admin')
    expect(describeNode({ type: 'block', fields: { blockType: 'cta' } })).toBe(
      'cta — edit in admin',
    )
    expect(describeNode({ type: 'horizontalrule' })).toBe('Divider')
    expect(describeNode({ type: 'relationship' })).toBe('Linked document — edit in admin')
    expect(describeNode({ type: 'custom' })).toBe('custom — edit in admin')
  })
  it('the editor entry exposes the component and nodes', () => {
    expect(typeof editorEntry.InlineRichText).toBe('function')
    expect(editorEntry.RICH_TEXT_NODES.length).toBeGreaterThan(3)
  })
})
