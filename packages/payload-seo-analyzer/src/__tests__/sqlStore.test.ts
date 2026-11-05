import { describe, expect, it, vi } from 'vitest'
import { createSeoLogsHandler, recordSeoNotFound } from '../endpoints/seoLogs.js'
import { createPerformanceHandler } from '../endpoints/performance.js'
import { createHistoryHandler } from '../endpoints/history.js'
import { purgeRetention } from '../retention.js'
import { createSqlSeoDataStore, migrateSeoStore, SEO_STORE_MIGRATIONS, type SeoDataStore } from '../store/index.js'
import { nodeSqliteD1 } from './helpers/nodeSqliteD1.js'

function setup() {
  const db = nodeSqliteD1()
  const store = createSqlSeoDataStore(db)
  return { db, store }
}

const tables = (db: ReturnType<typeof nodeSqliteD1>) =>
  (db.raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as Array<{ name: string }>)
    .map((r) => r.name)
    .filter((n) => n !== 'sqlite_sequence')

const admin = { id: 1, collection: 'users', role: 'admin' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function req(store: SeoDataStore, init: { method: string; url: string; body?: unknown }): any {
  return {
    user: admin,
    method: init.method,
    url: `http://localhost/api/seo-plugin${init.url}`,
    headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }),
    json: async () => init.body ?? {},
    payload: {
      config: { collections: [{ slug: 'users', auth: {} }], admin: { user: 'users' } },
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
      find: vi.fn(() => {
        throw new Error('the main database must not be touched')
      }),
      create: vi.fn(() => {
        throw new Error('the main database must not be touched')
      }),
    },
  }
}

describe('SQL store — schema', () => {
  it('creates its tables on first use, once, and records the migration', async () => {
    const { db, store } = setup()
    await store.scoreHistory.list({ limit: 1 })
    await store.notFound.list({ limit: 1 })
    expect(tables(db)).toEqual([
      'seo_logs',
      'seo_performance',
      'seo_rank_history',
      'seo_score_history',
      'seo_store_migrations',
    ])
    // Second call in the same store: no migration queries.
    expect(db.queries.filter((q) => q.includes('CREATE TABLE'))).toHaveLength(
      1 + SEO_STORE_MIGRATIONS[0]!.statements.filter((s) => s.includes('CREATE TABLE')).length,
    )
  })

  it('is idempotent across stores and explicit runs', async () => {
    const db = nodeSqliteD1()
    expect(await migrateSeoStore(db)).toEqual(['0001_init'])
    expect(await migrateSeoStore(db)).toEqual([])
    await createSqlSeoDataStore(db).scoreHistory.list({ limit: 1 })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM seo_store_migrations').get()).toEqual({ n: 1 })
  })

  it('retries the migration after a failure instead of caching it', async () => {
    const db = nodeSqliteD1()
    const batch = db.batch.bind(db)
    let fail = true
    db.batch = async (s) => {
      if (fail) {
        fail = false
        throw new Error('D1 down')
      }
      return batch(s)
    }
    const store = createSqlSeoDataStore(db)
    await expect(store.scoreHistory.list({ limit: 1 })).rejects.toThrow('D1 down')
    await expect(store.scoreHistory.list({ limit: 1 })).resolves.toEqual([])
  })
})

