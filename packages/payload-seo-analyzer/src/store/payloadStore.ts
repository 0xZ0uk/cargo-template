/**
 * `SeoDataStore` on the upstream Payload collections (`seo-score-history`,
 * `seo-performance`, `seo-rank-history`, `seo-logs`). Used when the host passes no
 * `dataStore`: on a Node host the data stays in the main database, as upstream does.
 *
 * Writes are sequential: SQLite allows one writer, and parallel writes raise SQLITE_BUSY.
 */
import type { Payload, Where } from 'payload'
import type {
  NotFoundEntry,
  PerformanceRow,
  RankSnapshot,
  ScoreSnapshot,
  SeoDataStore,
  SeoDataset,
} from './types.js'

/** Date field each collection's retention compares against (three are `timestamps: false`). */
export const PAYLOAD_DATE_FIELDS: Record<SeoDataset, string> = {
  'seo-rank-history': 'snapshotDate',
  'seo-score-history': 'snapshotDate',
  'seo-performance': 'date',
  // `lastSeen`, not `createdAt`: a 404 first seen a year ago and still hit today is live.
  'seo-logs': 'lastSeen',
}

type Doc = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

function toScore(d: Doc): ScoreSnapshot {
  return {
    id: d.id as ScoreSnapshot['id'],
    collection: str(d.collection),
    documentId: str(d.documentId),
    score: num(d.score),
    level: d.level ? str(d.level) : undefined,
    focusKeyword: str(d.focusKeyword),
    wordCount: num(d.wordCount),
    checksSummary: (d.checksSummary as ScoreSnapshot['checksSummary']) || undefined,
    snapshotDate: str(d.snapshotDate),
  }
}

function toRank(d: Doc): RankSnapshot {
  return {
    query: str(d.query),
    page: d.page ? str(d.page) : null,
    position: num(d.position),
    clicks: num(d.clicks),
    impressions: num(d.impressions),
    ctr: num(d.ctr),
    property: d.property ? str(d.property) : undefined,
    dateKey: str(d.dateKey),
    snapshotDate: str(d.snapshotDate),
  }
}

function toNotFound(d: Doc): NotFoundEntry {
  return {
    id: d.id as NotFoundEntry['id'],
    url: str(d.url),
    type: str(d.type) || '404',
    count: num(d.count),
    lastSeen: str(d.lastSeen),
    referrer: str(d.referrer),
    userAgent: str(d.userAgent),
    ignored: d.ignored === true,
    createdAt: d.createdAt ? str(d.createdAt) : undefined,
  }
}

