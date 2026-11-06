import type { AbBucketResult, AbMeasurementConfig, AbResults } from '@cargo/payload-plugin-ab'
import {
  abRunMarker,
  bucketCookieName,
  parseCookieHeader,
  serializeAbCookie,
  type AbRewrite,
} from '@cargo/payload-plugin-ab/middleware'

/**
 * A/B measurement on Workers Analytics Engine.
 *
 * One data point per event, in the `cargo_ab` dataset (the `AB_ANALYTICS` binding in
 * wrangler.jsonc):
 *
 * | Column   | Value                                                    |
 * | -------- | -------------------------------------------------------- |
 * | index1   | the manifest key, cut to 96 bytes (the sampling key)     |
 * | blob1    | the manifest key (the original page's path)              |
 * | blob2    | the bucket: `original` or the variant's slug             |
 * | blob3    | `impression` or `conversion`                             |
 * | blob4    | the conversion goal (`cta`), empty for an impression     |
 * | double1  | 1                                                        |
 *
 * No visitor id, IP or user agent is written: each visitor counts once per experiment run and
 * bucket because a cookie marks them as counted, not because the store can tell them apart.
 * Counts are `SUM(_sample_interval)`, which stays right when Analytics Engine samples.
 */

/** Must match `analytics_engine_datasets[].dataset` in wrangler.jsonc. */
export const AB_DATASET = 'cargo_ab'
/** Analytics Engine keeps data points for three months. */
export const AB_RETENTION_DAYS = 90

/**
 * Marks a visitor whose impression was counted, per experiment; the value is the bucket and
 * the run (`abRunMarker`), so a new experiment on the same page counts them again.
 */
export const IMPRESSION_COOKIE_PREFIX = 'payload_ab_seen'
/** As long as the bucket cookie (the resolver's default): one impression per assignment. */
const IMPRESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 90

const INDEX_MAX_BYTES = 96

export type AbEvent =
  | { experiment: string; bucket: string; event: 'impression' }
  | { experiment: string; bucket: string; event: 'conversion'; goal: string }

/** Cuts a string to at most `max` UTF-8 bytes without splitting a character. */
function truncateUtf8(value: string, max: number): string {
  const encoder = new TextEncoder()
  if (encoder.encode(value).length <= max) return value
  let out = ''
  for (const char of value) {
    if (encoder.encode(out + char).length > max) break
    out += char
  }
  return out
}

/**
 * Writes one event. A no-op without the binding (the Node dev server's proxy, tests), and a
 * write never throws into the page: analytics must not break a page view.
 */
export function writeAbEvent(dataset: AnalyticsEngineDataset | undefined, event: AbEvent): void {
  if (!dataset) return
  try {
    dataset.writeDataPoint({
      indexes: [truncateUtf8(event.experiment, INDEX_MAX_BYTES)],
      blobs: [
        event.experiment,
        event.bucket,
        event.event,
        event.event === 'conversion' ? event.goal : '',
      ],
      doubles: [1],
    })
  } catch (err) {
    console.error(
      JSON.stringify({ level: 'error', msg: '[ab] writeDataPoint failed', err: String(err) }),
    )
  }
}

/**
 * Counts an impression for a routed page view, once per visitor, experiment run and bucket.
 *
 * `loadPage` runs on the server render and again as a server-function call on client-side
 * navigation and route invalidation, so a write per call would count one visit several
 * times. The first counted view sets an HttpOnly marker cookie holding the bucket and the
 * run (`startedAt`, which the manifest entry carries, so this costs no extra read); views
 * that carry it are not counted again. A visitor moved to another bucket (their variant was
 * deleted), or returning in a later experiment on the same page, doesn't match the marker
 * and is counted again.
 *
 * Returns the marker's `Set-Cookie` value when one must be set, else null.
 */
export function recordImpression(
  dataset: AnalyticsEngineDataset | undefined,
  cookieHeader: string | null | undefined,
  key: string,
  ab: Pick<AbRewrite, 'bucket'>,
  startedAt?: string | null,
): string | null {
  const name = bucketCookieName(key, IMPRESSION_COOKIE_PREFIX)
  const value = abRunMarker(ab.bucket, startedAt)
  if (parseCookieHeader(cookieHeader).get(name) === value) return null

  writeAbEvent(dataset, { experiment: key, bucket: ab.bucket, event: 'impression' })
  return serializeAbCookie({
    name,
    value,
    options: { path: '/', sameSite: 'lax', maxAge: IMPRESSION_COOKIE_MAX_AGE, httpOnly: true },
  })
}

