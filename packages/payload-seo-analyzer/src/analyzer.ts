/**
 * The analyzer core: builds the analysis context (one walk over the document's content),
 * runs every rule module and computes the score and the content stats.
 *
 * `analyzeSeo` is re-exported from the package entry. `analyzeSeoWithContext` is internal:
 * `helpers/analyzeDocument.ts` uses it to hand the extracted body text to the endpoints
 * that need it, without walking the document a second time.
 */

import type {
  SeoCheck,
  SeoLevel,
  SeoAnalysis,
  SeoInput,
  SeoConfig,
  AnalysisContext,
  RuleGroup,
  SeoContentStats,
} from './types'

import {
  extractTextFromLexical,
  extractHeadingsFromLexical,
  extractLinksFromLexical,
  extractImagesFromLexical,
  extractListsFromLexical,
  countWords,
  countSentences,
  calculateFlesch,
  normalizeForComparison,
  detectPageType,
} from './helpers'

import {
  SCORE_EXCELLENT,
  SCORE_GOOD,
  SCORE_OK,
  WARNING_MULTIPLIER,
  MAX_RECURSION_DEPTH,
} from './constants'

// Rule modules
import { checkTitle } from './rules/title'
import { checkMetaDescription } from './rules/meta-description'
import { checkUrl } from './rules/url'
import { checkHeadings } from './rules/headings'
import { checkContent } from './rules/content'
import { checkKeyphrase } from './rules/keyphrase'
import { checkImages } from './rules/images'
import { checkLinking } from './rules/linking'
import { checkSocial } from './rules/social'
import { checkSchema } from './rules/schema'
import { checkReadability } from './rules/readability'
import { checkQuality } from './rules/quality'
import { checkSecondaryKeywords } from './rules/secondary-keywords'
import { checkCornerstone } from './rules/cornerstone'
import { checkFreshness } from './rules/freshness'
import { checkTechnical } from './rules/technical'
import { checkAccessibility } from './rules/accessibility'
import { checkEcommerce } from './rules/ecommerce'
import { checkEeat } from './rules/eeat'
import { checkGeo } from './rules/geo'
import { checkHreflang } from './rules/hreflang'

// ---------------------------------------------------------------------------
// Payload link field extractor (shared module)
// ---------------------------------------------------------------------------

import { extractPayloadLink } from './helpers/linkExtractor.js'
import { extractBlocksContent } from './helpers/blockContent.js'

// ---------------------------------------------------------------------------
// Context builder — pre-computes data shared across rule modules
// ---------------------------------------------------------------------------

