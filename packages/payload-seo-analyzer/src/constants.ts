/**
 * SEO Analyzer — Shared constants.
 * Centralizes thresholds, limits, and shared lists used across rule modules.
 * Importing from here ensures consistency and makes tuning easy.
 */

// ---------------------------------------------------------------------------
// Title & meta description lengths
// ---------------------------------------------------------------------------

export const TITLE_LENGTH_MIN = 30
export const TITLE_LENGTH_MAX = 60
export const META_DESC_LENGTH_MIN = 120
export const META_DESC_LENGTH_MAX = 160

// ---------------------------------------------------------------------------
// Content word-count thresholds (by page type)
// ---------------------------------------------------------------------------

export const MIN_WORDS_POST = 800
export const MIN_WORDS_FORM = 150
export const MIN_WORDS_LEGAL = 200
export const MIN_WORDS_GENERIC = 300
export const MIN_WORDS_THIN = 100

// Quality thresholds
export const MIN_WORDS_QUALITY_FAIL = 50
export const MIN_WORDS_QUALITY_WARN = 200

// Cornerstone / aging
// SEO desintox (2026): word count is NOT a ranking factor and there is no
// "magic" length. This threshold is a *thin-content floor* for pillar pages
// (flag genuinely thin pillars only), NOT a target that rewards padding.
// Lowered from the legacy 1500-word "comprehensive" myth to a conservative guard.
export const CORNERSTONE_MIN_WORDS = 600
export const THIN_AGING_MIN_WORDS = 500

// ---------------------------------------------------------------------------
// Keyword density (%)
// ---------------------------------------------------------------------------

export const KEYWORD_DENSITY_MAX = 3
export const KEYWORD_DENSITY_WARN = 2.5
/**
 * @deprecated SEO desintox (2026): keyword density is not a ranking factor, and a
 * minimum-density floor actively pushes toward keyword stuffing (penalised by
 * Google spam policies). No longer used for scoring — the density check now only
 * flags OVER-optimisation. Kept exported for backward compatibility.
 */
export const KEYWORD_DENSITY_MIN = 0.5

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export const ALT_TEXT_MIN_RATIO = 0.8
export const ALT_TEXT_MIN_LENGTH = 20

// ---------------------------------------------------------------------------
// Headings & structure
// ---------------------------------------------------------------------------

export const WORDS_PER_HEADING = 300
export const LONG_SECTION_THRESHOLD = 400

// ---------------------------------------------------------------------------
// Readability
// ---------------------------------------------------------------------------

export const FLESCH_SCORE_PASS = 60
export const FLESCH_SCORE_WARN = 40
export const LONG_SENTENCE_WORDS = 20
export const LONG_SENTENCE_MAX_RATIO = 0.3
export const LONG_PARAGRAPH_WORDS = 150
export const PASSIVE_VOICE_MAX_RATIO = 0.10
export const TRANSITION_WORDS_MIN_RATIO = 0.20
export const CONSECUTIVE_SAME_START_MAX = 3

// ---------------------------------------------------------------------------
// URL / slug
// ---------------------------------------------------------------------------

export const SLUG_MAX_LENGTH = 75

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------

export const SOCIAL_TITLE_MAX = 65
export const SOCIAL_DESC_MAX = 155

// ---------------------------------------------------------------------------
// Cornerstone
// ---------------------------------------------------------------------------

export const CORNERSTONE_MIN_INTERNAL_LINKS = 5

// ---------------------------------------------------------------------------
// Freshness (days)
// ---------------------------------------------------------------------------

export const MS_PER_DAY = 1000 * 60 * 60 * 24
export const FRESHNESS_DAYS_EVERGREEN = 730
export const FRESHNESS_DAYS_FAIL = 365
export const FRESHNESS_DAYS_WARN = 180
export const REVIEW_DAYS_WARN = 180

// ---------------------------------------------------------------------------
// Recursion safety
// ---------------------------------------------------------------------------

export const MAX_RECURSION_DEPTH = 50

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export const SCORE_EXCELLENT = 91
export const SCORE_GOOD = 71
export const SCORE_OK = 41
export const WARNING_MULTIPLIER = 0.5

// ---------------------------------------------------------------------------
// Shared word lists
// ---------------------------------------------------------------------------

/** Generic anchor texts that should be avoided in links */
export const GENERIC_ANCHORS: readonly string[] = ['click here', 'read more', 'here', 'more', 'learn more', 'this', 'link']

