/**
 * "Analyse a document": the one place a Payload document (or global) becomes an SEO
 * analysis. Every server caller goes through here: `/validate`, the dashboard audit, the
 * score history, the indexation audit, keyword research, duplicate content, content grade
 * and the AI endpoints.
 *
 * Behind the interface:
 * - the read (`depth: 1`, with the caller's read access unless `overrideAccess`),
 * - the config (the plugin's, merged with the saved SeoSettings),
 * - the collection's `extractContent` extractor (looked up on the Payload instance),
 * - the Lexical depth (`maxRecursionDepth`, for the walker and the extractor alike),
 * - globals (no slug, no extractor: they have no URL and extractors are per collection),
 * - which rules run (`purpose`).
 *
 * The result carries the analysis with its `stats` and the body text, both from the walk
 * the rules read, so a word count or a readability score shown anywhere matches the checks.
 */
import type { Payload, PayloadRequest } from 'payload'
import { analyzeSeoWithContext } from '../analyzer.js'
import { MAX_RECURSION_DEPTH } from '../constants.js'
import type { RuleGroup, SeoAnalysis, SeoConfig, SeoInput } from '../types.js'
import type { ContentExtractorSource } from './contentExtractor.js'
import { contentInputFromDoc } from './docContentInput.js'
import { loadMergedConfig } from './loadMergedConfig.js'
import { readAccessOpts } from './readAccess.js'

/**
 * What the caller needs from the analysis, which decides the rules that run:
 * - `score`: every rule (`/validate`, score history, AI optimize).
 * - `audit`: every rule but the weight-0 `geo`, `eeat` and `hreflang` groups, which only
 *   feed the AI-readiness indicator and cost a recursive walk per block. Same score.
 * - `technical`: only the `technical` group, on the slug, canonical and robots fields
 *   (indexation audit). The stats and text are empty: the content is not read.
 * - `content`: no rules; the stats and the body text only (keyword research, duplicate
 *   content, content grade, AI rewrite and brief).
 */
export type AnalysisPurpose = 'score' | 'audit' | 'technical' | 'content'

/** A collection document or a global. */
export type DocumentTarget = { collection: string } | { global: string }

/** What to analyse: a document to read by id, a global to read, or one already read. */
export type DocumentRef =
  | { collection: string; id: string | number }
  | { collection: string; doc: Record<string, unknown> }
  | { global: string; doc?: Record<string, unknown> }

export interface DocumentAnalysis {
  /** The document as read (`depth: 1`), or as passed in. */
  doc: Record<string, unknown>
  /** The analyzer input mapped from it (the full input, also for `technical`). */
  input: SeoInput
  /** Score, checks and stats. No checks for `content`. */
  analysis: SeoAnalysis
  /** The body text the stats count (hero, blocks or extractor output, post content). */
  text: string
  /**
   * The page's words for term matching: the title, `meta.title` and `meta.description`, then
   * the body text. Content grade, keyword research, duplicate content and the AI prompts read
   * this (a query that only matches the title is covered); the stats count `text` only.
   */
  pageText: string
}

export interface AnalyzeDocumentOptions {
  purpose?: AnalysisPurpose
  /** The plugin's config, merged here with the saved SeoSettings (not read for `content`). */
  seoConfig?: SeoConfig
  /** A config already merged (a batch loads it once): skips the settings read. */
  mergedConfig?: SeoConfig
  /** Read without the caller's access (jobs, aggregate tools). Default: `readAccessOpts`. */
  overrideAccess?: boolean
  /** The locale to read. */
  locale?: string
}

/** Thrown when the document can't be read (missing, or no access); `cause` is Payload's error. */
export class DocumentReadError extends Error {
  constructor(ref: DocumentRef, cause: unknown) {
    super(
      'global' in ref ? `Global not found: ${ref.global}` : `Document not found: ${ref.collection}/${String((ref as { id?: unknown }).id)}`,
      { cause },
    )
    this.name = 'DocumentReadError'
  }
}

type AnalyzeRequest = { payload: Payload; user?: PayloadRequest['user'] }

/**
 * Read a document (unless `ref.doc` is given), merge the config and analyse it.
 * Throws `DocumentReadError` when the read fails.
 */
