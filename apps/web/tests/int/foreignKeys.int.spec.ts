import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { sql } from '@payloadcms/db-d1-sqlite'
import { drizzle } from '@payloadcms/db-d1-sqlite/drizzle/d1'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'

import { migrations } from '@/db/migrations'

// The foreign keys the committed migrations create, against the latest Drizzle snapshot.
//
// Drizzle drops ON DELETE from `ALTER TABLE … ADD x_id … REFERENCES …`, and D1 enforces foreign
// keys, so a reference without the snapshot's ON DELETE makes deletes fail instead of cascading or
// nulling (#120: deleting a page that was open in the admin failed on its edit lock).
//
// Runs on its own in-memory D1 (workerd, like production), built from the migrations here: the
// shared local D1 in `.wrangler/state` stays untouched, and the other specs that open it in
// parallel never see these writes.

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/db/migrations',
)

type ForeignKey = {
  tableFrom: string
  tableTo: string
  columnsFrom: string[]
  columnsTo: string[]
  onDelete?: string
}

type Snapshot = { tables: Record<string, { foreignKeys: Record<string, ForeignKey> }> }

type Column = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }

const latestSnapshot = (): Snapshot => {
  const latest = readdirSync(migrationsDir)
    .filter((file) => /^\d{8}_\d{6}_.+\.json$/.test(file))
    .sort()
    .at(-1)
  if (!latest) throw new Error(`No migration snapshot in ${migrationsDir}`)
  return JSON.parse(readFileSync(path.join(migrationsDir, latest), 'utf8')) as Snapshot
}

const snapshot = latestSnapshot()
const snapshotForeignKeys = Object.values(snapshot.tables).flatMap(({ foreignKeys }) =>
  Object.values(foreignKeys),
)
const onDeleteOf = (fk: ForeignKey) => (fk.onDelete ?? 'no action').toLowerCase()
const describeForeignKey = (table: string, column: string, target: string, onDelete: string) =>
  `${table}.${column} -> ${target} ON DELETE ${onDelete.toLowerCase()}`

let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ D1: D1Database }>>>
let db: ReturnType<typeof drizzle>

const all = async <T>(query: ReturnType<typeof sql>) => (await db.all(query)) as T[]
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

beforeAll(async () => {
  proxy = await getPlatformProxy<{ D1: D1Database }>({ persist: false, remoteBindings: false })
  db = drizzle(proxy.env.D1)
  for (const migration of migrations) {
    await migration.up({ db, payload: undefined, req: undefined } as never)
  }
}, 60_000)

afterAll(async () => {
  await proxy?.dispose()
})

