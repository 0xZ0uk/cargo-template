/**
 * The content half of an `SeoInput`, read from a document: one mapping shared by
 * `buildSeoInputFromDoc` (`/validate`, the audit, score history) and the sidebar, so the
 * live score and the saved-document score read the same fields the same way.
 *
 * The document must be populated like `/validate` reads it (`depth: 1`) for uploads,
 * `reference` links and reusable sections to count. The sidebar gets that from
 * `/sidebar-content`, which populates the form's values on the server.
 *
 * Client-safe: no Payload runtime imports.
 */
import type { SeoInput } from '../types.js'
import { contentExtractorsOf, type ContentExtractorSource, extractDocBlocks } from './contentExtractor.js'

export type DocContentInput = Pick<
  SeoInput,
  | 'heroTitle'
  | 'heroRichText'
  | 'heroLinks'
  | 'heroMedia'
  | 'blocks'
  | 'blockContent'
  | 'content'
  | 'isPost'
  | 'metaImage'
  | 'robotsMeta'
>

/** The `SeoInput` keys `contentInputFromDoc` fills, e.g. to pick them out of a JSON response. */
export const DOC_CONTENT_INPUT_KEYS = [
  'heroTitle',
  'heroRichText',
  'heroLinks',
  'heroMedia',
  'blocks',
  'blockContent',
  'content',
  'isPost',
  'metaImage',
  'robotsMeta',
] as const satisfies ReadonlyArray<keyof DocContentInput>

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Robots directives from the common field locations: a raw `robots` string wins, else
 * the `noindex` / `nofollow` checkboxes (top level or in `meta`).
 */
export function robotsMetaFromDoc(doc: Record<string, unknown>): string | undefined {
  const meta = asRecord(doc.meta)
  const rawRobots =
    (typeof meta.robots === 'string' && meta.robots) || (typeof doc.robots === 'string' && doc.robots) || ''
  if (rawRobots) return rawRobots
  const directives: string[] = []
  if (doc.noindex === true || meta.noindex === true) directives.push('noindex')
  if (doc.nofollow === true || meta.nofollow === true) directives.push('nofollow')
  return directives.length > 0 ? directives.join(', ') : undefined
}

export interface ContentInputOptions {
  /** A collection's `extractContent` extractors (or the Payload instance holding them). */
  extractors?: ContentExtractorSource
  maxDepth?: number
}

/**
 * Maps a document to the analyzer's content fields. `collection` is the collection slug
 * (`posts` reads `title` as the h1 and `content` as the body).
 */
export function contentInputFromDoc(
  rawDoc: unknown,
  collection: string,
  options: ContentInputOptions = {},
): DocContentInput {
  const doc = asRecord(rawDoc)
  const meta = asRecord(doc.meta)
  const hero = asRecord(doc.hero)
  const isPost = collection === 'posts'

  // A collection with its own extractor: its output replaces the `layout` walk.
  const hasCustomExtractor = !!contentExtractorsOf(options.extractors)?.[collection]
  const blockContent = hasCustomExtractor
    ? extractDocBlocks(doc, { collection, extractors: options.extractors, maxDepth: options.maxDepth })
    : undefined

  return {
    heroTitle: isPost ? (typeof doc.title === 'string' ? doc.title : '') : undefined,
    heroRichText: hero.richText || undefined,
    heroLinks: Array.isArray(hero.links) ? hero.links : undefined,
    heroMedia: hero.media || undefined,
    blocks: Array.isArray(doc.layout) ? doc.layout : undefined,
    blockContent,
    content: isPost ? doc.content || undefined : undefined,
    isPost,
    metaImage: meta.image || undefined,
    robotsMeta: robotsMetaFromDoc(doc),
  }
}
