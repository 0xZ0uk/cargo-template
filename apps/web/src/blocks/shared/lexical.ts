/**
 * Builders for Lexical JSON in block examples, so sample rich text stays readable.
 * Client-safe: no Lexical runtime imports.
 */
import type {
  SerializedEditorState,
  SerializedLexicalNode,
} from '@payloadcms/richtext-lexical/lexical'

const text = (value: string, format = 0) => ({
  type: 'text',
  detail: 0,
  format,
  mode: 'normal',
  style: '',
  text: value,
  version: 1,
})

const element = (type: string, children: SerializedLexicalNode[], extra = {}) => ({
  type,
  children,
  direction: 'ltr' as const,
  format: '' as const,
  indent: 0,
  version: 1,
  ...extra,
})

export const paragraph = (value: string) =>
  element('paragraph', [text(value)], { textFormat: 0, textStyle: '' })

/** Bold text (format 1) in its own paragraph. */
export const bold = (value: string) =>
  element('paragraph', [text(value, 1)], { textFormat: 1, textStyle: '' })

export const heading = (tag: 'h1' | 'h2' | 'h3' | 'h4', value: string) =>
  element('heading', [text(value)], { tag })

/** A list item: its text, or its text and a nested list (see `numberedList` / `bulletList`). */
export type ListItem = string | { text: string; list: SerializedLexicalNode }

const list = (listType: 'bullet' | 'number', items: ListItem[]) => {
  // Lexical numbers every `listitem`, nested-list wrappers included.
  const children: SerializedLexicalNode[] = []
  for (const item of items) {
    const { text: label, list: nested } = typeof item === 'string' ? { text: item } : item
    children.push(element('listitem', [text(label)], { value: children.length + 1 }))
    // A nested list sits in a `listitem` of its own, right after the item it belongs to.
    if (nested) children.push(element('listitem', [nested], { value: children.length + 1 }))
  }
  return element('list', children, {
    listType,
    start: 1,
    tag: listType === 'bullet' ? 'ul' : 'ol',
  })
}

export const bulletList = (...items: ListItem[]) => list('bullet', items)

export const numberedList = (...items: ListItem[]) => list('number', items)

/**
 * A whole rich-text value from block-level nodes. Typed by where it's used (the generated
 * types narrow each rich-text field to the nodes its editor allows).
 */
export const richText = <T = SerializedEditorState>(...children: SerializedLexicalNode[]): T =>
  ({ root: element('root', children) }) as unknown as T