describe('SQL store — score history', () => {
  it('lists newest first, filtered by document and date', async () => {
    const { store } = setup()
    for (const [doc, score, date] of [
      ['1', 50, '2026-01-01T00:00:00.000Z'],
      ['1', 70, '2026-02-01T00:00:00.000Z'],
      ['2', 90, '2026-03-01T00:00:00.000Z'],
    ] as const) {
      await store.scoreHistory.insert({
        collection: 'pages',
        documentId: doc,
        score,
        level: 'ok',
        checksSummary: { pass: 1, warning: 2, fail: 3 },
        snapshotDate: date,
      })
    }
    const doc1 = await store.scoreHistory.list({ collection: 'pages', documentId: '1', limit: 10 })
    expect(doc1.map((s) => s.score)).toEqual([70, 50])
    expect(doc1[0]!.checksSummary).toEqual({ pass: 1, warning: 2, fail: 3 })
    const recent = await store.scoreHistory.list({ since: '2026-01-15T00:00:00.000Z', limit: 10 })
    expect(recent.map((s) => s.documentId)).toEqual(['2', '1'])
  })

  it('serves the history endpoint without touching Payload collections', async () => {
    const { store } = setup()
    await store.scoreHistory.insert({ collection: 'pages', documentId: '7', score: 40, snapshotDate: '2026-01-01T00:00:00.000Z' })
    await store.scoreHistory.insert({ collection: 'pages', documentId: '7', score: 80, snapshotDate: '2026-01-02T00:00:00.000Z' })
    const res = await createHistoryHandler(() => store)(
      req(store, { method: 'GET', url: '/history?documentId=7&collection=pages' }),
    )
    const body = await res.json()
    expect(body.history.map((h: { score: number }) => h.score)).toEqual([40, 80])
    expect(body.trend).toBe('improving')
  })
})

describe('SQL store — performance', () => {
  const row = (i: number, clicks = i) => ({
    url: `/page-${i % 3}`,
    query: `q_${i}%`,
    clicks,
    impressions: 100,
    ctr: 1,
    position: 3,
    date: '2026-10-01T00:00:00.000Z',
  })

  it('upserts on url + query + date, in statements under D1 s parameter cap', async () => {
    const { store } = setup()
    expect(await store.performance.upsert(Array.from({ length: 40 }, (_, i) => row(i)))).toEqual({
      imported: 40,
      updated: 0,
      errors: 0,
    })
    expect(await store.performance.upsert([row(1, 999), row(100)])).toEqual({ imported: 1, updated: 1, errors: 0 })
    const rows = await store.performance.list({ since: '2026-01-01T00:00:00.000Z', queryContains: 'q_1%', limit: 100 })
    // `%` and `_` match literally: q_1% only, not q_10…q_19.
    expect(rows).toHaveLength(1)
    expect(rows[0]!.clicks).toBe(999)
  })

  it('imports a CSV through the endpoint', async () => {
    const { store } = setup()
    const handler = createPerformanceHandler(() => store)
    const csv = 'Page,Query,Clicks,Impressions,CTR,Position,Date\n/a,coffee,3,10,30%,2.5,2026-10-02\n/b,tea,1,5,20%,4,2026-10-02'
    const post = await handler(req(store, { method: 'POST', url: '/performance', body: { csv } }))
    expect(await post.json()).toEqual({ imported: 2, updated: 0, errors: 0 })
    const again = await handler(req(store, { method: 'POST', url: '/performance', body: { csv } }))
    expect(await again.json()).toEqual({ imported: 0, updated: 2, errors: 0 })
  })
})