describe('D1 foreign keys after every migration', () => {
  it('match the latest snapshot, ON DELETE included', async () => {
    const expected = snapshotForeignKeys
      .map((fk) => describeForeignKey(fk.tableFrom, fk.columnsFrom[0], fk.tableTo, onDeleteOf(fk)))
      .sort()

    const rows = await all<{ table: string; from: string; to: string; on_delete: string }>(sql`
      SELECT m.name AS "table", f."from", f."table" AS "to", f.on_delete
      FROM sqlite_master m, pragma_foreign_key_list(m.name) f
      WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite!_%' ESCAPE '!'
        AND m.name NOT LIKE '!_cf!_%' ESCAPE '!' AND m.name NOT LIKE 'd1!_%' ESCAPE '!'
    `)
    const actual = rows
      .map((row) => describeForeignKey(row.table, row.from, row.to, row.on_delete))
      .sort()

    // Listed both ways so a failure names each reference: `missing` is in the snapshot but not in
    // the database (usually the same reference with another ON DELETE, listed under `unexpected`).
    expect({
      missing: expected.filter((fk) => !actual.includes(fk)),
      unexpected: actual.filter((fk) => !expected.includes(fk)),
    }).toEqual({ missing: [], unexpected: [] })
  })

  // What each ON DELETE does when the referenced row goes, e.g. deleting a page that is open in
  // the admin (its lock row references it) or a page an A/B variant points at. Inserts and
  // deletes rows for every foreign key (many D1 round trips), so a slow CI runner can take
  // longer than vitest's 5 s default.
  it('cascade or set null when the referenced row is deleted', async () => {
    const columnsOf = new Map<string, Column[]>()
    const columns = async (table: string) => {
      if (!columnsOf.has(table)) {
        columnsOf.set(table, await all<Column>(sql`SELECT * FROM pragma_table_info(${table})`))
      }
      return columnsOf.get(table)!
    }
    const foreignKeyOn = (table: string, column: string) =>
      Object.values(snapshot.tables[table]?.foreignKeys ?? {}).find(
        (fk) => fk.columnsFrom[0] === column,
      )
    let counter = 0

    // Inserts a row with every required column filled (a required reference gets a row of its
    // own) plus `values`, and returns the value of its `returning` column.
    const insert = async (
      table: string,
      values: Record<string, unknown>,
      returning: string,
    ): Promise<unknown> => {
      const row: Record<string, unknown> = {}
      for (const column of await columns(table)) {
        if (column.name in values || column.dflt_value !== null) continue
        const isRowId = column.pk === 1 && column.type.toUpperCase() === 'INTEGER'
        if (isRowId || (!column.notnull && column.pk === 0)) continue
        const fk = foreignKeyOn(table, column.name)
        counter += 1
        row[column.name] = fk
          ? await insert(fk.tableTo, {}, fk.columnsTo[0])
          : /INT|REAL|NUM/i.test(column.type)
            ? counter
            : `fk-test-${counter}`
      }
      Object.assign(row, values)
      const names = Object.keys(row)
      const query =
        names.length === 0
          ? sql.raw(`INSERT INTO ${quote(table)} DEFAULT VALUES RETURNING ${quote(returning)}`)
          : sql.join([
              sql.raw(`INSERT INTO ${quote(table)} (${names.map(quote).join(', ')}) VALUES (`),
              sql.join(
                names.map((name) => sql`${row[name]}`),
                sql.raw(', '),
              ),
              sql.raw(`) RETURNING ${quote(returning)}`),
            ])
      const [inserted] = await all<Record<string, unknown>>(query)
      return inserted[returning]
    }

    const failures: string[] = []
    let checked = 0
    for (const fk of snapshotForeignKeys) {
      const [column] = fk.columnsFrom
      const [target] = fk.columnsTo
      const onDelete = onDeleteOf(fk)
      if (onDelete !== 'cascade' && onDelete !== 'set null') continue
      const name = describeForeignKey(fk.tableFrom, column, fk.tableTo, onDelete)

      try {
        const parent = await insert(fk.tableTo, {}, target)
        const key = (await columns(fk.tableFrom)).find((c) => c.pk === 1)?.name ?? 'rowid'
        const child = await insert(fk.tableFrom, { [column]: parent }, key)

        await db.run(
          sql.join([
            sql.raw(`DELETE FROM ${quote(fk.tableTo)} WHERE ${quote(target)} = `),
            sql`${parent}`,
          ]),
        )

        const [after] = await all<{ ref: unknown }>(
          sql.join([
            sql.raw(`SELECT ${quote(column)} AS ref FROM ${quote(fk.tableFrom)} WHERE `),
            sql.raw(`${quote(key)} = `),
            sql`${child}`,
          ]),
        )
        if (onDelete === 'cascade' && after) failures.push(`${name}: the row was kept`)
        if (onDelete === 'set null' && (!after || after.ref !== null)) {
          failures.push(`${name}: ${after ? 'the reference was kept' : 'the row was deleted'}`)
        }
        checked += 1
      } catch (error) {
        const cause = (error as { cause?: unknown }).cause ?? error
        failures.push(`${name}: ${String(cause).replace(/\s+/g, ' ').slice(0, 160)}`)
      }
    }

    expect(failures).toEqual([])
    expect(checked).toBeGreaterThan(0)
  }, 30_000)
})
