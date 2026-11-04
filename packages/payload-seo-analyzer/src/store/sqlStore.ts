/**
 * `SeoDataStore` in plain SQL, on any database with D1's `prepare` / `bind` / `batch`
 * shape: a Cloudflare D1 binding as is, or a thin wrapper around `node:sqlite`,
 * better-sqlite3 or libSQL on Node.
 *
 * The store owns its schema (`sqlSchema.ts`) and applies it on first use, so a new or
 * updated deployment needs no manual step; `migrateSeoStore` applies it ahead of time.
 *
 * D1 limits shape the queries: at most 100 bound parameters per statement and 1,000
 * queries per Worker invocation, so bulk writes are multi-row statements sent in batches.
 */
import { SEO_STORE_MIGRATIONS } from './sqlSchema.js'
import type {
  NotFoundEntry,
  PerformanceRow,
  RankSnapshot,
  ScoreSnapshot,
  SeoDataStore,
  SeoDataset,
} from './types.js'

/** The subset of D1's prepared statement the store uses. */
export interface SeoSqlStatement {
  bind(...values: unknown[]): SeoSqlStatement
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>
  run(): Promise<{ meta?: { changes?: number } }>
}

/** The subset of D1's database API the store uses. A `D1Database` fits as is. */
export interface SeoSqlDatabase {
  prepare(query: string): SeoSqlStatement
  batch(statements: SeoSqlStatement[]): Promise<unknown[]>
}

const MIGRATIONS_TABLE = 'seo_store_migrations'
/** D1 refuses statements with more bound parameters than this. */
const MAX_PARAMS = 100
/** Statements per `batch()` call (each one is a single transaction on D1). */
const BATCH_STATEMENTS = 50

/**
 * Apply the pending schema migrations. Idempotent and safe to run concurrently: each
 * migration is one batch (one transaction on D1) of re-runnable statements. Returns the
 * ids applied by this call.
 */