function buildContext(data: SeoInput, config: SeoConfig): AnalysisContext {
  const {
    heroRichText,
    blocks,
    content,
  } = data

  const maxDepth = config.maxRecursionDepth ?? MAX_RECURSION_DEPTH

  // Gather all text content
  let fullText = ''
  // Parallel extraction WITH sentence boundaries at block ends — used only for
  // readability metrics (Flesch + sentence segmentation), so scannable list-heavy
  // content isn't merged into one giant pseudo-sentence. fullText stays clean and
  // unchanged for word count and keyword density.
  let readabilityText = ''
  const allLinks: Array<{ url: string; text: string }> = []
  const allHeadings: Array<{ tag: string; text: string }> = []

  // Extract from hero richText
  if (heroRichText) {
    fullText += extractTextFromLexical(heroRichText, maxDepth) + ' '
    readabilityText += extractTextFromLexical(heroRichText, maxDepth, true) + ' '
    allLinks.push(...extractLinksFromLexical(heroRichText, maxDepth))
    allHeadings.push(...extractHeadingsFromLexical(heroRichText, maxDepth))
  }

  // Extract from hero CTA links (linkGroup)
  if (data.heroLinks && Array.isArray(data.heroLinks)) {
    for (const item of data.heroLinks) {
      if (item && typeof item === 'object') {
        const linkItem = item as Record<string, unknown>
        const linkData = extractPayloadLink(linkItem.link)
        if (linkData) allLinks.push(linkData)
      }
    }
  }

  // Extract from layout blocks (Pages): one shared walker, also used by the sidebar,
  // the rules that look at blocks and the link graph. A caller that already extracted
  // the body (a collection's `extractContent`, the sidebar's server read) passes it in.
  const blockContent = data.blockContent ?? extractBlocksContent(blocks, maxDepth)
  if (blockContent.text.length > 0) {
    fullText += blockContent.text.join(' ') + ' '
    readabilityText += blockContent.readability.join(' ') + ' '
  }
  allLinks.push(...blockContent.links)
  allHeadings.push(...blockContent.headings)

  // Extract from content (Posts — Lexical richText)
  if (content) {
    fullText += extractTextFromLexical(content, maxDepth) + ' '
    readabilityText += extractTextFromLexical(content, maxDepth, true) + ' '
    allLinks.push(...extractLinksFromLexical(content, maxDepth))
    allHeadings.push(...extractHeadingsFromLexical(content, maxDepth))
  }

  // For posts, the title field is rendered as H1 by PostHero — include it
  if (data.isPost && data.heroTitle) {
    const hasH1InContent = allHeadings.some((h) => h.tag === 'h1')
    if (!hasH1InContent) {
      allHeadings.unshift({ tag: 'h1', text: data.heroTitle })
      fullText = data.heroTitle + ' ' + fullText
      readabilityText = data.heroTitle + '. ' + readabilityText
    }
  }

  // Image stats
  const imageStats: { total: number; withAlt: number; altTexts: string[] } = {
    total: 0,
    withAlt: 0,
    altTexts: [],
  }

  imageStats.total += blockContent.images.total
  imageStats.withAlt += blockContent.images.withAlt
  imageStats.altTexts.push(...blockContent.images.altTexts)

  if (content) {
    const contentImgs = extractImagesFromLexical(content, maxDepth)
    imageStats.total += contentImgs.total
    imageStats.withAlt += contentImgs.withAlt
    imageStats.altTexts.push(...contentImgs.altTexts)
  }

  // Count hero media (background image in HighImpact/MediumImpact heroes)
  if (data.heroMedia && typeof data.heroMedia === 'object') {
    const hm = data.heroMedia as Record<string, unknown>
    if (hm.url || hm.filename) {
      imageStats.total++
      if (hm.alt && typeof hm.alt === 'string' && hm.alt.trim().length > 0) {
        imageStats.withAlt++
        imageStats.altTexts.push(hm.alt.trim())
      }
    }
  }

  // Count meta/OG image if present
  if (data.metaImage && typeof data.metaImage === 'object') {
    const mi = data.metaImage as Record<string, unknown>
    if (mi.url || mi.filename) {
      imageStats.total++
      if (mi.alt && typeof mi.alt === 'string' && mi.alt.trim().length > 0) {
        imageStats.withAlt++
        imageStats.altTexts.push(mi.alt.trim())
      }
    }
  }

  const wordCount = countWords(fullText)
  // Sentence segmentation uses the block-aware text so list-heavy content is not
  // collapsed into giant pseudo-sentences (which would wrongly tank Flesch + the
  // long-sentence ratio). Falls back to fullText when no block text was gathered.
  const readabilitySource = readabilityText.trim() ? readabilityText : fullText
  const sentences = countSentences(readabilitySource)

  // Build secondary normalised keywords (deduplicated, excluding primary)
  const primaryNormalized = data.focusKeyword ? normalizeForComparison(data.focusKeyword) : ''
  const secondaryNormalizedKeywords: string[] = []
  if (data.focusKeywords && Array.isArray(data.focusKeywords)) {
    for (const kw of data.focusKeywords) {
      const normalized = normalizeForComparison(kw)
      if (
        normalized &&
        normalized !== primaryNormalized &&
        !secondaryNormalizedKeywords.includes(normalized)
      ) {
        secondaryNormalizedKeywords.push(normalized)
      }
    }
  }

  return {
    fullText,
    readabilityText: readabilitySource,
    wordCount,
    normalizedKeyword: primaryNormalized,
    secondaryNormalizedKeywords,
    allHeadings,
    allLinks,
    imageStats,
    sentences,
    isPost: data.isPost ?? false,
    pageType: data.isPost
      ? 'blog'
      : detectPageType(data.slug || '', undefined, config.localSeoSlugs),
    config,
    blockContent,
  }
}