export async function analyzeDocument(
  req: AnalyzeRequest,
  ref: DocumentRef,
  options: AnalyzeDocumentOptions = {},
): Promise<DocumentAnalysis> {
  const doc = await readDocument(req, ref, options)
  // No rule runs for `content`, so the saved settings (rules, thresholds) change nothing.
  const config =
    options.mergedConfig ??
    (options.purpose === 'content'
      ? (options.seoConfig ?? {})
      : (await loadMergedConfig(req.payload, options.seoConfig)).config)
  return analyzeLoadedDocument(req.payload, doc, ref, { purpose: options.purpose, config })
}

/**
 * Analyse a document the caller already read (a batch scan, an `afterChange` hook), with a
 * config already merged. Synchronous, for the throttled audit loops.
 */
export function analyzeLoadedDocument(
  payload: ContentExtractorSource,
  doc: Record<string, unknown>,
  target: DocumentTarget,
  options: { purpose?: AnalysisPurpose; config?: SeoConfig } = {},
): DocumentAnalysis {
  const purpose = options.purpose ?? 'score'
  const config = options.config ?? {}
  const isGlobal = 'global' in target
  const input = buildSeoInputFromDoc(doc ?? {}, isGlobal ? `global:${target.global}` : target.collection, {
    isGlobal,
    extractors: isGlobal ? undefined : payload,
    maxDepth: config.maxRecursionDepth ?? MAX_RECURSION_DEPTH,
  })
  const disabled = PURPOSE_DISABLED_GROUPS[purpose]
  const { analysis, context } = analyzeSeoWithContext(
    purpose === 'technical' ? technicalOnlyInput(input) : input,
    disabled.length > 0
      ? { ...config, disabledRules: [...new Set([...(config.disabledRules ?? []), ...disabled])] }
      : config,
  )
  const text = context?.fullText.trim() ?? ''
  const title = typeof doc?.title === 'string' ? doc.title : ''
  const pageText = [title, input.metaTitle, input.metaDescription, text]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(' ')
    .trim()
  return { doc: doc ?? {}, input, analysis, text, pageText }
}

async function readDocument(
  req: AnalyzeRequest,
  ref: DocumentRef,
  options: AnalyzeDocumentOptions,
): Promise<Record<string, unknown>> {
  if ('doc' in ref && ref.doc) return ref.doc
  const access = options.overrideAccess ? { overrideAccess: true } : readAccessOpts(req as PayloadRequest)
  const locale = options.locale ? { locale: options.locale } : {}
  try {
    const doc =
      'global' in ref
        ? await req.payload.findGlobal({ slug: ref.global, depth: 1, ...access, ...locale })
        : await req.payload.findByID({
            collection: ref.collection,
            id: (ref as { id: string | number }).id,
            depth: 1,
            ...access,
            ...locale,
          })
    if (!doc) throw new Error('empty result')
    return doc as Record<string, unknown>
  } catch (error) {
    throw new DocumentReadError(ref, error)
  }
}

// ---------------------------------------------------------------------------
// Purposes
// ---------------------------------------------------------------------------

const ALL_GROUPS = Object.keys({
  title: 1,
  'meta-description': 1,
  url: 1,
  headings: 1,
  content: 1,
  images: 1,
  linking: 1,
  social: 1,
  schema: 1,
  readability: 1,
  quality: 1,
  'secondary-keywords': 1,
  cornerstone: 1,
  freshness: 1,
  technical: 1,
  accessibility: 1,
  ecommerce: 1,
  eeat: 1,
  geo: 1,
  hreflang: 1,
} satisfies Record<RuleGroup, 1>) as RuleGroup[]

const PURPOSE_DISABLED_GROUPS: Record<AnalysisPurpose, RuleGroup[]> = {
  score: [],
  audit: ['geo', 'eeat', 'hreflang'],
  technical: ALL_GROUPS.filter((g) => g !== 'technical'),
  content: ALL_GROUPS,
}

/**
 * The subset of the analyzer input the technical rules read. Dropping the content skips
 * the Lexical extraction in `buildContext`, which is most of the per-doc cost.
 */
export function technicalOnlyInput(input: SeoInput): SeoInput {
  return {
    slug: input.slug,
    canonicalUrl: input.canonicalUrl,
    robotsMeta: input.robotsMeta,
    isGlobal: input.isGlobal,
    isPost: input.isPost,
  }
}

