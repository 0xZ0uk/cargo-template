/**
 * SEO Rules — E-E-A-T signals (SEO 2026).
 *
 * Experience / Expertise / Authoritativeness / Trust is the #1 visibility lever in 2026,
 * but it is NOT a single algorithmic score. These checks detect on-page TRANSPARENCY
 * signals (attributed author, dates, cited sources, original data) — presented as good
 * practice, never as a guarantee of ranking. They are NON-SCORING in the SEO score
 * (weight 0) — E-E-A-T is a framework, not a direct ranking factor — and instead feed
 * the separate AI-readiness indicator (author/entity signals strongly affect AI citation).
 *
 * Translations are kept local (small) to avoid bloating the central i18n file.
 */
import type { SeoCheck, SeoInput, AnalysisContext } from '../types.js'

const STRINGS = {
  authorLabel: 'Attributed author (E-E-A-T)',
  authorPass: 'An author is attributed — good E-E-A-T transparency signal.',
  authorFail: 'No identified author — attribute a real author to strengthen trust (E-E-A-T).',
  authorTip: 'Add an author with a short bio and a link to their profile (Person schema + sameAs).',
  authorEntityLabel: 'Author entity (profile / sameAs)',
  authorEntityPass: 'The author has a profile link — strengthens the entity (sameAs) for search and AI.',
  authorEntityFail: 'The author has no profile link — add a URL (LinkedIn, author page) as sameAs.',
  aiAuthorEntityLabel: 'Verifiable author entity (AI-readiness)',
  aiAuthorEntityPass: 'The author points to a recognized profile URL (sameAs) — a verifiable entity, the top lever for AI citations.',
  aiAuthorEntityFail: 'The author link does not look like an entity profile (Wikidata, LinkedIn, ORCID, /author/…) — use a verifiable sameAs URL.',
  aiAuthorEntityTip: 'Tie the author to an unambiguous entity (Wikidata, LinkedIn, ORCID, Crunchbase or a dedicated author page): it is the #1 signal for being cited by AI engines.',
  aiEvidenceLabel: 'Original evidence + sources (AI-readiness)',
  aiEvidencePass: 'The content combines original/quantitative data AND cited external sources — the ideal profile to be quoted by AI engines.',
  aiEvidenceFail: 'Combine original data (figures, results) AND cited external sources — the combination is the most "quote-worthy" signal for AI engines.',
  aiEvidenceTip: 'AI engines preferentially cite content that brings first-hand data backed by verifiable sources.',
  datesLabel: 'Published / updated dates',
  datesPass: 'Published and modified dates available — good for freshness and trust.',
  datesFail: 'Published or modified date missing — expose datePublished and dateModified.',
  sourcesLabel: 'External sources cited',
  sourcesPass: (n: number) => `${n} link(s) to external sources — strengthens credibility and E-E-A-T.`,
  sourcesFail: 'No external source cited — link reliable sources to back your claims.',
  sourcesTip: 'Cite studies, official data or industry references with outbound links.',
  dataLabel: 'Original / quantitative data',
  dataPass: 'The content includes quantitative data — a signal of expertise and original content.',
  dataFail: 'Little quantitative data detected — add figures, statistics or concrete results.',
  dataTip: 'First-hand-experience content (data, figures, lived examples) is the #1 visibility lever in 2026.',
} as const

/** Page types where E-E-A-T author signals are not expected. */
const EEAT_SKIP_PAGE_TYPES = new Set(['legal', 'contact', 'form', 'home'])

/** Recognized entity / profile hosts that make an author URL a strong `sameAs` anchor. */
const PROFILE_HOST_RE =
  /(?:wikidata\.org|wikipedia\.org|linkedin\.com|crunchbase\.com|orcid\.org|github\.com|twitter\.com|x\.com|scholar\.google\.|researchgate\.net|muckrack\.com|about\.me|mastodon)/i

/** Path shapes that typically denote an author/profile page on a site. */
const PROFILE_PATH_RE = /\/(?:author|team|profile|about|members?|users?|u|a)\//i

/**
 * Whether an author URL looks like a verifiable entity profile (a real `sameAs` anchor),
 * not just any link. Offline heuristic — recognized entity host OR a profile-shaped path.
 */
