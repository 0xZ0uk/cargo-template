/**
 * Per-collection content extractors (the `extractContent` plugin option).
 *
 * The shape-based block walker (`extractBlocksContent`) reads a document's `layout` blocks.
 * An app whose content lives elsewhere, or that wants a block read differently, gives the
 * plugin a function per collection that returns the same `BlocksContent`. Every place the
 * walker reads a document goes through `extractDocBlocks`: the score (`/validate`, the
 * audit, score history), the sidebar (on the server, through `/sidebar-content`), the link
 * graph, the external-links scan and the FAQPage builder.
 *
 * The extractors live in the server-only `config.custom.seoAnalyzer.extractContent`; the
 * admin never receives the functions.
 */
import { type BlocksContent, emptyBlocksContent, extractBlocksContent } from './blockContent.js'

export interface SeoContentExtractorArgs {
  /** The document, populated as the caller read it (`depth: 1` for the score and the sidebar). */
  doc: Record<string, unknown>
  /** The collection slug the document belongs to. */
  collection: string
  /** Lexical traversal depth (the `maxRecursionDepth` setting). */
  maxDepth: number
  /** The built-in walker, to reuse for part of the document (e.g. `defaultExtract(doc.sections)`). */
  defaultExtract: (blocks: unknown) => BlocksContent
}

/**
 * Returns what a document's body contributes to the analysis. Fields left out of the
 * result count as empty. The upstream `hero` and post `content` fields are still read by
 * the analyzer itself, so leave them out of the result.
 */
export type SeoContentExtractor = (args: SeoContentExtractorArgs) => Partial<BlocksContent>

/** Extractors by collection slug. */
export type SeoContentExtractors = Partial<Record<string, SeoContentExtractor>>

/** Where to find a collection's extractor: the map itself, or a Payload instance holding it. */
export type ContentExtractorSource =
  | SeoContentExtractors
  | { config?: { custom?: Record<string, unknown> } }
  | null
  | undefined

function isPayloadLike(source: object): source is { config?: { custom?: Record<string, unknown> } } {
  return 'config' in source && !!(source as { config?: unknown }).config
}

/** The extractor map the plugin stored in the server-only `config.custom`. */
export function contentExtractorsOf(source: ContentExtractorSource): SeoContentExtractors | undefined {
  if (!source || typeof source !== 'object') return undefined
  if (isPayloadLike(source)) {
    const seo = source.config?.custom?.seoAnalyzer as { extractContent?: SeoContentExtractors } | undefined
    return seo?.extractContent
  }
  return source as SeoContentExtractors
}

/**
 * A stable fingerprint of the extractors, for the persisted cache keys: the audit,
 * indexation and sitemap-audit results depend on the function, so adding, removing or
 * changing one (its source) must not reuse an entry built without it. Sorted by collection,
 * so the order the map is written in doesn't matter. `undefined` without extractors, which
 * leaves the keys of apps that don't use the option as they were.
 */
export function fingerprintContentExtractors(extractors: SeoContentExtractors | undefined): string | undefined {
  const entries = Object.entries(extractors ?? {})
    .filter((entry): entry is [string, SeoContentExtractor] => typeof entry[1] === 'function')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  if (entries.length === 0) return undefined
  return entries.map(([collection, fn]) => `${collection}=${String(fn)}`).join('\n')
}

/** Fills the fields a custom extractor left out, so callers can rely on the full shape. */
export function normalizeBlocksContent(partial: Partial<BlocksContent> | null | undefined): BlocksContent {
  const base = emptyBlocksContent()
  if (!partial || typeof partial !== 'object') return base
  const images = partial.images
  return {
    text: Array.isArray(partial.text) ? partial.text : base.text,
    readability: Array.isArray(partial.readability)
      ? partial.readability
      : Array.isArray(partial.text)
        ? [...partial.text]
        : base.readability,
    headings: Array.isArray(partial.headings) ? partial.headings : base.headings,
    links: Array.isArray(partial.links) ? partial.links : base.links,
    images: {
      total: typeof images?.total === 'number' ? images.total : 0,
      withAlt: typeof images?.withAlt === 'number' ? images.withAlt : 0,
      altTexts: Array.isArray(images?.altTexts) ? images.altTexts : [],
    },
    media: Array.isArray(partial.media) ? partial.media : base.media,
    lexicalRoots: Array.isArray(partial.lexicalRoots) ? partial.lexicalRoots : base.lexicalRoots,
    hasFaq: partial.hasFaq === true || (Array.isArray(partial.faqPairs) && partial.faqPairs.length > 0),
    faqPairs: Array.isArray(partial.faqPairs) ? partial.faqPairs : base.faqPairs,
  }
}

export interface ExtractDocBlocksOptions {
  /** The document's collection; without it the built-in walker reads `doc.layout`. */
  collection?: string
  /** The extractors, or the Payload instance the plugin stored them on. */
  extractors?: ContentExtractorSource
  maxDepth?: number
}

/**
 * The block content of a document: the collection's extractor when the app supplied one,
 * else the shape-based walker over `doc.layout`.
 */
export function extractDocBlocks(
  doc: Record<string, unknown> | null | undefined,
  options: ExtractDocBlocksOptions = {},
): BlocksContent {
  const maxDepth = options.maxDepth ?? 10
  const source = doc && typeof doc === 'object' ? doc : {}
  const custom = options.collection ? contentExtractorsOf(options.extractors)?.[options.collection] : undefined
  if (!custom) return extractBlocksContent(source.layout, maxDepth)
  return normalizeBlocksContent(
    custom({
      doc: source,
      collection: options.collection as string,
      maxDepth,
      defaultExtract: (blocks) => extractBlocksContent(blocks, maxDepth),
    }),
  )
}