// ---------------------------------------------------------------------------
// Document → SeoInput
// ---------------------------------------------------------------------------

/**
 * Build a SeoInput object from a Payload document (page or post). Exported from the
 * package for custom integrations; inside the plugin, use `analyzeDocument`.
 *
 * The content fields come from `contentInputFromDoc`, the mapping the sidebar shares, and
 * a collection's `extractContent` extractor (pass `extractors`: the map, or `req.payload`)
 * replaces the `layout` walk. A global (`isGlobal`) has no slug.
 */
export function buildSeoInputFromDoc(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  collection: string,
  options?: { isGlobal?: boolean; extractors?: ContentExtractorSource; maxDepth?: number },
): SeoInput {
  const meta = doc.meta || {}
  const isGlobal = options?.isGlobal ?? false
  const contentInput = contentInputFromDoc(doc, collection, {
    extractors: options?.extractors,
    maxDepth: options?.maxDepth,
  })

  // Canonical & robots — best-effort read from common field locations. Many sites
  // control indexation at the framework level (e.g. Next.js metadata), in which case
  // these stay undefined and the technical checks correctly stay silent.
  const canonicalUrl: string | undefined =
    (typeof meta.canonicalUrl === 'string' && meta.canonicalUrl) ||
    (typeof doc.canonicalUrl === 'string' && doc.canonicalUrl) ||
    undefined

  // E-E-A-T signals — best-effort author + dates from common Payload shapes.
  let author: string | undefined
  let authorUrl: string | undefined
  const populatedAuthors = doc.populatedAuthors
  if (Array.isArray(populatedAuthors) && populatedAuthors.length > 0) {
    const a = populatedAuthors[0] || {}
    author =
      (typeof a.name === 'string' && a.name) ||
      (typeof a.firstName === 'string' && a.firstName) ||
      undefined
    if (typeof a.url === 'string') authorUrl = a.url
  } else if (Array.isArray(doc.authors) && doc.authors.length > 0) {
    const a = doc.authors[0]
    if (a && typeof a === 'object' && typeof a.name === 'string') author = a.name
  } else if (typeof doc.author === 'string' && doc.author) {
    author = doc.author
  } else if (doc.author && typeof doc.author === 'object' && typeof doc.author.name === 'string') {
    author = doc.author.name
  }
  if (!authorUrl && typeof doc.authorUrl === 'string') authorUrl = doc.authorUrl

  const publishedAt: string | undefined =
    (typeof doc.publishedAt === 'string' && doc.publishedAt) ||
    (typeof doc.createdAt === 'string' && doc.createdAt) ||
    undefined
  const displayedDate: string | undefined =
    (typeof doc.publishedAt === 'string' && doc.publishedAt) ||
    (typeof doc.date === 'string' && doc.date) ||
    undefined

  // Locale alternates for hreflang — best-effort from common shapes (mono-locale → none).
  let localeAlternates: Array<{ hreflang: string; href: string }> | undefined
  const rawAlts = doc.localeAlternates || doc.alternates || doc.hreflang
  if (Array.isArray(rawAlts)) {
    const mapped = rawAlts
      .filter((a: unknown): a is Record<string, unknown> => !!a && typeof a === 'object')
      .map((a) => ({
        hreflang: String(a.hreflang || a.locale || a.lang || ''),
        href: String(a.href || a.url || ''),
      }))
      .filter((a) => a.hreflang && a.href)
    if (mapped.length > 0) localeAlternates = mapped
  }

  return {
    metaTitle: (meta.title as string) || '',
    metaDescription: (meta.description as string) || '',
    // Globals have no URL: a `slug` field on one is not a path.
    slug: isGlobal ? '' : (doc.slug as string) || '',
    focusKeyword: (doc.focusKeyword as string) || '',
    focusKeywords: Array.isArray(doc.focusKeywords)
      ? (doc.focusKeywords as Array<{ keyword?: string }>).map((k) => k.keyword || '').filter(Boolean)
      : undefined,
    ...contentInput,
    isCornerstone: !!doc.isCornerstone,
    updatedAt: (doc.updatedAt as string) || undefined,
    publishedAt,
    contentLastReviewed: (doc.contentLastReviewed as string) || undefined,
    displayedDate,
    author,
    authorUrl,
    localeAlternates,
    canonicalUrl,
    isGlobal,
  }
}
