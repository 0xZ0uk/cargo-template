/**
 * A D1-shaped wrapper around `node:sqlite`, for testing the SQL data store without
 * workerd. Mirrors the D1 behaviours the store depends on: `undefined` bindings are
 * refused, a statement takes at most 100 bound parameters, and `batch()` is one
 * transaction.
 */
import { DatabaseSync } from 'node:sqlite'
import type { SeoSqlDatabase, SeoSqlStatement } from '../../store/index.js'

interface TestStatement extends SeoSqlStatement {
  runSync(): { meta: { changes: number } }
}

export function nodeSqliteD1(): SeoSqlDatabase & { raw: DatabaseSync; queries: string[] } {
  const raw = new DatabaseSync(':memory:')
  const queries: string[] = []

  const check = (params: unknown[]) => {
    if (params.length > 100) throw new Error(`D1_ERROR: too many SQL variables (${params.length})`)
    if (params.some((p) => p === undefined)) throw new Error('D1_TYPE_ERROR: Type undefined is not supported')
  }

  const statement = (sql: string, params: unknown[] = []): TestStatement => ({
    bind: (...values: unknown[]) => statement(sql, values),
    async all<T>() {
      check(params)
      queries.push(sql)
      return { results: raw.prepare(sql).all(...(params as never[])) as T[] }
    },
    async run() {
      return this.runSync()
    },
    runSync() {
      check(params)
      queries.push(sql)
      const r = raw.prepare(sql).run(...(params as never[]))
      return { meta: { changes: Number(r.changes) } }
    },
  })

  return {
    raw,
    queries,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      raw.exec('BEGIN')
      try {
        const results = (statements as TestStatement[]).map((s) => s.runSync())
        raw.exec('COMMIT')
        return results
      } catch (error) {
        raw.exec('ROLLBACK')
        throw error
      }
    },
  }
}
