/**
 * SEO Analyzer — Main orchestrator.
 * Imports all rule modules, builds the analysis context, runs every check,
 * and computes the final score.
 *
 * Public API:
 *   analyzeSeo(data: SeoInput, config?: SeoConfig): SeoAnalysis
 *
 * All types and useful helpers are re-exported for convenience.
 */

// Re-export types
export type {
  CheckStatus,
  CheckCategory,
  RuleGroup,
  SeoCheck,
  SeoLevel,
  SeoAnalysis,
  SeoContentStats,
  SeoInput,
  AnalysisContext,
  PageType,
  SeoConfig,
  SeoThresholds,
  SeoFeatures,
  SeoExcludeDocs,
} from './types'

// Re-export helpers for external consumers
export {
  extractTextFromLexical,
  extractHeadingsFromLexical,
  extractLinksFromLexical,
  extractImagesFromLexical,
  extractLinkUrlsFromLexical,
  extractListsFromLexical,
  checkImagesInBlocks,
  normalizeForComparison,
  slugifyKeyword,
  keywordMatchesText,
  countKeywordOccurrences,
  countWords,
  countSentences,
  calculateFlesch,
  countSyllablesEN,
  detectPassiveVoice,
  hasTransitionWord,
  checkHeadingHierarchy,
  countLongSections,
  detectPageType,
  isStopWordInCompoundExpression,
} from './helpers'

// Re-export plugin
export { seoAnalyzerPlugin, seoPlugin } from './plugin.js'
export type { SeoPluginConfig, GenerateFnArgs } from './plugin.js'

// Re-export field definitions
export { seoFields } from './fields.js'
export { metaFields } from './metaFields.js'
export type { MetaFieldsConfig } from './metaFields.js'

// Re-export helpers
export { fetchAllDocs } from './helpers/fetchAllDocs.js'
export type { FetchedDoc, FetchAllDocsOptions, DocSourceType } from './helpers/fetchAllDocs.js'

// Document → analyzer input (the mapping `/validate`, the audit and score history use)
export { buildSeoInputFromDoc } from './helpers/seoInputFromDoc.js'

// Content extraction: the block walker and the `extractContent` option's types
export { extractBlocksContent } from './helpers/blockContent.js'
export type { BlocksContent } from './helpers/blockContent.js'
export { extractDocBlocks } from './helpers/contentExtractor.js'
export type {
  SeoContentExtractor,
  SeoContentExtractorArgs,
  SeoContentExtractors,
} from './helpers/contentExtractor.js'

// Frontend SEO render helpers (SEO 2026) — produce the actual <head> metadata + JSON-LD,
// not just analyze it. Pure functions, safe to call in Next.js generateMetadata / Server Components.
export { buildSeoMetadata } from './helpers/buildMetadata.js'
// Public URL construction — exported so a host can build the same URLs the
// sitemap, the canonical and the JSON-LD use.
export { buildDocPath, buildDocUrl, DEFAULT_COLLECTION_ROUTES } from './helpers/docUrl.js'
export type { CollectionRoutes } from './helpers/docUrl.js'
export type { SeoMetadata, SeoMetadataOptions } from './helpers/buildMetadata.js'
export {
  buildJsonLd,
  renderJsonLdScript,
  serializeJsonLd,
  detectSchemaType,
  getSchemaImageUrl,
  SCHEMA_TYPES,
} from './helpers/buildSchema.js'
export type { SchemaType, BuildJsonLdOptions } from './helpers/buildSchema.js'
export { createHistoryHandler } from './endpoints/history.js'
export { createSitemapAuditHandler } from './endpoints/sitemap-audit.js'
// Build-time audit cache: generate the site-wide audit JSON at CI time, hydrate it in prod.
// Node/filesystem only: ignored (with a warning) when `cacheStore` is set or on Workers.
export { buildAuditToFile } from './endpoints/audit.js'
// Pluggable persistent cache (`cacheStore` / `waitUntil` plugin options).
// Shared rate limiting (`rateLimit` plugin option).
export type { SeoCacheStore, SeoWaitUntil } from './cache.js'
export { SEO_RATE_LIMITS } from './rateLimiter.js'
export type { SeoRateLimit, SeoRateLimitBucket } from './rateLimiter.js'
// The AI client's defaults (OpenRouter, `features.aiFeatures`).
export { DEFAULT_AI_BASE_URL, DEFAULT_AI_MODEL } from './helpers/aiClient.js'
export { runSeoJobs, SEO_JOBS_QUEUE, SEO_TASK_SLUGS } from './jobs.js'
export type { SeoJobsOptions } from './jobs.js'

