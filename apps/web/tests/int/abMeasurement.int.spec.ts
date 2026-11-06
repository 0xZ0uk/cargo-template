import { describe, expect, it, vi } from 'vitest'

import {
  abMeasurementConfig,
  abResultsQuery,
  getAbResults,
  mapAbResultRows,
  recordImpression,
  writeAbEvent,
} from '@/plugins/abMeasurement'

const KEY = '/pricing'
const MARKER = 'payload_ab_seen_pricing'

const fakeDataset = () => {
  const writeDataPoint = vi.fn()
  return { dataset: { writeDataPoint } as unknown as AnalyticsEngineDataset, writeDataPoint }
}

describe('recordImpression', () => {
  it('counts the first view and sets an HttpOnly marker holding the bucket', () => {
    const { dataset, writeDataPoint } = fakeDataset()
    const marker = recordImpression(dataset, 'ab_visitor_id=v1', KEY, { bucket: 'pricing--b2' })

    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: [KEY],
      blobs: [KEY, 'pricing--b2', 'impression', ''],
      doubles: [1],
    })
    expect(marker).toMatch(
      /^payload_ab_seen_pricing=pricing--b2; Path=\/; .*SameSite=Lax; HttpOnly$/,
    )
  })

  it("doesn't count a view that carries the marker (server-function re-runs, reloads)", () => {
    const { dataset, writeDataPoint } = fakeDataset()
    const cookie = `ab_visitor_id=v1; ${MARKER}=original`
    expect(recordImpression(dataset, cookie, KEY, { bucket: 'original' })).toBeNull()
    expect(writeDataPoint).not.toHaveBeenCalled()
  })

  it('counts a visitor again in a new bucket (their variant was deleted and they were redrawn)', () => {
    const { dataset, writeDataPoint } = fakeDataset()
    const marker = recordImpression(dataset, `${MARKER}=pricing--gone`, KEY, { bucket: 'original' })
    expect(writeDataPoint).toHaveBeenCalledTimes(1)
    expect(marker).toMatch(/^payload_ab_seen_pricing=original;/)
  })

  it('still dedupes without the binding (local dev), and writes nothing', () => {
    expect(recordImpression(undefined, '', KEY, { bucket: 'original' })).toMatch(
      /^payload_ab_seen_pricing=/,
    )
  })
})

describe('writeAbEvent', () => {
  it('writes no personal data and cuts the index to 96 bytes', () => {
    const { dataset, writeDataPoint } = fakeDataset()
    const long = `/${'é'.repeat(60)}`
    writeAbEvent(dataset, {
      experiment: long,
      bucket: 'original',
      event: 'conversion',
      goal: 'cta',
    })
    const point = writeDataPoint.mock.calls[0]![0]
    expect(new TextEncoder().encode(point.indexes[0]).length).toBeLessThanOrEqual(96)
    expect(point.blobs).toEqual([long, 'original', 'conversion', 'cta'])
  })

  it('never throws into the page when the write fails', () => {
    const dataset = {
      writeDataPoint: () => {
        throw new Error('quota')
      },
    } as unknown as AnalyticsEngineDataset
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      writeAbEvent(dataset, { experiment: KEY, bucket: 'original', event: 'impression' }),
    ).not.toThrow()
    error.mockRestore()
  })
})

describe('abResultsQuery', () => {
  it('filters on the key and the start (UTC), and escapes the key', () => {
    const sql = abResultsQuery("/it's\\here", '2026-11-01T10:20:30.000Z')
    expect(sql).toContain(`WHERE blob1 = '/it\\'s\\\\here'`)
    expect(sql).toContain(`timestamp >= toDateTime('2026-11-01 10:20:30')`)
    expect(sql).toContain('SUM(_sample_interval) AS count')
    expect(sql).toContain('FROM cargo_ab')
  })
})

describe('mapAbResultRows', () => {
  it('folds rows per bucket and event, with counts as numbers or strings', () => {
    expect(
      mapAbResultRows([
        { bucket: 'original', event: 'impression', count: '120' },
        { bucket: 'original', event: 'conversion', count: 6 },
        { bucket: 'pricing--b2', event: 'impression', count: 100 },
        { bucket: 'pricing--gone', event: 'conversion', count: '2' },
        { bucket: 'original', event: 'other', count: 1 },
        { bucket: '', event: 'impression', count: 1 },
      ]),
    ).toEqual([
      { bucket: 'original', impressions: 120, conversions: 6 },
      { bucket: 'pricing--b2', impressions: 100, conversions: 0 },
      { bucket: 'pricing--gone', impressions: 0, conversions: 2 },
    ])
  })
})

describe('getAbResults', () => {
  const args = { experiment: KEY, startedAt: '2026-11-01T00:00:00.000Z' }

  it('reports measurement as not configured without credentials, and sends nothing', async () => {
    const fetchMock = vi.fn()
    for (const credentials of [{}, { accountId: 'acc' }, { apiToken: 'tok' }]) {
      const results = await getAbResults(args, credentials, fetchMock)
      expect(results).toMatchObject({ configured: false })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('queries the SQL API with the token and maps the rows', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        meta: [],
        data: [
          { bucket: 'original', event: 'impression', count: '10' },
          { bucket: 'original', event: 'conversion', count: '1' },
        ],
        rows: 2,
      }),
    )
    const results = await getAbResults(args, { accountId: 'acc 1', apiToken: 'tok' }, fetchMock)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acc%201/analytics_engine/sql')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(init.body).toBe(abResultsQuery(args.experiment, args.startedAt))
    expect(results).toEqual({
      configured: true,
      buckets: [{ bucket: 'original', impressions: 10, conversions: 1 }],
      retentionDays: 90,
    })
  })

  it('throws on an API error without the token in the message', async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"errors":[{"message":"Authentication error"}]}', { status: 403 }),
    )
    const error = await getAbResults(
      args,
      { accountId: 'acc', apiToken: 'secret-token' },
      fetchMock,
    ).catch((e) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('403')
    expect(error.message).toContain('Authentication error')
    expect(error.message).not.toContain('secret-token')
  })
})

describe('abMeasurementConfig', () => {
  it('writes conversions to the binding, without the visitor id', async () => {
    const { dataset, writeDataPoint } = fakeDataset()
    const config = abMeasurementConfig({ AB_ANALYTICS: dataset })
    await config.recordConversion(
      { experiment: KEY, bucket: 'original', goal: 'cta', visitorId: 'v1' },
      {} as never,
    )
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: [KEY],
      blobs: [KEY, 'original', 'conversion', 'cta'],
      doubles: [1],
    })
    expect(JSON.stringify(writeDataPoint.mock.calls)).not.toContain('v1')
  })
})
