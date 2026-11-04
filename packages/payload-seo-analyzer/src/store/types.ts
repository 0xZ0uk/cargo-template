/**
 * The plugin's time-series data store (`dataStore` plugin option).
 *
 * Four features append rows forever: score history (one per document per save),
 * Search Console performance imports, GSC rank snapshots and 404 logs. On Cloudflare D1
 * (10 GB per database) they must not live in the main database next to the content, so
 * every read and write of that data goes through this interface instead of
 * `payload.find` / `payload.create` on a collection.
 *
 * Two implementations ship with the plugin:
 * - `createSqlSeoDataStore(db)`: plain SQL on any D1-shaped database (a second D1
 *   binding on Workers). The plugin owns and applies its schema.
 * - the Payload-collections store, used when the option is not set (Node hosts): the
 *   upstream `seo-*` collections, registered as before.
 *
 * Dates are ISO 8601 strings (`Date.prototype.toISOString()`), so they sort as text.
 */

/** The four datasets. The names are the upstream collection slugs, kept for `retentionDays`. */
export type SeoDataset = 'seo-rank-history' | 'seo-score-history' | 'seo-performance' | 'seo-logs'

export const SEO_DATASETS: readonly SeoDataset[] = [
  'seo-rank-history',
  'seo-score-history',
  'seo-performance',
  'seo-logs',
] as const

export type SeoRowId = string | number

// ---------------------------------------------------------------------------
// Score history
// ---------------------------------------------------------------------------

export interface ScoreSnapshot {
  id?: SeoRowId
  /** Collection slug, or `global:<slug>` for globals. */
  collection: string
  documentId: string
  score: number
  level?: string
  focusKeyword?: string
  wordCount?: number
  checksSummary?: { pass: number; warning: number; fail: number }
  snapshotDate: string
}

export interface ScoreHistoryQuery {
  collection?: string
  documentId?: string
  /** Strictly after this date. */
  since?: string
  limit: number
}

export interface ScoreHistoryStore {
  /** Newest first. */
  list(query: ScoreHistoryQuery): Promise<ScoreSnapshot[]>
  insert(snapshot: ScoreSnapshot): Promise<void>
}

// ---------------------------------------------------------------------------
// Search Console performance imports
// ---------------------------------------------------------------------------

export interface PerformanceRow {
  url: string
  /** Empty string when the import had no query column. */
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  /** Day, as `YYYY-MM-DDT00:00:00.000Z`. */
  date: string
  source?: 'csv' | 'api' | 'manual'
}

export interface PerformanceQuery {
  /** On or after this date. */
  since: string
  urlContains?: string
  queryContains?: string
  limit: number
}

export interface PerformanceUpsertResult {
  imported: number
  updated: number
  errors: number
}

export interface PerformanceStore {
  /** Newest first. */
  list(query: PerformanceQuery): Promise<PerformanceRow[]>
  /** Insert, or overwrite the metrics of the row with the same url + query + date. */
  upsert(rows: PerformanceRow[]): Promise<PerformanceUpsertResult>
}

// ---------------------------------------------------------------------------
// Rank history
// ---------------------------------------------------------------------------

export interface RankSnapshot {
  query: string
  page?: string | null
  position: number
  clicks?: number
  impressions?: number
  ctr?: number
  property?: string
  /** `YYYY-MM-DD`: one snapshot per query per day. */
  dateKey: string
  snapshotDate: string
}

export interface RankHistoryStore {
  /** Newest first. */
  list(query: { since?: string; limit: number }): Promise<RankSnapshot[]>
  /** Store the rows whose query has no snapshot for that day yet. Returns how many were stored. */
  insertDaily(rows: RankSnapshot[]): Promise<number>
}

// ---------------------------------------------------------------------------
// 404 logs
// ---------------------------------------------------------------------------

export type NotFoundType = '404' | 'redirect' | 'error'

export interface NotFoundEntry {
  id: SeoRowId
  url: string
  type: NotFoundType | string
  count: number
  lastSeen: string
  referrer?: string
  userAgent?: string
  ignored: boolean
  createdAt?: string
}

export interface NotFoundHit {
  /** Already normalised (lower case, no query or hash) and length-checked. */
  url: string
  type: NotFoundType
  referrer?: string
  userAgent?: string
  /** Defaults to now. */
  at?: string
}

export type NotFoundRecordResult = 'created' | 'incremented' | 'capped'

export interface NotFoundStore {
  /** Most hits first. */
  list(query: { includeIgnored?: boolean; seenSince?: string; limit: number }): Promise<NotFoundEntry[]>
  /**
   * Upsert one hit: a known URL gets `count + 1`; an unknown one is created unless the
   * table already holds `maxRows` rows.
   */
  record(hit: NotFoundHit, maxRows: number): Promise<NotFoundRecordResult>
  ignore(id: SeoRowId): Promise<void>
  remove(id: SeoRowId): Promise<void>
  /** Delete every row not marked ignored. Returns how many were deleted. */
  clear(): Promise<number>
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export interface PruneOptions {
  /** Delete rows strictly older than this date. */
  before?: string
  /** Then keep at most this many rows, newest first. */
  maxRows?: number
}

export interface PruneResult {
  deleted: number
  /** Set when the dataset does not exist on this store (a Payload collection not registered). */
  skipped?: 'not_registered'
}

export interface SeoDataStore {
  /** Short name for logs and the health endpoint (`'payload'`, `'sql'`). */
  readonly kind: string
  scoreHistory: ScoreHistoryStore
  performance: PerformanceStore
  rankHistory: RankHistoryStore
  notFound: NotFoundStore
  prune(dataset: SeoDataset, options: PruneOptions): Promise<PruneResult>
}