describe('SQL store — performance, weighted average position', () => {
  const day = new Date().toISOString().split('T')[0] + 'T00:00:00.000Z'
  const mk = (url: string, query: string, position: number, impressions: number) => ({
    url,
    query,
    clicks: 0,
    impressions,
    ctr: 0,
    position,
    date: day,
  })

  async function get(rows: ReturnType<typeof mk>[]) {
    const { store } = setup()
    await store.performance.upsert(rows)
    const handler = createPerformanceHandler(() => store)
    const res = await handler(req(store, { method: 'GET', url: '/performance?period=7d' }))
    return res.json()
  }

  it('weights by impressions (position 2 with 80 impressions → 2.0)', async () => {
    const body = await get([mk('/a', 'x', 2, 80), mk('/a', 'y', 40, 1)])
    // (2*80 + 40*1) / 81 = 2.469… → 2.5; the issue's 2 / 80 pair alone gives exactly 2.
    expect(body.summary.avgPosition).toBe(2.5)
    const only = await get([mk('/a', 'x', 2, 80)])
    expect(only.summary.avgPosition).toBe(2)
  })

  it('uses the weighted value for top pages and top queries', async () => {
    const body = await get([
      mk('/a', 'q1', 1, 90),
      mk('/a', 'q2', 11, 10),
      mk('/b', 'q1', 5, 10),
    ])
    const page = (u: string) => body.topPages.find((p: { url: string }) => p.url === u)
    const query = (q: string) => body.topQueries.find((r: { query: string }) => r.query === q)
    expect(page('/a').position).toBe(2) // (1*90 + 11*10) / 100, plain average would be 6
    expect(page('/b').position).toBe(5)
    expect(query('q1').position).toBe(1.4) // (1*90 + 5*10) / 100
    expect(query('q2').position).toBe(11)
    expect(body.summary.avgPosition).toBe(2.3) // (90 + 110 + 50) / 110 = 2.27
  })

  it('falls back to the plain average when no row has impressions', async () => {
    const body = await get([mk('/a', 'x', 2, 0), mk('/a', 'y', 5, 0)])
    expect(body.summary.avgPosition).toBe(3.5)
    expect(body.topPages[0].position).toBe(3.5)
    expect(body.topQueries.map((q: { position: number }) => q.position).sort()).toEqual([2, 5])
  })

  it('ignores zero-impression rows when others have impressions, and position 0 rows', async () => {
    const body = await get([mk('/a', 'x', 4, 10), mk('/a', 'y', 50, 0), mk('/a', 'z', 0, 1000)])
    expect(body.summary.avgPosition).toBe(4)
    expect(body.topPages[0].position).toBe(4)
  })

  it('returns 0 when there is no positive position', async () => {
    const body = await get([mk('/a', 'x', 0, 10)])
    expect(body.summary.avgPosition).toBe(0)
  })

  it('rounds to one decimal', async () => {
    // (1*1 + 2*2) / 3 = 1.666… → 1.7
    const body = await get([mk('/a', 'x', 1, 1), mk('/a', 'y', 2, 2)])
    expect(body.summary.avgPosition).toBe(1.7)
  })
})

describe('SQL store — rank history', () => {
  it('stores one snapshot per query per day', async () => {
    const { store } = setup()
    const snap = (query: string, dateKey: string, position: number) => ({
      query,
      position,
      dateKey,
      snapshotDate: `${dateKey}T04:00:00.000Z`,
    })
    const day1 = Array.from({ length: 25 }, (_, i) => snap(`q${i}`, '2026-10-01', i + 1))
    expect(await store.rankHistory.insertDaily(day1)).toBe(25)
    expect(await store.rankHistory.insertDaily(day1)).toBe(0)
    expect(await store.rankHistory.insertDaily([snap('q0', '2026-10-02', 9)])).toBe(1)
    const [latest] = await store.rankHistory.list({ limit: 1 })
    expect(latest).toMatchObject({ query: 'q0', position: 9, dateKey: '2026-10-02' })
  })
})

