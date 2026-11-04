/**
 * Retention for the four time-series datasets the plugin only ever appends to.
 *
 * `seo-rank-history` gains a row per tracked query per day, `seo-score-history` one
 * per document per save, `seo-performance` one per imported Search Console row and
 * `seo-logs` one per distinct 404 URL. Unpruned, they grow without bound: an
 * operational problem (database size, slower dashboard queries), not a privacy one.
 * The only visitor-derived data is the `referrer` and `userAgent` on `seo-logs`, and no
 * IP address is stored anywhere.
 *
 * MANDATORY for enabled features: a dataset whose feature is on is always pruned, with
 * `RETENTION_DEFAULTS` unless `retentionDays` / `retentionMaxRows` say otherwise. A
 * dataset whose feature is off is pruned only when `retentionDays` names it (old data
 * left behind by a feature that was turned off).
 *
 * Each dataset is pruned by age (its own date field: three of the four upstream
 * collections are `timestamps: false`), then trimmed to a row cap, newest kept.
 */
import type { Payload } from 'payload'
import { createPayloadSeoDataStore, PAYLOAD_DATE_FIELDS } from './store/payloadStore.js'
import { SEO_DATASETS, type SeoDataStore, type SeoDataset } from './store/types.js'

export type RetentionCollection = SeoDataset

export interface RetentionTarget {
  /** Dataset (upstream collection slug). */
  slug: RetentionCollection
  /**
   * Date field the purge compares against, as named on the Payload collection. NOT
   * `createdAt`: seo-rank-history, seo-score-history and seo-performance are declared
   * `timestamps: false`.
   */
  dateField: string
}

export const RETENTION_TARGETS: readonly RetentionTarget[] = SEO_DATASETS.map((slug) => ({
  slug,
  dateField: PAYLOAD_DATE_FIELDS[slug],
}))

/** Days to keep, per dataset. Invalid entries are ignored (the default applies if enabled). */
export type RetentionConfig = Partial<Record<RetentionCollection, number>>
/** Row cap, per dataset. Invalid entries are ignored (the default applies). */
export type RetentionMaxRows = Partial<Record<RetentionCollection, number>>

/**
 * Applied to every enabled dataset. Sized for a D1 database (10 GB): every cap is a few
 * tens of MB at most.
 * - rank history: ~13 months of daily snapshots; 100 tracked queries a day is ~40k rows.
 * - score history: a year; saves are already throttled to one snapshot per doc per hour.
 * - performance: 16 months, what Search Console itself keeps.
 * - 404 logs: 90 days since the last hit; the row cap is also enforced on every insert.
 */
export const RETENTION_DEFAULTS: Readonly<Record<RetentionCollection, { days: number; maxRows: number }>> = {
  'seo-rank-history': { days: 400, maxRows: 100_000 },
  'seo-score-history': { days: 365, maxRows: 50_000 },
  'seo-performance': { days: 490, maxRows: 100_000 },
  'seo-logs': { days: 90, maxRows: 5_000 },
}

/** Row cap of the 404 log, also checked on every new URL. `SEO_LOGS_MAX_ROWS` overrides the default. */
export function seoLogsMaxRows(maxRows?: RetentionMaxRows): number {
  const explicit = maxRows?.['seo-logs']
  if (isPositive(explicit)) return Math.floor(explicit)
  const parsed = parseInt(process.env.SEO_LOGS_MAX_ROWS || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : RETENTION_DEFAULTS['seo-logs'].maxRows
}

export interface ResolvedRetention extends RetentionTarget {
  days: number
  maxRows: number
}

export interface RetentionOptions {
  /** Datasets whose feature is on: pruned even when `retentionDays` doesn't name them. */
  enabled?: readonly RetentionCollection[]
  maxRows?: RetentionMaxRows
}

const DAY_MS = 24 * 60 * 60 * 1000

function isPositive(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1
}

/**
 * Turn the options into the list of purges to run.
 *
 * Deliberately strict: a value that is not a finite number of at least one is DROPPED,
 * not clamped. `0`, `-1`, `NaN` and `'30'` would each mean "delete everything" under a
 * naive clamp. For an enabled dataset the default then applies.
 */
export function resolveRetention(
  input: RetentionConfig | undefined,
  options: RetentionOptions = {},
): ResolvedRetention[] {
  const days = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const caps = options.maxRows && typeof options.maxRows === 'object' ? (options.maxRows as Record<string, unknown>) : {}
  const enabled = new Set(options.enabled ?? [])
  const resolved: ResolvedRetention[] = []
  for (const target of RETENTION_TARGETS) {
    const rawDays = days[target.slug]
    const configured = isPositive(rawDays)
    if (!configured && !enabled.has(target.slug)) continue
    const rawCap = caps[target.slug]
    resolved.push({
      ...target,
      days: configured ? Math.floor(rawDays) : RETENTION_DEFAULTS[target.slug].days,
      maxRows:
        target.slug === 'seo-logs'
          ? seoLogsMaxRows(options.maxRows)
          : isPositive(rawCap)
            ? Math.floor(rawCap)
            : RETENTION_DEFAULTS[target.slug].maxRows,
    })
  }
  return resolved
}

export interface PurgeCollectionResult {
  collection: string
  /** Rows deleted. `0` when the dataset is absent or the delete failed. */
  deleted: number
  /** Everything strictly older than this was removed. */
  cutoff: string
  /** Present only when nothing was deleted for a reason worth reporting. */
  skipped?: 'not_registered'
  error?: string
}

export interface PurgeResult {
  ran: boolean
  results: PurgeCollectionResult[]
  totalDeleted: number
}

/**
 * Delete every row older than its dataset's window, then trim each dataset to its cap.
 *
 * Sequential on purpose: SQLite allows one writer, and parallel writes produce
 * `SQLITE_BUSY`. One failing dataset is reported and the others still run.
 */
export async function purgeRetention(
  payload: Payload,
  input: RetentionConfig | undefined,
  options: RetentionOptions & { now?: Date; store?: SeoDataStore } = {},
): Promise<PurgeResult> {
  const targets = resolveRetention(input, options)
  if (targets.length === 0) return { ran: false, results: [], totalDeleted: 0 }

  const now = options.now ?? new Date()
  const store = options.store ?? createPayloadSeoDataStore(payload)
  const results: PurgeCollectionResult[] = []

  for (const target of targets) {
    const cutoff = new Date(now.getTime() - target.days * DAY_MS).toISOString()
    try {
      const { deleted, skipped } = await store.prune(target.slug, { before: cutoff, maxRows: target.maxRows })
      results.push({ collection: target.slug, deleted, cutoff, ...(skipped && { skipped }) })
    } catch (error) {
      results.push({
        collection: target.slug,
        deleted: 0,
        cutoff,
        error: error instanceof Error ? error.message : 'unknown error',
      })
    }
  }

  return {
    ran: true,
    results,
    totalDeleted: results.reduce((sum, r) => sum + r.deleted, 0),
  }
}

/** Preview what a purge would remove, without deleting anything. */
export function describeRetention(
  input: RetentionConfig | undefined,
  now: Date = new Date(),
  options: RetentionOptions = {},
) {
  return resolveRetention(input, options).map((target) => ({
    collection: target.slug,
    dateField: target.dateField,
    days: target.days,
    maxRows: target.maxRows,
    cutoff: new Date(now.getTime() - target.days * DAY_MS).toISOString(),
  }))
}