// ---------------------------------------------------------------------------
// Main analyzer
// ---------------------------------------------------------------------------

const EMPTY_STATS: SeoContentStats = {
  wordCount: 0,
  sentenceCount: 0,
  readabilityScore: 0,
  headingCount: 0,
  h1Count: 0,
  internalLinkCount: 0,
  externalLinkCount: 0,
  imageCount: 0,
  imagesWithAlt: 0,
}

/** The counts the dashboard, the score history and the sidebar show, from the context. */
function statsFromContext(ctx: AnalysisContext): SeoContentStats {
  let externalLinkCount = 0
  for (const link of ctx.allLinks) if (link.url.startsWith('http')) externalLinkCount++
  return {
    wordCount: ctx.wordCount,
    sentenceCount: ctx.sentences.length,
    // Same formula as the readability rule; too short a text has no meaningful score.
    readabilityScore: ctx.wordCount > 30 ? calculateFlesch(ctx.readabilityText) : 0,
    headingCount: ctx.allHeadings.length,
    h1Count: ctx.allHeadings.filter((h) => h.tag === 'h1').length,
    internalLinkCount: ctx.allLinks.length - externalLinkCount,
    externalLinkCount,
    imageCount: ctx.imageStats.total,
    imagesWithAlt: ctx.imageStats.withAlt,
  }
}

export function analyzeSeo(data: SeoInput, config?: SeoConfig): SeoAnalysis {
  return analyzeSeoWithContext(data, config).analysis
}

/**
 * `analyzeSeo`, plus the context the rules read (the extracted body text, headings and
 * links). Internal: `helpers/analyzeDocument.ts` hands the text to the endpoints that need it.
 */
