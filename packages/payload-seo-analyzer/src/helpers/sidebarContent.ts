/**
 * The sidebar's content input: Payload form state reduced to a document
 * (`reduceFieldsToValues`, as the admin form itself does on submit), mapped to the same
 * `SeoInput` content fields `buildSeoInputFromDoc` reads. The blocks then go through the
 * shared walker in `buildContext`, so the live score sees what `/validate` sees.
 *
 * Uploads stay IDs in form state, so image checks only see populated media (follow-up).
 */
import type { FormState } from 'payload'
import { reduceFieldsToValues } from 'payload/shared'

import { extractTextFromLexical } from '../helpers.js'
import type { SeoInput } from '../types.js'
import { extractBlocksContent } from './blockContent.js'

export type SidebarContentInput = Pick<
  SeoInput,
  'heroTitle' | 'heroRichText' | 'heroLinks' | 'heroMedia' | 'blocks' | 'content' | 'isPost'
>

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function buildSidebarContentInput(formFields: unknown): SidebarContentInput {
  const doc = asRecord(reduceFieldsToValues(formFields as FormState, true))
  const hero = asRecord(doc.hero)

  const heroRichText = hero.richText || undefined
  const content = doc.content || undefined
  // Editing a post when the form has a `content` field (posts render `title` as the h1).
  const isPost = !!content

  let heroTitle: string | undefined
  if (isPost) {
    heroTitle = typeof doc.title === 'string' ? doc.title : undefined
  } else if (heroRichText) {
    const text = extractTextFromLexical(heroRichText).trim()
    if (text) heroTitle = text.split('\n')[0]
  }

  const heroLinks = Array.isArray(hero.links) && hero.links.length > 0 ? hero.links : undefined
  const blocks = Array.isArray(doc.layout) && doc.layout.length > 0 ? doc.layout : undefined

  return {
    heroTitle,
    heroRichText,
    heroLinks,
    heroMedia: hero.media || undefined,
    blocks,
    content,
    isPost,
  }
}

/** Plain text of the page's content, for the internal-link suggestions. */
export function sidebarContentText(input: SidebarContentInput): string {
  const parts: string[] = []
  if (input.heroRichText) parts.push(extractTextFromLexical(input.heroRichText))
  parts.push(...extractBlocksContent(input.blocks).text)
  if (input.content) parts.push(extractTextFromLexical(input.content))
  return parts.join(' ')
}
