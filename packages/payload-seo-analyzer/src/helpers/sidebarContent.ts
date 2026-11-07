/**
 * The sidebar's reading of the edit form. Payload form state is reduced to a document
 * (`reduceFieldsToValues`, as the admin form itself does on submit) and mapped by
 * `seoInputFromDoc`, the mapping every server analysis uses.
 *
 * In form state, uploads, authors, `reference` links and reusable sections are IDs, and a
 * collection's `extractContent` function only exists on the server. So the sidebar posts the
 * reduced document to `/sidebar-content`, which populates it like `/validate` reads a saved
 * document and answers with the input and the effective config (`useSidebarContent`). The
 * local mapping is the first paint, the live reading of what the server echoes unchanged,
 * and the fallback when that request fails.
 */
import type { FormState } from 'payload'
import { reduceFieldsToValues } from 'payload/shared'

import { extractTextFromLexical } from '../helpers.js'
import type { SeoInput } from '../types.js'
import { extractBlocksContent } from './blockContent.js'

/** Form state reduced to the document the form would save. */
export function formStateToDoc(formFields: unknown): Record<string, unknown> {
  const doc = reduceFieldsToValues((formFields ?? {}) as FormState, true)
  return doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {}
}

/**
 * The fields of `server` that population changed: those that differ from `local`, the
 * client's own mapping of the same posted document. Fields the server only echoed (the meta
 * title, the slug, the keyword…) are left out, so they keep following the form while a newer
 * answer is on its way. A field the server left out comes back as `undefined`, so it still
 * replaces the local value. Derived from the mapping itself: no list of keys to keep.
 */
export function populatedFields(local: SeoInput, server: SeoInput): Partial<SeoInput> {
  const out: Record<string, unknown> = {}
  const keys = new Set([...Object.keys(local), ...Object.keys(server)]) as Set<keyof SeoInput>
  for (const key of keys) {
    if (JSON.stringify(local[key]) !== JSON.stringify(server[key])) out[key] = server[key]
  }
  return out as Partial<SeoInput>
}

/** Plain text of the page's content, for the internal-link suggestions and AI prompts. */
export function sidebarContentText(input: SeoInput): string {
  const parts: string[] = []
  if (input.heroRichText) parts.push(extractTextFromLexical(input.heroRichText))
  parts.push(...(input.blockContent ?? extractBlocksContent(input.blocks)).text)
  if (input.content) parts.push(extractTextFromLexical(input.content))
  return parts.join(' ')
}
