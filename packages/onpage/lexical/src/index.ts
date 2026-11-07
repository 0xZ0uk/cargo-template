'use client'

/**
 * @shipment/onpage-lexical — inline rich-text editing for Payload's Lexical
 * richText fields.
 *
 *   <OnPageEditor editors={lexicalEditors} … />   // the Next adapter includes it by default
 *
 * Light by design: the Lexical editor itself (~75 KB gz with Lexical) loads
 * only when someone opens a rich-text field. It reads and writes Payload's
 * Lexical JSON; links keep Payload's shape, and nodes it doesn't edit
 * (uploads, blocks, relationships…) are kept as-is and shown as placeholders.
 * The editor component and its nodes are in `@shipment/onpage-lexical/editor`.
 */
import { defineEditor, type EditorRegistry } from '@shipment/onpage-react/editor-kit'
import { lazy } from 'react'

const InlineRichText = lazy(() =>
  import('./InlineRichText.tsx').then((m) => ({ default: m.InlineRichText })),
)

export const lexicalEditors: EditorRegistry = {
  richText: defineEditor({ mode: 'inline', accepts: ['richText'], component: InlineRichText }),
}

export {
  toEditorState,
  fromEditorState,
  plainText,
  isRichTextState,
  type RichTextState,
} from './convert.ts'
export { OPAQUE_TYPE } from './constants.ts'