export function analyzeSeoWithContext(
  data: SeoInput,
  config?: SeoConfig,
): { analysis: SeoAnalysis; context: AnalysisContext | null } {
  // Input validation — ensure we have a usable object
  if (!data || typeof data !== 'object') {
    return { analysis: { score: 0, level: 'poor', checks: [], stats: { ...EMPTY_STATS } }, context: null }
  }

  // Merge config with defaults
  const mergedConfig: SeoConfig = {
    maxRecursionDepth: MAX_RECURSION_DEPTH,
    ...config,
  }

  const ctx = buildContext(data, mergedConfig)

  const disabled = new Set<RuleGroup>(mergedConfig.disabledRules || [])

  // Map rule groups to their check functions
  const ruleModules: Array<{ group: RuleGroup; fn: (i: SeoInput, c: AnalysisContext) => SeoCheck[] }> = [
    { group: 'title', fn: checkTitle },
    { group: 'meta-description', fn: checkMetaDescription },
    { group: 'url', fn: checkUrl },
    { group: 'headings', fn: checkHeadings },
    { group: 'content', fn: checkContent },
    { group: 'content', fn: checkKeyphrase },
    { group: 'images', fn: checkImages },
    { group: 'linking', fn: checkLinking },
    { group: 'social', fn: checkSocial },
    { group: 'schema', fn: checkSchema },
    { group: 'readability', fn: checkReadability },
    { group: 'quality', fn: checkQuality },
    { group: 'secondary-keywords', fn: checkSecondaryKeywords },
    { group: 'cornerstone', fn: checkCornerstone },
    { group: 'freshness', fn: checkFreshness },
    { group: 'technical', fn: checkTechnical },
    { group: 'accessibility', fn: checkAccessibility },
    { group: 'eeat', fn: checkEeat },
    { group: 'geo', fn: checkGeo },
    { group: 'hreflang', fn: checkHreflang },
    // E-commerce rules only run for product pages
    ...(data.isProduct ? [{ group: 'ecommerce' as RuleGroup, fn: checkEcommerce }] : []),
  ]

  // Run all rule modules (skip disabled groups)
  const checks: SeoCheck[] = []
  const weightOverrides = mergedConfig.overrideWeights

  for (const { group, fn } of ruleModules) {
    if (disabled.has(group)) continue
    const moduleChecks = fn(data, ctx)

    // Apply weight overrides if configured
    if (weightOverrides && weightOverrides[group] !== undefined) {
      const overrideWeight = weightOverrides[group]!
      for (const check of moduleChecks) {
        check.weight = overrideWeight
      }
    }

    checks.push(...moduleChecks)
  }

  // =========================================================================
  // Score calculation
  //
  // Algorithm:
  //   Each check contributes `weight` points to the total.
  //   - pass    → earns 100% of weight
  //   - warning → earns WARNING_MULTIPLIER (50%) of weight
  //   - fail    → earns 0
  //   score = round(earnedPoints / maxPoints * 100)
  //
  // Level thresholds:
  //   >= SCORE_EXCELLENT (91) → 'excellent'
  //   >= SCORE_GOOD      (71) → 'good'
  //   >= SCORE_OK         (41) → 'ok'
  //   < SCORE_OK               → 'poor'
  // =========================================================================

  let earnedPoints = 0
  let maxPoints = 0

  for (const check of checks) {
    maxPoints += check.weight
    if (check.status === 'pass') {
      earnedPoints += check.weight
    } else if (check.status === 'warning') {
      earnedPoints += check.weight * WARNING_MULTIPLIER
    }
    // fail = 0
  }

  const score = maxPoints > 0 ? Math.round((earnedPoints / maxPoints) * 100) : 0

  let level: SeoLevel = 'poor'
  if (score >= SCORE_EXCELLENT) level = 'excellent'
  else if (score >= SCORE_GOOD) level = 'good'
  else if (score >= SCORE_OK) level = 'ok'

  // ---- AI-readiness sub-score (SEO 2026) ----
  // Aggregated from GEO + E-E-A-T checks and the schema-coverage check using check
  // STATUS (pass=1, warning=WARNING_MULTIPLIER, fail=0) with equal weight. These checks
  // are weight 0 in the SEO score on purpose (ranking vs AI-citation are different
  // signals) — they are scored separately here as a distinct indicator.
  const aiChecks = checks.filter(
    (c) => c.group === 'geo' || c.group === 'eeat' || c.id === 'schema-coverage',
  )
  let aiReadiness: SeoAnalysis['aiReadiness']
  if (aiChecks.length > 0) {
    let aiEarned = 0
    for (const c of aiChecks) {
      if (c.status === 'pass') aiEarned += 1
      else if (c.status === 'warning') aiEarned += WARNING_MULTIPLIER
    }
    const aiScore = Math.round((aiEarned / aiChecks.length) * 100)
    let aiLevel: SeoLevel = 'poor'
    if (aiScore >= SCORE_EXCELLENT) aiLevel = 'excellent'
    else if (aiScore >= SCORE_GOOD) aiLevel = 'good'
    else if (aiScore >= SCORE_OK) aiLevel = 'ok'
    aiReadiness = { score: aiScore, level: aiLevel, checkCount: aiChecks.length }
  }

  return {
    analysis: { score, level, checks, ...(aiReadiness ? { aiReadiness } : {}), stats: statsFromContext(ctx) },
    context: ctx,
  }
}