function looksLikeProfileUrl(url: string): boolean {
  const u = url.trim()
  if (!/^https?:\/\//i.test(u)) return false
  return PROFILE_HOST_RE.test(u) || PROFILE_PATH_RE.test(u)
}

export function checkEeat(input: SeoInput, ctx: AnalysisContext): SeoCheck[] {
  const checks: SeoCheck[] = []

  // E-E-A-T is relevant for substantive content pages, not utility/legal pages.
  if (EEAT_SKIP_PAGE_TYPES.has(ctx.pageType) || ctx.wordCount < 100) return checks


  // 1. Attributed author
  const hasAuthor = !!(input.author && input.author.trim())
  checks.push({
    id: 'eeat-author',
    label: STRINGS.authorLabel,
    status: hasAuthor ? 'pass' : 'warning',
    message: hasAuthor ? STRINGS.authorPass : STRINGS.authorFail,
    category: 'important',
    weight: 0,
    group: 'eeat',
    ...(hasAuthor ? {} : { tip: STRINGS.authorTip }),
  })

  // 2. Author entity link (sameAs) — only meaningful when an author exists
  if (hasAuthor) {
    const hasLink = !!(input.authorUrl && input.authorUrl.trim())
    checks.push({
      id: 'eeat-author-entity',
      label: STRINGS.authorEntityLabel,
      status: hasLink ? 'pass' : 'warning',
      message: hasLink ? STRINGS.authorEntityPass : STRINGS.authorEntityFail,
      category: 'bonus',
      weight: 0,
      group: 'eeat',
    })

    // 2b. AI-readiness: the author URL is a VERIFIABLE entity profile (sameAs-grade),
    // not just any link. Non-scoring (weight 0) — feeds the AI-citation indicator.
    const verifiableEntity = hasLink && looksLikeProfileUrl(input.authorUrl!)
    checks.push({
      id: 'eeat-ai-author-entity',
      label: STRINGS.aiAuthorEntityLabel,
      status: verifiableEntity ? 'pass' : 'warning',
      message: verifiableEntity ? STRINGS.aiAuthorEntityPass : STRINGS.aiAuthorEntityFail,
      category: 'bonus',
      weight: 0,
      group: 'eeat',
      ...(verifiableEntity ? {} : { tip: STRINGS.aiAuthorEntityTip }),
    })
  }

  // 3. Published + modified dates
  const datesOk = !!input.publishedAt && !!input.updatedAt
  checks.push({
    id: 'eeat-dates',
    label: STRINGS.datesLabel,
    status: datesOk ? 'pass' : 'warning',
    message: datesOk ? STRINGS.datesPass : STRINGS.datesFail,
    category: 'bonus',
    weight: 0,
    group: 'eeat',
  })

  // 4. External sources / citations
  const externalLinks = ctx.allLinks.filter((l) => /^https?:\/\//i.test(l.url))
  const hasSources = externalLinks.length > 0
  checks.push({
    id: 'eeat-sources',
    label: STRINGS.sourcesLabel,
    status: hasSources ? 'pass' : 'warning',
    message: hasSources ? STRINGS.sourcesPass(externalLinks.length) : STRINGS.sourcesFail,
    category: 'bonus',
    weight: 0,
    group: 'eeat',
    ...(hasSources ? {} : { tip: STRINGS.sourcesTip }),
  })

  // 5. Original / quantitative data (heuristic: percentages or several numbers)
  const hasPercent = /\d+([.,]\d+)?\s?%/.test(ctx.fullText)
  const numberCount = (ctx.fullText.match(/\b\d{2,}\b/g) || []).length
  const hasData = hasPercent || numberCount >= 3
  checks.push({
    id: 'eeat-original-data',
    label: STRINGS.dataLabel,
    status: hasData ? 'pass' : 'warning',
    message: hasData ? STRINGS.dataPass : STRINGS.dataFail,
    category: 'bonus',
    weight: 0,
    group: 'eeat',
    ...(hasData ? {} : { tip: STRINGS.dataTip }),
  })

  // 6. AI-readiness: original data BACKED BY cited sources. The combination — first-hand
  // figures + verifiable references — is the most "quote-worthy" signal for AI answer
  // engines. Non-scoring (weight 0); feeds the AI-citation indicator only.
  const aiEvidence = hasData && hasSources
  checks.push({
    id: 'eeat-ai-evidence',
    label: STRINGS.aiEvidenceLabel,
    status: aiEvidence ? 'pass' : 'warning',
    message: aiEvidence ? STRINGS.aiEvidencePass : STRINGS.aiEvidenceFail,
    category: 'bonus',
    weight: 0,
    group: 'eeat',
    ...(aiEvidence ? {} : { tip: STRINGS.aiEvidenceTip }),
  })

  return checks
}