/** Regex patterns detecting placeholder content */
export const PLACEHOLDER_PATTERNS: RegExp[] = [
  /lorem ipsum/i,
  /\bTODO\b/,
  /\bTBD\b/,
  /\bFIXME\b/,
  /\bplaceholder\b/i,
  /\bXXX\b/,
  /\bcontent coming soon\b/i,
  /\bunder construction\b/i,
  /\btext here\b/i,
  /\bto be completed\b/i,
]

/** Standard utility page slugs where keyword-in-URL is not applicable */
export const UTILITY_SLUGS: readonly string[] = [
  'contact', 'about', 'about-us', 'sitemap', 'blog', 'accessibility',
  'cookies', 'support', 'faq', 'team', 'portfolio', 'pricing', 'careers', 'services',
]

/** Evergreen pages where freshness is less relevant */
export const EVERGREEN_SLUGS: readonly string[] = [
  'legal-notice', 'privacy-policy', 'terms', 'terms-of-service',
  'sitemap', 'contact', 'accessibility', 'cookies',
]

/** Stop words (for slug analysis) */
export const STOP_WORDS: readonly string[] = [
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
  'for', 'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were',
  'it', 'this', 'that', 'your', 'my', 'his', 'her',
]

/** Action verbs commonly used in CTAs */
export const ACTION_VERBS: readonly string[] = [
  'discover', 'get', 'try', 'download', 'book', 'order', 'sign up',
  'call', 'find', 'compare', 'calculate', 'estimate', 'explore',
  'start', 'transform', 'optimize', 'improve', 'boost', 'create',
  'join', 'access', 'simplify', 'receive', 'learn', 'save',
  'unlock', 'claim', 'request', 'schedule', 'browse',
]

/** Compound expressions where stop words are meaningful */
export const STOP_WORD_COMPOUNDS_MAP: ReadonlyArray<readonly [string, string]> = [
  ['in', 'the'],
  ['of', 'the'],
  ['on', 'the'],
  ['for', 'the'],
  ['at', 'the'],
]

/** Local SEO page slugs — empty by default, configure via SeoConfig.localSeoSlugs */
export const LOCAL_SEO_SLUGS: readonly string[] = []

/** Power words that boost CTR in titles */
export const POWER_WORDS: readonly string[] = [
  'free', 'exclusive', 'new', 'best', 'secret', 'ultimate',
  'essential', 'complete', 'fast', 'effective', 'simple', 'guaranteed',
  'proven', 'unique', 'must-have', 'revolutionary', 'indispensable',
  'exceptional', 'professional', 'expert', 'guide', 'tips', 'hack',
  'method', 'solution', 'results', 'easy', 'powerful', 'reliable', 'premium',
]

/** Legal page slugs (used by detectPageType) */
export const LEGAL_SLUGS_MAP: readonly string[] = [
  'legal', 'legal-notice', 'privacy-policy', 'privacy', 'terms',
  'terms-of-service', 'tos', 'terms-and-conditions', 'cookies',
  'accessibility', 'cookie-policy', 'gdpr',
]

// ---------------------------------------------------------------------------
// Readability thresholds
// ---------------------------------------------------------------------------

export const FLESCH_THRESHOLDS: { pass: number; warn: number } = {
  pass: FLESCH_SCORE_PASS,
  warn: FLESCH_SCORE_WARN,
}

export const READABILITY_THRESHOLDS: { longSentenceWords: number; passiveMax: number; transitionsMin: number } = {
  longSentenceWords: LONG_SENTENCE_WORDS,
  passiveMax: PASSIVE_VOICE_MAX_RATIO,
  transitionsMin: TRANSITION_WORDS_MIN_RATIO,
}

// ---------------------------------------------------------------------------
// Accessor helpers
// ---------------------------------------------------------------------------

export function getStopWords(): readonly string[] { return STOP_WORDS }
export function getActionVerbs(): readonly string[] { return ACTION_VERBS }
export function getPowerWords(): readonly string[] { return POWER_WORDS }
export function getGenericAnchors(): readonly string[] { return GENERIC_ANCHORS }
export function getLegalSlugs(): readonly string[] { return LEGAL_SLUGS_MAP }
export function getUtilitySlugs(): readonly string[] { return UTILITY_SLUGS }
export function getEvergreenSlugs(): readonly string[] { return EVERGREEN_SLUGS }
export function getStopWordCompounds(): ReadonlyArray<readonly [string, string]> { return STOP_WORD_COMPOUNDS_MAP }
