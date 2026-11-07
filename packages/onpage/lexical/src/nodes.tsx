'use client'

/**
 * Lexical nodes for editing Payload rich text in place.
 *
 *  - PayloadLinkNode — Payload stores links as
 *      { type: "link", id, fields: { url, newTab, linkType, doc? }, children, … }
 *    (not @lexical/link's { url, rel, target }). This node reads and writes that
 *    shape, keeping `id` and every key in `fields`.
 *  - OpaqueNode — any node type we don't edit (upload, block, relationship,
 *    horizontalrule…) is carried through untouched and shown as a locked chip,
 *    so editing a paragraph never loses an image or embed.
 */
import React from 'react'
import { newRowId } from '@shipment/onpage-core'
import {
  DecoratorNode,
  ElementNode,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical'

export interface PayloadLinkFields {
  url?: string
  newTab?: boolean
  linkType?: string
  [key: string]: unknown
}

export type SerializedPayloadLinkNode = Spread<
  { type: 'link'; version: number; fields: PayloadLinkFields; id?: string },
  SerializedElementNode
>

export class PayloadLinkNode extends ElementNode {
  __fields: PayloadLinkFields
  __linkId: string | undefined

  static override getType(): string {
    return 'link'
  }

  static override clone(node: PayloadLinkNode): PayloadLinkNode {
    return new PayloadLinkNode({ ...node.__fields }, node.__linkId, node.__key)
  }

  constructor(fields: PayloadLinkFields = {}, id?: string, key?: NodeKey) {
    super(key)
    this.__fields = fields
    this.__linkId = id
  }

  override createDOM(): HTMLElement {
    const a = document.createElement('a')
    a.setAttribute('href', this.__fields.url || '#')
    if (this.__fields.newTab) {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    }
    a.addEventListener('click', (e) => e.preventDefault())
    return a
  }

  override updateDOM(prev: PayloadLinkNode, dom: HTMLElement): boolean {
    if (prev.__fields.url !== this.__fields.url) dom.setAttribute('href', this.__fields.url || '#')
    if (prev.__fields.newTab !== this.__fields.newTab) {
      if (this.__fields.newTab) {
        dom.setAttribute('target', '_blank')
        dom.setAttribute('rel', 'noopener noreferrer')
      } else {
        dom.removeAttribute('target')
        dom.removeAttribute('rel')
      }
    }
    return false
  }

  static override importJSON(json: SerializedPayloadLinkNode): PayloadLinkNode {
    // We always export version 3, which Payload expects to carry an id; it only
    // mints one itself when importing version 2. Give older links one here.
    return $createPayloadLinkNode(json.fields ?? {}, json.id || newRowId()).updateFromJSON(json)
  }

  override exportJSON(): SerializedPayloadLinkNode {
    const latest = this.getLatest()
    return {
      ...super.exportJSON(),
      type: 'link',
      version: 3,
      fields: { ...latest.__fields },
      ...(latest.__linkId ? { id: latest.__linkId } : {}),
    }
  }

  getFields(): PayloadLinkFields {
    return this.getLatest().__fields
  }

  setFields(fields: PayloadLinkFields): this {
    const writable = this.getWritable()
    writable.__fields = fields
    return writable
  }

  override isInline(): boolean {
    return true
  }

  override canBeEmpty(): boolean {
    return false
  }

  override canInsertTextBefore(): boolean {
    return false
  }

  override canInsertTextAfter(): boolean {
    return false
  }
}

export function $createPayloadLinkNode(fields: PayloadLinkFields, id?: string): PayloadLinkNode {
  return new PayloadLinkNode(fields, id)
}

export function $isPayloadLinkNode(node: LexicalNode | null | undefined): node is PayloadLinkNode {
  return node instanceof PayloadLinkNode
}

// ── Opaque ───────────────────────────────────────────────────────────────

import { OPAQUE_TYPE } from './constants.ts'

export { OPAQUE_TYPE }
const INLINE_TYPES = new Set(['inlineBlock', 'autolink'])

export type SerializedOpaqueNode = Spread<
  { type: typeof OPAQUE_TYPE; version: 1; data: OpaqueData },
  SerializedLexicalNode
>

/** The Payload node an OpaqueNode carries, untouched. */
export interface OpaqueData {
  type?: string
  value?: { filename?: unknown } | string | number
  fields?: { blockType?: unknown }
  [key: string]: unknown
}

export function describeNode(data: OpaqueData): string {
  const filename =
    typeof data.value === 'object' && typeof data.value?.filename === 'string'
      ? data.value.filename
      : ''
  const blockType = typeof data.fields?.blockType === 'string' ? data.fields.blockType : 'Block'
  switch (data.type) {
    case 'upload':
      return `Image${filename ? ` · ${filename}` : ''} — edit in admin`
    case 'horizontalrule':
      return 'Divider'
    case 'block':
    case 'inlineBlock':
      return `${blockType} — edit in admin`
    case 'relationship':
      return 'Linked document — edit in admin'
    default:
      return `${data.type ?? 'Content'} — edit in admin`
  }
}

export class OpaqueNode extends DecoratorNode<React.ReactNode> {
  __data: OpaqueData

  static override getType(): string {
    return OPAQUE_TYPE
  }

  static override clone(node: OpaqueNode): OpaqueNode {
    return new OpaqueNode(node.__data, node.__key)
  }

  constructor(data: OpaqueData, key?: NodeKey) {
    super(key)
    this.__data = data
  }

  override createDOM(): HTMLElement {
    return document.createElement(this.isInline() ? 'span' : 'div')
  }

  override updateDOM(): boolean {
    return false
  }

  override isInline(): boolean {
    return INLINE_TYPES.has(this.__data.type ?? '')
  }

  static override importJSON(json: SerializedOpaqueNode): OpaqueNode {
    return new OpaqueNode(json.data)
  }

  override exportJSON(): SerializedOpaqueNode {
    return { type: OPAQUE_TYPE, version: 1, data: this.getLatest().__data }
  }

  override decorate(): React.ReactNode {
    return (
      <span className="po-opaque" contentEditable={false} data-testid="onpage-opaque">
        ⧉ {describeNode(this.__data)}
      </span>
    )
  }
}
