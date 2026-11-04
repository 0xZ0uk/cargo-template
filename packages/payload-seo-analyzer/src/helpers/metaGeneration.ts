/**
 * Shared meta generation helpers.
 * Used by /ai-generate, and as the fallback of /ai-rewrite and /ai-optimize.
 *
 * Heuristic meta title/description generation — no external AI API needed. The templates
 * follow the analysis locale (`fr` | `en`, default `fr` like the analyzer).
 */
import type { SeoLocale } from '../i18n.js'

// ---------------------------------------------------------------------------
// CTA prefixes for natural-sounding meta, per locale
// ---------------------------------------------------------------------------

export const TITLE_PREFIXES = [
  'Découvrez',
  'Guide',
  'Tout savoir sur',
  'Conseils pour',
  'Les clés pour',
]

export const DESC_PREFIXES = [
  'Découvrez',
  'Consultez notre guide sur',
  'Tout savoir sur',
  'Apprenez comment',
  'Explorez',
]

const META_TEMPLATES: Record<
  SeoLocale,
  { title: string[]; desc: string[]; titleSeparator: string; leadingArticle: RegExp }
> = {
  fr: {
    title: TITLE_PREFIXES,
    desc: DESC_PREFIXES,
    // French typography: a space before the colon.
    titleSeparator: ' : ',
    leadingArticle: /^(Le|La|Les|Un|Une|L'|D')\s*/i,
  },
  en: {
    title: ['Discover', 'Guide to', 'All about', 'Tips for', 'Keys to'],
    desc: ['Discover', 'Read our guide to', 'All about', 'Learn how', 'Explore'],
    titleSeparator: ': ',
    leadingArticle: /^(The|A|An)\s+/i,
  },
}

const templatesFor = (locale: SeoLocale | undefined) => META_TEMPLATES[locale === 'en' ? 'en' : 'fr']

// ---------------------------------------------------------------------------
// Text cleaning helpers
// ---------------------------------------------------------------------------

/** Strip HTML tags and normalize whitespace */
export function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Truncate to maxLen, keeping full words. Optionally append ellipsis. */
export function truncateWords(text: string, maxLen: number, ellipsis = false): string {
  if (text.length <= maxLen) return text

  const truncated = text.substring(0, maxLen)
  const lastSpace = truncated.lastIndexOf(' ')
  const result = lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated

  // Remove trailing punctuation fragments
  const cleaned = result.replace(/[,;:\-–—]\s*$/, '').trim()
  return ellipsis ? cleaned + '...' : cleaned
}

/** Extract significant sentences from content (skip very short ones <20 chars) */
export function extractSentences(content: string): string[] {
  const cleaned = cleanText(content)
  // Split on sentence boundaries
  const raw = cleaned.split(/(?<=[.!?])\s+/)
  return raw.filter((s) => s.trim().length >= 20)
}

/** Pick a random prefix from a list (deterministic based on slug hash) */
export function pickPrefix(prefixes: string[], slug: string): string {
  let hash = 0
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0
  }
  return prefixes[Math.abs(hash) % prefixes.length]!
}

// ---------------------------------------------------------------------------
// Meta title generation
// ---------------------------------------------------------------------------

export function generateMetaTitle(
  title: string,
  focusKeyword: string | undefined,
  slug: string,
  locale?: SeoLocale,
): string {
  const tpl = templatesFor(locale)
  if (!title || !title.trim()) {
    // Fallback: derive from slug
    const fromSlug = slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
    return truncateWords(fromSlug, 60)
  }

  let result = title.trim()

  // If focusKeyword is provided and not already in title, try to integrate it
  if (focusKeyword && focusKeyword.trim()) {
    const kwLower = focusKeyword.toLowerCase()
    const titleLower = result.toLowerCase()

    if (!titleLower.includes(kwLower)) {
      // Try prepending keyword with a separator
      const candidate = `${focusKeyword} — ${result}`
      if (candidate.length <= 60) {
        result = candidate
      } else {
        // Try adding a CTA prefix with keyword
        const prefix = pickPrefix(tpl.title, slug)
        const candidate2 = `${prefix} ${focusKeyword}`
        if (candidate2.length <= 60) {
          result = candidate2
        }
        // Otherwise keep original title
      }
    }
  }

  // If title is short enough, try adding a CTA prefix
  if (result.length < 40 && !tpl.title.some((p) => result.startsWith(p))) {
    const prefix = pickPrefix(tpl.title, slug)
    const candidate = `${prefix}${tpl.titleSeparator}${result}`
    if (candidate.length <= 60) {
      result = candidate
    }
  }

  return truncateWords(result, 60)
}

// ---------------------------------------------------------------------------
// Meta description generation
// ---------------------------------------------------------------------------

export function generateMetaDescription(
  content: string,
  focusKeyword: string | undefined,
  slug: string,
  locale?: SeoLocale,
): string {
  const tpl = templatesFor(locale)
  const sentences = extractSentences(content)

  if (sentences.length === 0) {
    // Fallback: use keyword or slug
    if (focusKeyword && focusKeyword.trim()) {
      const prefix = pickPrefix(tpl.desc, slug)
      return truncateWords(`${prefix} ${focusKeyword}.`, 160)
    }
    return ''
  }

  // Start building the description
  const prefix = pickPrefix(tpl.desc, slug)
  let desc = ''

  // Check if the first sentence already starts with a CTA-like word
  const firstSentenceLower = sentences[0]!.toLowerCase()
  const startsWithAction = tpl.desc.some((p) =>
    firstSentenceLower.startsWith(p.toLowerCase()),
  )

  if (startsWithAction) {
    // Use sentences directly
    desc = sentences[0]!
  } else {
    // Prepend a CTA prefix
    // Clean the first sentence: remove a leading article ("Le/La/Les…", "The/A/An") for
    // smoother flow after the prefix
    let firstClean = sentences[0]!
    const leadingArticle = firstClean.match(tpl.leadingArticle)
    if (leadingArticle) {
      firstClean = firstClean.substring(leadingArticle[0].length)
      // Lowercase the first char after article removal
      firstClean = firstClean.charAt(0).toLowerCase() + firstClean.slice(1)
    }

    desc = `${prefix} ${firstClean}`
  }

  // Try adding more sentences if there's room
  for (let i = 1; i < Math.min(sentences.length, 3); i++) {
    const candidate = `${desc} ${sentences[i]}`
    if (candidate.length > 160) break
    desc = candidate
  }

  // Include focusKeyword if not already present
  if (focusKeyword && focusKeyword.trim()) {
    const kwLower = focusKeyword.toLowerCase()
    if (!desc.toLowerCase().includes(kwLower)) {
      // Try appending keyword context
      const withKw = `${desc} ${focusKeyword}.`
      if (withKw.length <= 160) {
        desc = withKw
      }
    }
  }

  // Truncate to 160 chars
  if (desc.length > 160) {
    desc = truncateWords(desc, 157, true)
  }

  return desc
}
