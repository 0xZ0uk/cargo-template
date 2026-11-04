import { afterEach, describe, it, expect, vi } from 'vitest'
import { buildAlertDigest, createAlertsRunHandler, deliverAlertDigest, type AlertConfig } from '../endpoints/alerts.js'

const cfg: AlertConfig = {
  webhookUrl: '',
  emails: [],
  scoreDrop: 10,
  positionDrop: 5,
  windowHours: 24,
}

// Minimal payload mock — returns canned docs per collection (where/sort are ignored;
// docs are provided already newest-first to match the real -snapshotDate sort).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakePayload(data: Record<string, any[]>): any {
  return {
    logger: { warn() {}, error() {}, info() {} },
    async find({ collection }: { collection: string }) {
      return { docs: data[collection] || [] }
    },
  }
}

describe('buildAlertDigest', () => {
  it('flags a score regression at/above the threshold', async () => {
    const payload = fakePayload({
      'seo-score-history': [
        { documentId: '1', collection: 'pages', score: 60, snapshotDate: '2026-06-23' },
        { documentId: '1', collection: 'pages', score: 85, snapshotDate: '2026-06-10' },
      ],
    })
    const d = await buildAlertDigest(payload, cfg)
    expect(d.scoreRegressions).toHaveLength(1)
    expect(d.scoreRegressions[0]).toMatchObject({ from: 85, to: 60, drop: 25 })
  })

  it('ignores a score drop below the threshold', async () => {
    const payload = fakePayload({
      'seo-score-history': [
        { documentId: '1', collection: 'pages', score: 80, snapshotDate: '2026-06-23' },
        { documentId: '1', collection: 'pages', score: 85, snapshotDate: '2026-06-10' },
      ],
    })
    const d = await buildAlertDigest(payload, cfg)
    expect(d.scoreRegressions).toHaveLength(0)
  })

  it('reports new 404s', async () => {
    const payload = fakePayload({
      'seo-logs': [{ url: '/gone', count: 4, lastSeen: '2026-06-23' }],
    })
    const d = await buildAlertDigest(payload, cfg)
    expect(d.newNotFound).toEqual([{ url: '/gone', count: 4, lastSeen: '2026-06-23' }])
  })

  it('flags a ranking drop at/above the threshold', async () => {
    const payload = fakePayload({
      'seo-rank-history': [
        { query: 'plombier paris', position: 12, dateKey: '2026-06-23', snapshotDate: '2026-06-23T08:00:00Z' },
        { query: 'plombier paris', position: 5, dateKey: '2026-06-22', snapshotDate: '2026-06-22T08:00:00Z' },
      ],
    })
    const d = await buildAlertDigest(payload, cfg)
    expect(d.rankDrops).toHaveLength(1)
    expect(d.rankDrops[0]).toMatchObject({ query: 'plombier paris', from: 5, to: 12, drop: 7 })
  })

  it('does not flag an improvement', async () => {
    const payload = fakePayload({
      'seo-rank-history': [
        { query: 'x', position: 3, dateKey: '2026-06-23', snapshotDate: '2026-06-23T08:00:00Z' },
        { query: 'x', position: 9, dateKey: '2026-06-22', snapshotDate: '2026-06-22T08:00:00Z' },
      ],
    })
    const d = await buildAlertDigest(payload, cfg)
    expect(d.rankDrops).toHaveLength(0)
  })

  it('sums totalIssues across all sources', async () => {
    const payload = fakePayload({
      'seo-score-history': [
        { documentId: '1', collection: 'pages', score: 50, snapshotDate: '2026-06-23' },
        { documentId: '1', collection: 'pages', score: 90, snapshotDate: '2026-06-10' },
      ],
      'seo-logs': [{ url: '/a', count: 1, lastSeen: '2026-06-23' }],
    })
    const d = await buildAlertDigest(payload, cfg)
    expect(d.totalIssues).toBe(2)
  })
})

describe('deliverAlertDigest', () => {
  const digest = {
    since: '2026-11-03T00:00:00Z',
    generatedAt: '2026-11-04T00:00:00Z',
    scoreRegressions: [],
    newNotFound: [{ url: '/gone', count: 2, lastSeen: '2026-11-04' }],
    rankDrops: [],
    totalIssues: 1,
  }
  const logger = () => ({ warn: vi.fn(), error() {}, info() {} })

  afterEach(() => vi.restoreAllMocks())

  it('posts the digest to the webhook and reports it sent on a 2xx', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await deliverAlertDigest({ logger: logger() } as any, digest, { ...cfg, webhookUrl: 'https://hook.test/x' }, 'https://site.test')
    expect(r).toEqual({ sent: true, reason: undefined, channels: { webhook: true, email: false } })
    const [url, init] = spy.mock.calls[0]!
    expect(url).toBe('https://hook.test/x')
    expect(JSON.parse(String(init!.body))).toMatchObject({ type: 'seo-alert-digest', siteUrl: 'https://site.test', digest })
    expect(init!.signal).toBeInstanceOf(AbortSignal)
  })

  it('treats a 4xx/5xx from the webhook as a failed delivery, and logs the status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('gone', { status: 404 }))
    const log = logger()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await deliverAlertDigest({ logger: log } as any, digest, { ...cfg, webhookUrl: 'https://hook.test/x' })
    expect(r).toEqual({ sent: false, reason: 'delivery_failed', channels: { webhook: false, email: false } })
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 404'))
  })

  it('says no channel is configured only when none is, and warns about emails without an adapter', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r = await deliverAlertDigest({ logger: logger() } as any, digest, cfg)
    expect(r.reason).toBe('no_channel_configured')
    const log = logger()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r = await deliverAlertDigest({ logger: log } as any, digest, { ...cfg, emails: ['a@b.test'] })
    expect(r.reason).toBe('delivery_failed')
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('no email adapter'))
  })

  it('sends nothing when there is nothing to report', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await deliverAlertDigest({ logger: logger() } as any, { ...digest, newNotFound: [], totalIssues: 0 }, { ...cfg, webhookUrl: 'https://hook.test/x' })
    expect(r.reason).toBe('nothing_to_report')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('POST /alerts-run', () => {
  afterEach(() => vi.restoreAllMocks())

  it("names the site by the request's origin when no site URL is configured", async () => {
    vi.stubEnv('SEO_ALERT_WEBHOOK_URL', 'https://hook.test/x')
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    const store = {
      scoreHistory: { list: async () => [] },
      notFound: { list: async () => [{ url: '/gone', count: 1, lastSeen: '2026-11-04' }] },
      rankHistory: { list: async () => [] },
    }
    const handler = createAlertsRunHandler(undefined, (() => store) as never)
    const res = await handler({
      url: 'https://cargo.example/api/seo-plugin/alerts-run',
      user: { id: 1, collection: 'users' },
      payload: { config: { admin: { user: 'users' } }, logger: { warn() {}, error() {}, info() {} } },
    } as never)
    expect((await res.json()).delivery.sent).toBe(true)
    expect(JSON.parse(String(spy.mock.calls[0]![1]!.body)).siteUrl).toBe('https://cargo.example')
    vi.unstubAllEnvs()
  })
})
