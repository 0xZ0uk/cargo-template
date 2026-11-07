/**
 * "Analyse a document": the one place a Payload document (or global) becomes an SEO
 * analysis. Every server caller goes through here: `/validate`, the dashboard audit, the
 * score history, the indexation audit, keyword research, duplicate content, content grade
 * and the AI endpoints.
 *
 * Behind the interface:
 * - the read (`depth: 1`, with the caller's read access unless `overrideAccess`),
 * - the config (the plugin's, merged with the saved SeoSettings),
 * - the mapping to `SeoInput` (`seoInputFromDoc`, which the sidebar shares),
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
import { loadMergedConfig } from './loadMergedConfig.js'
import { readAccessOpts } from './readAccess.js'
import { type DocumentTarget, seoInputFromDoc } from './seoInputFromDoc.js'

export type { DocumentTarget }

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
  const input = documentInput(payload, doc, target, config)
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

/**
 * The analyzer input of a document already read, as every analysis maps it: the collection's
 * extractor from `payload`, the Lexical depth from `config`. `/sidebar-content` maps the
 * populated form with it, so the sidebar's input is `/validate`'s.
 */
export function documentInput(
  payload: ContentExtractorSource,
  doc: Record<string, unknown> | undefined,
  target: DocumentTarget,
  config: SeoConfig,
): SeoInput {
  return seoInputFromDoc(doc, target, {
    extractors: payload,
    maxDepth: config.maxRecursionDepth ?? MAX_RECURSION_DEPTH,
  })
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