/** An Analytics Engine SQL string literal. */
const sqlString = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** `YYYY-MM-DD HH:MM:SS` in UTC, the format Analytics Engine's `toDateTime` takes. */
const sqlDateTime = (iso: string, name = 'startedAt') => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${name}: ${iso}`)
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * Counts per bucket and event for one run of an experiment: from `startedAt`, up to `endedAt`
 * for a run that ended (exclusive, so the next run on the page, which starts later, never
 * shares an event), or up to now for the current run.
 */
export function abResultsQuery(experiment: string, startedAt: string, endedAt?: string): string {
  const window = [
    `timestamp >= toDateTime(${sqlString(sqlDateTime(startedAt))})`,
    ...(endedAt ? [`timestamp < toDateTime(${sqlString(sqlDateTime(endedAt, 'endedAt'))})`] : []),
  ]
  return [
    `SELECT blob2 AS bucket, blob3 AS event, SUM(_sample_interval) AS count`,
    `FROM ${AB_DATASET}`,
    `WHERE blob1 = ${sqlString(experiment)} AND ${window.join(' AND ')}`,
    `GROUP BY bucket, event`,
    `FORMAT JSON`,
  ].join('\n')
}

type SqlRow = { bucket?: unknown; event?: unknown; count?: unknown }

/** Folds the SQL rows (one per bucket and event) into one entry per bucket. Counts may arrive as strings. */
export function mapAbResultRows(rows: SqlRow[]): AbBucketResult[] {
  const buckets = new Map<string, AbBucketResult>()
  for (const row of rows) {
    if (typeof row.bucket !== 'string' || !row.bucket) continue
    const count = Math.round(Number(row.count))
    if (!Number.isFinite(count)) continue
    const entry = buckets.get(row.bucket) ?? { bucket: row.bucket, impressions: 0, conversions: 0 }
    if (row.event === 'impression') entry.impressions += count
    else if (row.event === 'conversion') entry.conversions += count
    else continue
    buckets.set(row.bucket, entry)
  }
  return [...buckets.values()]
}

export type AbSqlCredentials = { accountId?: string; apiToken?: string }

/**
 * Reads the counts of one run of an experiment (to `endedAt` when it ended) through the
 * Analytics Engine SQL API. Without an account id and token it reports measurement as not
 * configured, without a request. The token stays on the server; errors never include it.
 */
export async function getAbResults(
  { experiment, startedAt, endedAt }: { experiment: string; startedAt: string; endedAt?: string },
  { accountId, apiToken }: AbSqlCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<AbResults> {
  if (!accountId || !apiToken) {
    return {
      configured: false,
      reason:
        'Set AB_ANALYTICS_ACCOUNT_ID and AB_ANALYTICS_API_TOKEN (Account Analytics: Read) to see results here.',
    }
  }

  const res = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'text/plain' },
      body: abResultsQuery(experiment, startedAt, endedAt),
    },
  )
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200)
    throw new Error(`Analytics Engine SQL API answered ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  const body = (await res.json()) as { data?: SqlRow[] }
  return {
    configured: true,
    buckets: mapAbResultRows(body.data ?? []),
    retentionDays: AB_RETENTION_DAYS,
  }
}

/** Rate-limit key for a conversion: the client IP, which Cloudflare's edge sets and clients can't forge. */
const clientKey = (headers: Headers) => headers.get('cf-connecting-ip')?.trim() || 'unknown'

/**
 * The plugin's `measurement.rateLimit`: `POST /api/_ab/convert` per client IP, through the
 * `AB_RATE_LIMIT_CONVERT` binding (wrangler.jsonc), shared by every isolate in a location.
 * Without the binding, everything passes.
 */
export function abConversionRateLimit(
  binding: RateLimit | undefined,
): (req: { headers: Headers }) => Promise<boolean> {
  return async (req) => {
    if (!binding) return true
    const { success } = await binding.limit({ key: `ab-convert:${clientKey(req.headers)}` })
    return success
  }
}

type MeasurementEnv = {
  AB_ANALYTICS?: AnalyticsEngineDataset
  AB_RATE_LIMIT_CONVERT?: RateLimit
  AB_ANALYTICS_ACCOUNT_ID?: string
  AB_ANALYTICS_API_TOKEN?: string
}

/**
 * The plugin's `measurement` option: conversions go to Analytics Engine, results come from
 * its SQL API. The credentials are read per call, from varlock's `process.env` or the Worker
 * bindings, so a missing pair only turns the panel's results off.
 */
export function abMeasurementConfig(env: MeasurementEnv): AbMeasurementConfig {
  return {
    goals: ['cta'],
    rateLimit: abConversionRateLimit(env.AB_RATE_LIMIT_CONVERT),
    recordConversion: ({ experiment, bucket, goal }) =>
      writeAbEvent(env.AB_ANALYTICS, { experiment, bucket, event: 'conversion', goal }),
    getResults: (args) =>
      getAbResults(args, {
        accountId: process.env.AB_ANALYTICS_ACCOUNT_ID || env.AB_ANALYTICS_ACCOUNT_ID,
        apiToken: process.env.AB_ANALYTICS_API_TOKEN || env.AB_ANALYTICS_API_TOKEN,
      }),
  }
}
