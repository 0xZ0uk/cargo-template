/**
 * Document → `SeoInput`: the one mapping from a Payload document (or global) to the
 * analyzer's input. `/validate`, the audit, score history (through `analyzeDocument`),
 * `/sidebar-content` and the sidebar's own first reading of the form all call it, so the
 * live score and the saved-document score read the same fields the same way.
 *
 * The document must be populated like `/validate` reads it (`depth: 1`) for uploads,
 * authors, `reference` links and reusable sections to count. The sidebar gets that from
 * `/sidebar-content`, which populates the form's values on the server.
 *
 * Client-safe: no Payload runtime imports.
 */
import type { SeoInput } from '../types.js'
import { contentExtractorsOf, type ContentExtractorSource, extractDocBlocks } from './contentExtractor.js'

/** A collection document or a global. */
export type DocumentTarget = { collection: string } | { global: string }

export interface SeoInputOptions {
  /** A collection's `extractContent` extractors (or the Payload instance holding them). Server only. */
  extractors?: ContentExtractorSource
  /** Lexical depth for the extractor (the `maxRecursionDepth` setting). */
  maxDepth?: number
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

/**
 * Robots directives from the common field locations: a raw `robots` string wins, else
 * the `noindex` / `nofollow` checkboxes (top level or in `meta`).
 */
export function robotsMetaFromDoc(doc: Record<string, unknown>): string | undefined {
  const meta = asRecord(doc.meta)
  const rawRobots = str(meta.robots) ?? str(doc.robots) ?? ''
  if (rawRobots) return rawRobots
  const directives: string[] = []
  if (doc.noindex === true || meta.noindex === true) directives.push('noindex')
  if (doc.nofollow === true || meta.nofollow === true) directives.push('nofollow')
  return directives.length > 0 ? directives.join(', ') : undefined
}

/** Author name and URL, best-effort from common Payload shapes (populated relations). */
function authorFromDoc(doc: Record<string, unknown>): { author?: string; authorUrl?: string } {
  let author: string | undefined
  let authorUrl: string | undefined
  const populatedAuthors = doc.populatedAuthors
  if (Array.isArray(populatedAuthors) && populatedAuthors.length > 0) {
    const a = asRecord(populatedAuthors[0])
    author = str(a.name) ?? str(a.firstName)
    if (typeof a.url === 'string') authorUrl = a.url
  } else if (Array.isArray(doc.authors) && doc.authors.length > 0) {
    author = str(asRecord(doc.authors[0]).name)
  } else if (typeof doc.author === 'string' && doc.author) {
    author = doc.author
  } else {
    author = str(asRecord(doc.author).name)
  }
  if (!authorUrl && typeof doc.authorUrl === 'string') authorUrl = doc.authorUrl
  return { author, authorUrl }
}

/** Locale alternates for hreflang, best-effort from common shapes (mono-locale → none). */
function localeAlternatesFromDoc(doc: Record<string, unknown>): SeoInput['localeAlternates'] {
  const rawAlts = doc.localeAlternates || doc.alternates || doc.hreflang
  if (!Array.isArray(rawAlts)) return undefined
  const mapped = rawAlts
    .filter((a: unknown): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      hreflang: String(a.hreflang || a.locale || a.lang || ''),
      href: String(a.href || a.url || ''),
    }))
    .filter((a) => a.hreflang && a.href)
  return mapped.length > 0 ? mapped : undefined
}

/**
 * Build a SeoInput object from a Payload document (page or post). Exported from the
 * package for custom integrations; inside the plugin, use `analyzeDocument` on the server
 * and `seoInputFromDoc` for a target.
 *
 * `collection` is the collection slug (`posts` reads `title` as the h1 and `content` as the
 * body). A collection's `extractContent` extractor (pass `extractors`: the map, or
 * `req.payload`) replaces the `layout` walk. A global (`isGlobal`) has no slug.
 */
export function buildSeoInputFromDoc(
  rawDoc: unknown,
  collection: string,
  options?: SeoInputOptions & { isGlobal?: boolean },
): SeoInput {
  const doc = asRecord(rawDoc)
  const meta = asRecord(doc.meta)
  const hero = asRecord(doc.hero)
  const isGlobal = options?.isGlobal ?? false
  const isPost = collection === 'posts'

  // A collection with its own extractor: its output replaces the `layout` walk.
  const hasCustomExtractor = !!contentExtractorsOf(options?.extractors)?.[collection]
  const blockContent = hasCustomExtractor
    ? extractDocBlocks(doc, { collection, extractors: options?.extractors, maxDepth: options?.maxDepth })
    : undefined

  // Canonical: best-effort from common field locations. Many sites control indexation at
  // the framework level (e.g. Next.js metadata), in which case it stays undefined and the
  // technical checks correctly stay silent.
  const canonicalUrl = str(meta.canonicalUrl) ?? str(doc.canonicalUrl)

  return {
    metaTitle: str(meta.title) ?? '',
    metaDescription: str(meta.description) ?? '',
    // Globals have no URL: a `slug` field on one is not a path.
    slug: isGlobal ? '' : (str(doc.slug) ?? ''),
    focusKeyword: str(doc.focusKeyword) ?? '',
    focusKeywords: Array.isArray(doc.focusKeywords)
      ? doc.focusKeywords.map((k) => str(asRecord(k).keyword) ?? '').filter(Boolean)
      : undefined,
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
    isCornerstone: !!doc.isCornerstone,
    updatedAt: str(doc.updatedAt),
    publishedAt: str(doc.publishedAt) ?? str(doc.createdAt),
    contentLastReviewed: str(doc.contentLastReviewed),
    displayedDate: str(doc.publishedAt) ?? str(doc.date),
    ...authorFromDoc(doc),
    localeAlternates: localeAlternatesFromDoc(doc),
    canonicalUrl,
    isGlobal,
  }
}

/**
 * The analyzer input for a document of `target`: the mapping above, with the collection key
 * and `isGlobal` derived from the target (globals have no extractor: they are per collection).
 */
export function seoInputFromDoc(doc: unknown, target: DocumentTarget, options: SeoInputOptions = {}): SeoInput {
  const isGlobal = 'global' in target
  return buildSeoInputFromDoc(doc ?? {}, isGlobal ? `global:${target.global}` : target.collection, {
    isGlobal,
    extractors: isGlobal ? undefined : options.extractors,
    maxDepth: options.maxDepth,
  })
}