describe('SQL store — 404 logs', () => {
  it('creates, increments, and stops creating at the cap', async () => {
    const { store } = setup()
    expect(await store.notFound.record({ url: '/a', type: '404', referrer: 'https://x.test' }, 2)).toBe('created')
    expect(await store.notFound.record({ url: '/a', type: '404' }, 2)).toBe('incremented')
    expect(await store.notFound.record({ url: '/b', type: '404' }, 2)).toBe('created')
    expect(await store.notFound.record({ url: '/c', type: '404' }, 2)).toBe('capped')
    // Known URLs still count past the cap.
    expect(await store.notFound.record({ url: '/b', type: '404' }, 2)).toBe('incremented')
    const logs = await store.notFound.list({ limit: 10 })
    expect(logs.map((l) => [l.url, l.count]).sort()).toEqual([
      ['/a', 2],
      ['/b', 2],
    ])
    // A hit without a referrer keeps the one already stored.
    expect(logs.find((l) => l.url === '/a')!.referrer).toBe('https://x.test')
  })

  it('ignores, removes and clears', async () => {
    const { store } = setup()
    for (const url of ['/a', '/b', '/c']) await store.notFound.record({ url, type: '404' }, 100)
    const byUrl = new Map((await store.notFound.list({ limit: 10 })).map((l) => [l.url, l.id]))
    await store.notFound.ignore(byUrl.get('/a')!)
    await store.notFound.remove(String(byUrl.get('/b')))
    expect((await store.notFound.list({ limit: 10 })).map((l) => l.url)).toEqual(['/c'])
    expect(await store.notFound.clear()).toBe(1)
    const left = await store.notFound.list({ includeIgnored: true, limit: 10 })
    expect(left.map((l) => [l.url, l.ignored])).toEqual([['/a', true]])
  })

  it('round-trips through the seo-logs endpoint', async () => {
    const { store } = setup()
    const handler = createSeoLogsHandler(undefined, undefined, () => store)
    const post = await handler(req(store, { method: 'POST', url: '/seo-logs', body: { url: '/Missing?x=1' } }))
    expect(await post.json()).toEqual({ success: true, action: 'created' })
    const get = await handler(req(store, { method: 'GET', url: '/seo-logs' }))
    const body = await get.json()
    expect(body.logs.map((l: { url: string }) => l.url)).toEqual(['/missing'])
    expect(body.stats).toEqual({ total: 1, totalHits: 1, unique404: 1 })
  })

  it('records in-process with recordSeoNotFound, only when seoLogs is on', async () => {
    const { store } = setup()
    const payload = (enabled: string[]) =>
      ({
        config: { custom: { seoAnalyzer: { store: { resolveStore: () => store, enabled } } } },
        logger: { warn: vi.fn(), error: vi.fn() },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any
    expect(await recordSeoNotFound(payload([]), { url: '/gone' })).toBeNull()
    expect(await recordSeoNotFound(payload(['seo-logs']), { url: '/gone', userAgent: 'B'.repeat(900) })).toBe('created')
    const [log] = await store.notFound.list({ limit: 1 })
    expect(log!.userAgent).toHaveLength(500)
    // Never throws, even when the store does.
    const broken = payload(['seo-logs'])
    broken.config.custom.seoAnalyzer.store.resolveStore = () => {
      throw new Error('binding missing')
    }
    expect(await recordSeoNotFound(broken, { url: '/x' })).toBeNull()
  })
})

describe('SQL store — retention', () => {
  it('prunes by age, then trims to the row cap, newest kept', async () => {
    const { store } = setup()
    for (let day = 1; day <= 9; day++) {
      await store.scoreHistory.insert({
        collection: 'pages',
        documentId: '1',
        score: day,
        snapshotDate: `2026-10-0${day}T00:00:00.000Z`,
      })
    }
    expect(await store.prune('seo-score-history', { before: '2026-10-03T00:00:00.000Z', maxRows: 5 })).toEqual({
      deleted: 4,
    })
    const left = await store.scoreHistory.list({ limit: 100 })
    expect(left.map((s) => s.score)).toEqual([9, 8, 7, 6, 5])
  })

  it('runs as purgeRetention with the defaults for enabled datasets', async () => {
    const { store } = setup()
    await store.notFound.record({ url: '/old', type: '404', at: '2025-01-01T00:00:00.000Z' }, 100)
    await store.notFound.record({ url: '/new', type: '404' }, 100)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await purgeRetention({} as any, undefined, { enabled: ['seo-logs'], store })
    expect(result.ran).toBe(true)
    expect(result.results).toEqual([expect.objectContaining({ collection: 'seo-logs', deleted: 1 })])
    expect((await store.notFound.list({ limit: 10 })).map((l) => l.url)).toEqual(['/new'])
  })
})
