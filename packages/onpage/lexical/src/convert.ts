/**
 * Payload rich text ⇄ the inline editor's Lexical state. Node types we edit go
 * through as-is; everything else is wrapped in an OpaqueNode on the way in and
 * unwrapped on the way out, byte-for-byte.
 */
import {
  eachLexicalNode,
  mapLexical,
  type LexicalNode,
  type LexicalState,
} from '@cargo/onpage-core'
import type { SerializedEditorState } from 'lexical'
import { OPAQUE_TYPE } from './constants.ts'

export const EDITABLE_NODE_TYPES = new Set([
  'root',
  'paragraph',
  'heading',
  'quote',
  'list',
  'listitem',
  'text',
  'linebreak',
  'tab',
  'link',
])

type Node = LexicalNode
export type RichTextState = LexicalState

export const EMPTY_STATE: RichTextState = {
  root: {
    type: 'root',
    version: 1,
    format: '',
    indent: 0,
    direction: null,
    children: [
      { type: 'paragraph', version: 1, format: '', indent: 0, direction: null, children: [] },
    ],
  },
}

// Hand-written (not mapLexical): it must stop descending at a node it wraps, so
// everything inside a placeholder stays byte-for-byte.
function wrap(node: Node): Node {
  if (!EDITABLE_NODE_TYPES.has(node.type)) return { type: OPAQUE_TYPE, version: 1, data: node }
  return Array.isArray(node.children) ? { ...node, children: node.children.map(wrap) } : node
}

export function isRichTextState(value: unknown): value is RichTextState {
  return (
    !!value && typeof value === 'object' && (value as Partial<RichTextState>).root?.type === 'root'
  )
}

export function toEditorState(value: unknown): RichTextState {
  const state = isRichTextState(value) ? value : EMPTY_STATE
  const root = wrap(state.root)
  // Lexical needs at least one block child to place a caret. Build a new root:
  // wrap() returns the input itself when there's nothing to wrap, and the empty
  // children must never be shared between documents.
  return root.children?.length
    ? { root }
    : { root: { ...root, children: structuredClone(EMPTY_STATE.root.children ?? []) } }
}

/**
 * The editor's state (`editorState.toJSON()`) back to Payload JSON, unwrapping
 * placeholders. Lexical's serialized types are closed interfaces, so they are
 * read through our open `LexicalState` here, once, instead of at every caller.
 */
export function fromEditorState(state: SerializedEditorState | RichTextState): RichTextState {
  const open = state as unknown as RichTextState
  return mapLexical(open, (n) => (n.type === OPAQUE_TYPE ? (n.data as Node) : n))
}

/** Plain text of a state (used to treat a blank editor as "no value"). */
export function plainText(state: RichTextState): string {
  const parts: string[] = []
  eachLexicalNode(state, (n) => {
    if (typeof n.text === 'string') parts.push(n.text)
  })
  return parts.join('').trim()
}

/** Does the value hold nodes the editor shows as placeholders (uploads, blocks…)? Then it isn't empty. */
export function hasOpaque(state: RichTextState): boolean {
  let found = false
  eachLexicalNode(state, (n) => {
    if (!EDITABLE_NODE_TYPES.has(n.type)) found = true
  })
  return found
}