// Re-export collection + hook for advanced consumers
export { createSeoScoreHistoryCollection } from './collections/SeoScoreHistory.js'
export { createSeoPerformanceCollection } from './collections/SeoPerformance.js'
export { createTrackSeoScoreHook } from './hooks/trackSeoScore.js'

// Re-export new endpoint creators
export { createPerformanceHandler } from './endpoints/performance.js'
export { createKeywordResearchHandler } from './endpoints/keywordResearch.js'
export { createGenerateHandler } from './endpoints/generate.js'
export { createSchemaGeneratorHandler } from './endpoints/schemaGenerator.js'
export { createRedirectChainsHandler } from './endpoints/redirectChains.js'
export { createDuplicateContentHandler } from './endpoints/duplicateContent.js'
export { createAiRewriteHandler } from './endpoints/aiRewrite.js'

// Retention — the purge helpers, for a host that would rather run the trim from
// its own cron than let the plugin schedule it.
export {
  purgeRetention,
  describeRetention,
  resolveRetention,
  RETENTION_TARGETS,
  RETENTION_DEFAULTS,
} from './retention.js'
export type { RetentionConfig, RetentionCollection, RetentionMaxRows, PurgeResult } from './retention.js'

// Time-series data store (`dataStore` plugin option): score history, performance imports,
// rank history and 404 logs. `createSqlSeoDataStore` takes a D1 binding (or any D1-shaped
// SQLite wrapper) and manages its own schema; `migrateSeoStore` applies it ahead of time.
export {
  createSqlSeoDataStore,
  createPayloadSeoDataStore,
  migrateSeoStore,
  SEO_STORE_MIGRATIONS,
  SEO_DATASETS,
} from './store/index.js'
export type {
  SeoDataStore,
  SeoDataset,
  SeoSqlDatabase,
  SeoSqlStatement,
  ScoreSnapshot,
  PerformanceRow,
  RankSnapshot,
  NotFoundEntry,
  NotFoundHit,
} from './store/index.js'
// Record a 404 from the host's own frontend, in-process (needs `features.seoLogs`).
export { recordSeoNotFound } from './endpoints/seoLogs.js'
// The scanner-probe paths the 404 log drops (`notFoundProbeFilter` option).
export { isProbePath, PROBE_PATH_PATTERNS } from './helpers/probePaths.js'
export type { NotFoundProbeFilterOption, ProbePathMatcher } from './helpers/probePaths.js'
// Alerts digest webhook formats (`alertWebhookFormat` option, `SEO_ALERT_WEBHOOK_FORMAT`).
export { detectAlertWebhookFormat, ALERT_WEBHOOK_FORMATS } from './alertWebhook.js'
export type { AlertWebhookFormat } from './alertWebhook.js'

// Re-export the dashboard string dictionary
export { getDashboardT } from './dashboard-i18n.js'
export type { DashboardTranslations } from './dashboard-i18n.js'

// Re-export constants for consumers that need thresholds
export {
  TITLE_LENGTH_MIN,
  TITLE_LENGTH_MAX,
  META_DESC_LENGTH_MIN,
  META_DESC_LENGTH_MAX,
  MIN_WORDS_POST,
  MIN_WORDS_FORM,
  MIN_WORDS_LEGAL,
  MIN_WORDS_GENERIC,
  MIN_WORDS_THIN,
  KEYWORD_DENSITY_MAX,
  KEYWORD_DENSITY_WARN,
  KEYWORD_DENSITY_MIN,
  SCORE_EXCELLENT,
  SCORE_GOOD,
  SCORE_OK,
  WARNING_MULTIPLIER,
  MAX_RECURSION_DEPTH,
  POWER_WORDS,
  STOP_WORDS,
  ACTION_VERBS,
  GENERIC_ANCHORS,
  LEGAL_SLUGS_MAP,
  UTILITY_SLUGS,
  EVERGREEN_SLUGS,
  STOP_WORD_COMPOUNDS_MAP,
  FLESCH_THRESHOLDS,
  READABILITY_THRESHOLDS,
  getStopWords,
  getActionVerbs,
  getPowerWords,
  getGenericAnchors,
  getLegalSlugs,
  getUtilitySlugs,
  getEvergreenSlugs,
  getStopWordCompounds,
} from './constants'

// The analyzer itself
export { analyzeSeo } from './analyzer.js'