export async function migrateSeoStore(db: SeoSqlDatabase): Promise<string[]> {
  let applied: Set<string>
  try {
    const { results } = await db.prepare(`SELECT id FROM ${MIGRATIONS_TABLE}`).all<{ id: string }>()
    applied = new Set((results ?? []).map((r) => r.id))
  } catch {
    // First run: the bookkeeping table doesn't exist yet.
    await db
      .prepare(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`)
      .run()
    applied = new Set()
  }

  const done: string[] = []
  for (const migration of SEO_STORE_MIGRATIONS) {
    if (applied.has(migration.id)) continue
    await db.batch([
      ...migration.statements.map((sql) => db.prepare(sql)),
      db
        .prepare(`INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES (?, ?)`)
        .bind(migration.id, new Date().toISOString()),
    ])
    done.push(migration.id)
  }
  return done
}

type Row = Record<string, unknown>

/** D1 rejects `undefined` bindings. */
const v = (value: unknown) => (value === undefined ? null : value)
const str = (x: unknown): string => (typeof x === 'string' ? x : x == null ? '' : String(x))
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : Number(x) || 0)
const changes = (r: { meta?: { changes?: number } }) => r.meta?.changes ?? 0
/** Escape `%`, `_` and `\` for a `LIKE … ESCAPE '\'` substring match. */
const likeContains = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

const TABLES: Record<SeoDataset, { table: string; dateColumn: string }> = {
  'seo-rank-history': { table: 'seo_rank_history', dateColumn: 'snapshot_date' },
  'seo-score-history': { table: 'seo_score_history', dateColumn: 'snapshot_date' },
  'seo-performance': { table: 'seo_performance', dateColumn: 'date' },
  'seo-logs': { table: 'seo_logs', dateColumn: 'last_seen' },
}

function parseChecks(raw: unknown): ScoreSnapshot['checksSummary'] {
  if (typeof raw !== 'string' || !raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

export function createSqlSeoDataStore(db: SeoSqlDatabase): SeoDataStore {
  // Once per store instance (one per isolate/process). A failure is retried on the next call.
  let ready: Promise<unknown> | undefined
  const ensure = () =>
    (ready ??= migrateSeoStore(db).catch((error) => {
      ready = undefined
      throw error
    }))

  const all = async (sql: string, params: unknown[] = []): Promise<Row[]> => {
    await ensure()
    const { results } = await db.prepare(sql).bind(...params.map(v)).all<Row>()
    return results ?? []
  }
  const run = async (sql: string, params: unknown[] = []): Promise<number> => {
    await ensure()
    return changes(await db.prepare(sql).bind(...params.map(v)).run())
  }

  /** Multi-row INSERT, chunked under the parameter cap and sent in batches. */
  const insertRows = async (head: string, tail: string, rows: unknown[][]): Promise<number> => {
    if (rows.length === 0) return 0
    await ensure()
    const width = rows[0]!.length
    const perStatement = Math.max(1, Math.floor(MAX_PARAMS / width))
    const placeholder = `(${Array(width).fill('?').join(', ')})`
    const statements: SeoSqlStatement[] = []
    for (let i = 0; i < rows.length; i += perStatement) {
      const chunk = rows.slice(i, i + perStatement)
      statements.push(
        db.prepare(`${head} VALUES ${chunk.map(() => placeholder).join(', ')} ${tail}`).bind(...chunk.flat().map(v)),
      )
    }
    let total = 0
    for (let i = 0; i < statements.length; i += BATCH_STATEMENTS) {
      const results = (await db.batch(statements.slice(i, i + BATCH_STATEMENTS))) as Array<{
        meta?: { changes?: number }
      }>
      for (const r of results) total += changes(r ?? {})
    }
    return total
  }

  const count = async (table: string) => num((await all(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.n)

  return {
    kind: 'sql',

    scoreHistory: {
      async list({ collection, documentId, since, limit }) {
        const where: string[] = []
        const params: unknown[] = []
        if (collection !== undefined) (where.push('collection = ?'), params.push(collection))
        if (documentId !== undefined) (where.push('document_id = ?'), params.push(documentId))
        if (since) (where.push('snapshot_date > ?'), params.push(since))
        const rows = await all(
          `SELECT * FROM seo_score_history ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY snapshot_date DESC, id DESC LIMIT ?`,
          [...params, limit],
        )
        return rows.map(
          (r): ScoreSnapshot => ({
            id: r.id as number,
            collection: str(r.collection),
            documentId: str(r.document_id),
            score: num(r.score),
            level: r.level == null ? undefined : str(r.level),
            focusKeyword: str(r.focus_keyword),
            wordCount: num(r.word_count),
            checksSummary: parseChecks(r.checks_summary),
            snapshotDate: str(r.snapshot_date),
          }),
        )
      },
      async insert(s) {
        await run(
          `INSERT INTO seo_score_history
             (collection, document_id, score, level, focus_keyword, word_count, checks_summary, snapshot_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            s.collection,
            s.documentId,
            Math.round(s.score),
            s.level,
            s.focusKeyword ?? '',
            s.wordCount,
            s.checksSummary ? JSON.stringify(s.checksSummary) : null,
            s.snapshotDate,
          ],
        )
      },
    },

    performance: {
      async list({ since, urlContains, queryContains, limit }) {
        const where = ['date >= ?']
        const params: unknown[] = [since]
        if (urlContains) (where.push(`url LIKE ? ESCAPE '\\'`), params.push(likeContains(urlContains)))
        if (queryContains) (where.push(`query LIKE ? ESCAPE '\\'`), params.push(likeContains(queryContains)))
        const rows = await all(
          `SELECT * FROM seo_performance WHERE ${where.join(' AND ')} ORDER BY date DESC, id DESC LIMIT ?`,
          [...params, limit],
        )
        return rows.map(
          (r): PerformanceRow => ({
            url: str(r.url),
            query: str(r.query),
            clicks: num(r.clicks),
            impressions: num(r.impressions),
            ctr: num(r.ctr),
            position: num(r.position),
            date: str(r.date),
            source: str(r.source) as PerformanceRow['source'],
          }),
        )
      },
      async upsert(rows) {
        if (rows.length === 0) return { imported: 0, updated: 0, errors: 0 }
        // Dedupe on the unique key (last one wins), so one statement never hits a row twice.
        const byKey = new Map<string, PerformanceRow>()
        for (const r of rows) byKey.set(`${r.url}::${r.query}::${r.date}`, r)
        const unique = [...byKey.values()]

        const before = await count('seo_performance')
        try {
          await insertRows(
            'INSERT INTO seo_performance (url, query, clicks, impressions, ctr, position, date, source)',
            `ON CONFLICT (url, query, date) DO UPDATE SET
               clicks = excluded.clicks, impressions = excluded.impressions,
               ctr = excluded.ctr, position = excluded.position, source = excluded.source`,
            unique.map((r) => [r.url, r.query ?? '', r.clicks, r.impressions, r.ctr, r.position, r.date, r.source ?? 'csv']),
          )
        } catch {
          return { imported: 0, updated: 0, errors: rows.length }
        }
        const imported = Math.max(0, (await count('seo_performance')) - before)
        return { imported, updated: rows.length - imported, errors: 0 }
      },
    },

    rankHistory: {
      async list({ since, limit }) {
        const rows = await all(
          `SELECT * FROM seo_rank_history ${since ? 'WHERE snapshot_date > ?' : ''}
           ORDER BY snapshot_date DESC, id DESC LIMIT ?`,
          since ? [since, limit] : [limit],
        )
        return rows.map(
          (r): RankSnapshot => ({
            query: str(r.query),
            page: r.page == null ? null : str(r.page),
            position: num(r.position),
            clicks: num(r.clicks),
            impressions: num(r.impressions),
            ctr: num(r.ctr),
            property: r.property == null ? undefined : str(r.property),
            dateKey: str(r.date_key),
            snapshotDate: str(r.snapshot_date),
          }),
        )
      },
      async insertDaily(rows) {
        return insertRows(
          'INSERT OR IGNORE INTO seo_rank_history (query, page, position, clicks, impressions, ctr, property, date_key, snapshot_date)',
          '',
          rows.map((r) => [r.query, r.page, r.position, r.clicks, r.impressions, r.ctr, r.property, r.dateKey, r.snapshotDate]),
        )
      },
    },

    notFound: {
      async list({ includeIgnored, seenSince, limit }) {
        const where: string[] = []
        const params: unknown[] = []
        if (!includeIgnored) where.push('ignored = 0')
        if (seenSince) (where.push('last_seen > ?'), params.push(seenSince))
        const rows = await all(
          `SELECT * FROM seo_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY count DESC, last_seen DESC LIMIT ?`,
          [...params, limit],
        )
        return rows.map(
          (r): NotFoundEntry => ({
            id: r.id as number,
            url: str(r.url),
            type: str(r.type) || '404',
            count: num(r.count),
            lastSeen: str(r.last_seen),
            referrer: str(r.referrer),
            userAgent: str(r.user_agent),
            ignored: num(r.ignored) === 1,
            createdAt: str(r.created_at),
          }),
        )
      },
      async record(hit, maxRows) {
        const at = hit.at ?? new Date().toISOString()
        // Known URL: one write, no count needed.
        const bumped = await run(
          `UPDATE seo_logs SET count = count + 1, last_seen = ?,
             referrer = COALESCE(?, referrer), user_agent = COALESCE(?, user_agent)
           WHERE url = ?`,
          [at, hit.referrer || null, hit.userAgent || null, hit.url],
        )
        if (bumped > 0) return 'incremented'
        // New URL: created only under the cap. The conflict clause covers a concurrent
        // insert of the same URL between the two statements.
        const created = await run(
          `INSERT INTO seo_logs (url, type, count, last_seen, referrer, user_agent, ignored, created_at)
           SELECT ?, ?, 1, ?, ?, ?, 0, ? WHERE (SELECT COUNT(*) FROM seo_logs) < ?
           ON CONFLICT (url) DO UPDATE SET count = count + 1, last_seen = excluded.last_seen`,
          [hit.url, hit.type, at, hit.referrer ?? '', hit.userAgent ?? '', at, maxRows],
        )
        return created > 0 ? 'created' : 'capped'
      },
      async ignore(id) {
        await run('UPDATE seo_logs SET ignored = 1 WHERE id = ?', [Number(id)])
      },
      async remove(id) {
        await run('DELETE FROM seo_logs WHERE id = ?', [Number(id)])
      },
      async clear() {
        return run('DELETE FROM seo_logs WHERE ignored = 0')
      },
    },

    async prune(dataset, { before, maxRows }) {
      const { table, dateColumn } = TABLES[dataset]
      let deleted = 0
      if (before) deleted += await run(`DELETE FROM ${table} WHERE ${dateColumn} < ?`, [before])
      if (maxRows && maxRows > 0) {
        deleted += await run(
          `DELETE FROM ${table} WHERE id IN (
             SELECT id FROM ${table} ORDER BY ${dateColumn} DESC, id DESC LIMIT -1 OFFSET ?
           )`,
          [Math.floor(maxRows)],
        )
      }
      return { deleted }
    },
  }
}
