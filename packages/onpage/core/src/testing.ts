/**
 * @cargo/onpage-core/testing — an in-memory DataSource for testing your
 * integration (custom field editors, renderers, client-mode pages) without a
 * Payload server. Saves are applied in memory, with Payload's stale-write
 * check, and recorded so tests can assert on them.
 *
 *   const ds = memoryDataSource({
 *     schemas: { pages: pageSchema },
 *     docs: { 'c:pages:1': { id: 1, title: 'Home', updatedAt: 'v0' } },
 *   })
 *   render(<OnPageEditor dataSource={ds} … />)
 *   // … edit …
 *   expect(ds.saves.at(-1)?.data).toEqual({ title: 'Hello' })
 */
import { refKey, type DocRef, type RefKey } from './docref.ts'
import type { DataSource, Doc, SaveResult, SearchHit } from './ports.ts'
import type { DocumentSchema } from './schema.ts'

export interface MemoryDataSourceOptions {
  /** Schemas by collection or global slug. */
  schemas: Record<string, DocumentSchema>
  /** Draft documents by ref key (`c:pages:1`, `g:header`). */
  docs: Record<RefKey, Doc>
  /** Published versions by ref key; default: a copy of `docs`. */
  published?: Record<RefKey, Doc> | undefined
}

export interface MemoryDataSource extends DataSource {
  /** Current drafts (and the documents saves wrote). */
  docs: Record<RefKey, Doc>
  /** Current published versions. */
  published: Record<RefKey, Doc>
  /** Every save, in order. */
  saves: Array<{ ref: DocRef; data: Doc }>
  /** Make the next save of this document fail like a stale write (409). */
  conflictOnce: (key: RefKey) => void
}

const clone = <T>(v: T): T => structuredClone(v)

export function memoryDataSource(opts: MemoryDataSourceOptions): MemoryDataSource {
  const docs = clone(opts.docs)
  const published = clone(opts.published ?? opts.docs)
  const saves: MemoryDataSource['saves'] = []
  const conflicts = new Set<RefKey>()
  let version = 0
  const schemaOf = (ref: DocRef) => {
    const schema = opts.schemas[ref.slug]
    if (!schema) throw new Error(`No schema for ${ref.slug}`)
    return schema
  }
  const write = (ref: DocRef, data: Doc, updatedAt: string | undefined): SaveResult => {
    const key = refKey(ref)
    const current = docs[key] ?? {}
    if (
      conflicts.delete(key) ||
      (updatedAt && current.updatedAt && updatedAt !== current.updatedAt)
    )
      return { ok: false, status: 409, message: 'Changed by someone else' }
    const next = { ...current, ...clone(data), updatedAt: `m${++version}` }
    docs[key] = next
    saves.push({ ref, data: clone(data) })
    return { ok: true, updatedAt: next.updatedAt }
  }
  return {
    docs,
    published,
    saves,
    conflictOnce: (key) => void conflicts.add(key),
    loadSchema: (ref) => Promise.resolve(clone(schemaOf(ref))),
    loadDocument: (ref, o) => {
      const key = refKey(ref)
      const doc = o.draft ? docs[key] : (published[key] ?? docs[key])
      return doc ? Promise.resolve(clone(doc)) : Promise.reject(new Error(`Not found: ${key}`))
    },
    saveDraft: (ref, data, o) =>
      Promise.resolve(write(ref, { ...data, _status: 'draft' }, o.updatedAt)),
    publish: (ref, data, o) => {
      const res = write(ref, { ...data, _status: 'published' }, o.updatedAt)
      if (res.ok) published[refKey(ref)] = clone(docs[refKey(ref)]!)
      return Promise.resolve(res)
    },
    search: (collection, o) => {
      const field = o.titleField ?? 'id'
      const query = (o.query ?? '').toLowerCase()
      const hits: SearchHit[] = Object.entries(docs)
        .filter(([key]) => key.startsWith(`c:${collection}:`))
        .map(([, doc]) => ({
          id: doc.id as string | number,
          title: String(doc[field] ?? doc.id),
          doc,
        }))
        .filter((h) => h.title.toLowerCase().includes(query))
      return Promise.resolve(hits.slice(0, o.limit ?? 20))
    },
  }
}
