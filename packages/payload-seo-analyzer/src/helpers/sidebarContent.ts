/**
 * The sidebar's content input. Payload form state is reduced to a document
 * (`reduceFieldsToValues`, as the admin form itself does on submit) and mapped by
 * `contentInputFromDoc`, the same mapping `buildSeoInputFromDoc` uses for `/validate`.
 *
 * In form state, uploads, `reference` links and reusable sections are IDs, and a
 * collection's `extractContent` function only exists on the server. So the sidebar posts
 * the reduced document to `/sidebar-content`, which populates it like `/validate` reads a
 * saved document (`depth: 1`, the user's access) and maps it on the server
 * (`useSidebarContent`). The local mapping below is only the first paint, and the fallback
 * when that request fails.
 */
import type { FormState } from 'payload'
import { reduceFieldsToValues } from 'payload/shared'

import { extractTextFromLexical } from '../helpers.js'
import { extractBlocksContent } from './blockContent.js'
import {
  contentInputFromDoc,
  DOC_CONTENT_INPUT_KEYS,
  type DocContentInput,
  robotsMetaFromDoc,
} from './docContentInput.js'

export { robotsMetaFromDoc }

export type SidebarContentInput = DocContentInput

/** Form state reduced to the document the form would save. */
export function formStateToDoc(formFields: unknown): Record<string, unknown> {
  const doc = reduceFieldsToValues((formFields ?? {}) as FormState, true)
  return doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {}
}

/** The content input of the form as it stands, without populating anything (IDs stay IDs). */
export function buildSidebarContentInput(formFields: unknown, collection = ''): SidebarContentInput {
  return contentInputFromDoc(formStateToDoc(formFields), collection)
}

/** Keeps only the content-input keys of a `/sidebar-content` response. */
export function pickDocContentInput(value: unknown): SidebarContentInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of DOC_CONTENT_INPUT_KEYS) {
    if (source[key] !== undefined && source[key] !== null) out[key] = source[key]
  }
  return out as SidebarContentInput
}

/** Plain text of the page's content, for the internal-link suggestions and AI prompts. */
export function sidebarContentText(input: SidebarContentInput): string {
  const parts: string[] = []
  if (input.heroRichText) parts.push(extractTextFromLexical(input.heroRichText))
  parts.push(...(input.blockContent ?? extractBlocksContent(input.blocks)).text)
  if (input.content) parts.push(extractTextFromLexical(input.content))
  return parts.join(' ')
}