export function createPayloadSeoDataStore(payload: Payload): SeoDataStore {
  const find = (collection: SeoDataset, args: { where?: Where; sort?: string; limit: number }) =>
    payload.find({
      collection: collection as never,
      depth: 0,
      overrideAccess: true,
      ...args,
    }) as Promise<{ docs: Doc[] }>

  return {
    kind: 'payload',

    scoreHistory: {
      async list({ collection, documentId, since, limit }) {
        const and: Where[] = []
        if (documentId !== undefined) and.push({ documentId: { equals: documentId } })
        if (collection !== undefined) and.push({ collection: { equals: collection } })
        if (since) and.push({ snapshotDate: { greater_than: since } })
        const { docs } = await find('seo-score-history', {
          ...(and.length ? { where: { and } } : {}),
          sort: '-snapshotDate',
          limit,
        })
        return docs.map(toScore)
      },
      async insert(s) {
        await payload.create({
          collection: 'seo-score-history' as never,
          data: {
            documentId: s.documentId,
            collection: s.collection,
            score: s.score,
            level: s.level,
            focusKeyword: s.focusKeyword || '',
            wordCount: s.wordCount,
            checksSummary: s.checksSummary,
            snapshotDate: s.snapshotDate,
          } as never,
          overrideAccess: true,
        })
      },
    },

    performance: {
      async list({ since, urlContains, queryContains, limit }) {
        const { docs } = await find('seo-performance', {
          where: {
            date: { greater_than_equal: since },
            ...(urlContains ? { url: { contains: urlContains } } : {}),
            ...(queryContains ? { query: { contains: queryContains } } : {}),
          },
          sort: '-date',
          limit,
        })
        return docs.map(
          (d): PerformanceRow => ({
            url: str(d.url),
            query: str(d.query),
            clicks: num(d.clicks),
            impressions: num(d.impressions),
            ctr: num(d.ctr),
            position: num(d.position),
            date: str(d.date),
            source: (d.source as PerformanceRow['source']) || undefined,
          }),
        )
      },
      async upsert(rows) {
        let imported = 0
        let updated = 0
        let errors = 0
        const BATCH = 50
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH)
          const urls = [...new Set(batch.map((e) => e.url))]
          let existing: Doc[]
          try {
            ;({ docs: existing } = await find('seo-performance', {
              where: { url: { in: urls } },
              // Every stored row for these URLs: a URL can have many queries and days.
              limit: 0,
            }))
          } catch {
            errors += batch.length
            continue
          }
          const byKey = new Map<string, Doc>()
          for (const d of existing) byKey.set(`${str(d.url)}::${str(d.query)}::${str(d.date)}`, d)

          for (const row of batch) {
            const hit = byKey.get(`${row.url}::${row.query}::${row.date}`)
            try {
              if (hit) {
                await payload.update({
                  collection: 'seo-performance' as never,
                  id: hit.id as string,
                  data: {
                    clicks: row.clicks,
                    impressions: row.impressions,
                    ctr: row.ctr,
                    position: row.position,
                    source: row.source ?? 'csv',
                  } as never,
                  overrideAccess: true,
                })
                updated++
              } else {
                await payload.create({
                  collection: 'seo-performance' as never,
                  data: { ...row, source: row.source ?? 'csv' } as never,
                  overrideAccess: true,
                })
                imported++
              }
            } catch {
              errors++
            }
          }
        }
        return { imported, updated, errors }
      },
    },

    rankHistory: {
      async list({ since, limit }) {
        const { docs } = await find('seo-rank-history', {
          ...(since ? { where: { snapshotDate: { greater_than: since } } } : {}),
          sort: '-snapshotDate',
          limit,
        })
        return docs.map(toRank)
      },
      async insertDaily(rows) {
        const days = [...new Set(rows.map((r) => r.dateKey))]
        const { docs } = await find('seo-rank-history', {
          where: { dateKey: { in: days } },
          limit: 0,
        })
        const already = new Set(docs.map((d) => `${str(d.query)}::${str(d.dateKey)}`))
        let stored = 0
        for (const r of rows) {
          const key = `${r.query}::${r.dateKey}`
          if (already.has(key)) continue
          try {
            await payload.create({ collection: 'seo-rank-history' as never, data: r as never, overrideAccess: true })
            already.add(key)
            stored++
          } catch (e) {
            payload.logger.warn(`[seo] rank-snapshot: skipped "${r.query}": ${e instanceof Error ? e.message : 'error'}`)
          }
        }
        return stored
      },
    },

    notFound: {
      async list({ includeIgnored, seenSince, limit }) {
        const and: Where[] = []
        if (!includeIgnored) and.push({ ignored: { not_equals: true } })
        if (seenSince) and.push({ lastSeen: { greater_than: seenSince } })
        const { docs } = await find('seo-logs', {
          ...(and.length ? { where: { and } } : {}),
          sort: '-count',
          limit,
        })
        return docs.map(toNotFound)
      },
      async record(hit, maxRows) {
        const at = hit.at ?? new Date().toISOString()
        try {
          const { docs } = await find('seo-logs', { where: { url: { equals: hit.url } }, limit: 1 })
          const doc = docs[0]
          if (doc) {
            await payload.update({
              collection: 'seo-logs' as never,
              id: doc.id as string,
              data: {
                count: num(doc.count) + 1,
                lastSeen: at,
                ...(hit.referrer && { referrer: hit.referrer }),
                ...(hit.userAgent && { userAgent: hit.userAgent }),
              } as never,
              overrideAccess: true,
            })
            return 'incremented'
          }
        } catch {
          // Lookup failed: fall through to the create path rather than lose the hit.
        }
        // Only the create path grows the table, so it is the only one capped. `count` may be
        // missing on exotic adapters; a failure there must not drop the hit.
        try {
          const total = await payload.count?.({ collection: 'seo-logs' as never, overrideAccess: true })
          if (typeof total?.totalDocs === 'number' && total.totalDocs >= maxRows) return 'capped'
        } catch {
          // fall through
        }
        await payload.create({
          collection: 'seo-logs' as never,
          data: {
            url: hit.url,
            type: hit.type,
            count: 1,
            lastSeen: at,
            referrer: hit.referrer || '',
            userAgent: hit.userAgent || '',
            ignored: false,
          } as never,
          overrideAccess: true,
        })
        return 'created'
      },
      async ignore(id) {
        await payload.update({
          collection: 'seo-logs' as never,
          id: id as string,
          data: { ignored: true } as never,
          overrideAccess: true,
        })
      },
      async remove(id) {
        await payload.delete({ collection: 'seo-logs' as never, id: id as string, overrideAccess: true })
      },
      async clear() {
        const result = await payload.delete({
          collection: 'seo-logs' as never,
          where: { ignored: { not_equals: true } },
          overrideAccess: true,
        })
        const docs = (result as { docs?: unknown[] }).docs
        return Array.isArray(docs) ? docs.length : 0
      },
    },

    async prune(dataset, { before, maxRows }) {
      // A feature flag may have kept the collection out of the config entirely.
      const registered = (payload as unknown as { collections?: Record<string, unknown> }).collections
      if (registered && !registered[dataset]) return { deleted: 0, skipped: 'not_registered' }

      const dateField = PAYLOAD_DATE_FIELDS[dataset]
      let deleted = 0
      const removed = (r: unknown) => {
        const docs = (r as { docs?: unknown[] } | undefined)?.docs
        return Array.isArray(docs) ? docs.length : 0
      }
      if (before) {
        deleted += removed(
          await payload.delete({
            collection: dataset as never,
            where: { [dateField]: { less_than: before } },
            // A maintenance job must not be filtered by whichever session triggered it.
            overrideAccess: true,
            depth: 0,
          }),
        )
      }
      if (maxRows && maxRows > 0 && typeof payload.count === 'function') {
        const { totalDocs } = await payload.count({ collection: dataset as never, overrideAccess: true })
        if (totalDocs > maxRows) {
          // The newest row that falls outside the cap: everything at or before it goes.
          const { docs } = (await payload.find({
            collection: dataset as never,
            depth: 0,
            overrideAccess: true,
            sort: `-${dateField}`,
            limit: 1,
            page: maxRows + 1,
          })) as { docs: Doc[] }
          const edge = docs[0]?.[dateField]
          if (edge) {
            deleted += removed(
              await payload.delete({
                collection: dataset as never,
                where: { [dateField]: { less_than_equal: edge as string } },
                overrideAccess: true,
                depth: 0,
              }),
            )
          }
        }
      }
      return { deleted }
    },
  }
}
