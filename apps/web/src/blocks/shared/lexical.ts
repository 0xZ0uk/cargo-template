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

export const bulletList = (...items: string[]) =>
  element(
    'list',
    items.map((item, i) => element('listitem', [text(item)], { value: i + 1 })),
    { listType: 'bullet', start: 1, tag: 'ul' },
  )

/**
 * A whole rich-text value from block-level nodes. Typed by where it's used (the generated
 * types narrow each rich-text field to the nodes its editor allows).
 */
export const richText = <T = SerializedEditorState>(...children: SerializedLexicalNode[]): T =>
  ({ root: element('root', children) }) as unknown as T
