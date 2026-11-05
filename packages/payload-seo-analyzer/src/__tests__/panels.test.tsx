// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// @payloadcms/ui imports CSS the jsdom loader cannot parse. The panels only read
// the plugin's feature flags from the client config (`admin.custom`): left
// undefined here, as for a component mounted outside the plugin, they probe the
// endpoint and treat a 404 as "feature off".
let features: Record<string, boolean> | undefined
vi.mock('@payloadcms/ui', async () => ({
  ...(await import('./helpers/payloadUiStub.js')).payloadUiStub,
  useConfig: () => ({ config: { admin: { custom: { seoAnalyzer: { features } } } } }),
  useLocale: () => ({}),
}))

import { RankTrackingPanel } from '../components/RankTrackingPanel.js'
import { CtrOpportunitiesPanel } from '../components/CtrOpportunitiesPanel.js'
import { AlertsPanel } from '../components/AlertsPanel.js'
import { HealthPanel } from '../components/HealthPanel.js'
import { CoreWebVitalsPanel, formatMeasuredAgo } from '../components/CoreWebVitalsPanel.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockFetch(status: number, body: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
beforeEach(() => {
  vi.restoreAllMocks()
  features = undefined
})

describe('UI panels — feature flags from the client config', () => {
  // A registered-nowhere endpoint still costs a request and a 404 in the
  // browser console on every visit to the Performance view.
  it('does not call the endpoints of a disabled feature', async () => {
    features = { gscApi: false, alerts: false }
    mockFetch(500, {})
    render(
      <>
        <RankTrackingPanel />
        <CtrOpportunitiesPanel />
        <AlertsPanel />
      </>,
    )
    expect((await screen.findAllByText(/Connect Google Search Console/i)).length).toBe(2)
    expect(await screen.findByText(/No channel configured/i)).toBeTruthy()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((globalThis as any).fetch).not.toHaveBeenCalled()
  })
})

describe('UI panels — render smoke (jsdom)', () => {
  it('RankTrackingPanel: 404 (feature off) → graceful "connect GSC", not "Error 404"', async () => {
    mockFetch(404, { error: 'Not Found' })
    render(<RankTrackingPanel />)
    expect(await screen.findByText(/Connect Google Search Console/i)).toBeTruthy()
    expect(screen.queryByText(/Error 404/i)).toBeNull()
  })

  it('RankTrackingPanel: data → shows the query row', async () => {
    mockFetch(200, {
      count: 1,
      lastSnapshot: '2026-06-24T08:00:00Z',
      movers: [
        { query: 'plumber boston', page: null, position: 5, previousPosition: 3, delta: -2, clicks: 10, impressions: 100, ctr: 0.1, snapshotDate: '2026-06-24T08:00:00Z' },
      ],
    })
    render(<RankTrackingPanel />)
    expect(await screen.findByText('plumber boston')).toBeTruthy()
  })

  it('CtrOpportunitiesPanel: 404 (feature off) → graceful "connect GSC", not "Error 404"', async () => {
    mockFetch(404, { error: 'Not Found' })
    render(<CtrOpportunitiesPanel />)
    expect(await screen.findByText(/Connect Google Search Console/i)).toBeTruthy()
    expect(screen.queryByText(/Error 404/i)).toBeNull()
  })

  it('CtrOpportunitiesPanel: data → shows an opportunity row', async () => {
    mockFetch(200, {
      count: 1,
      opportunities: [
        { url: 'https://example.com/about-us', impressions: 1000, clicks: 5, ctr: 0.005, position: 4, expectedCtr: 0.07, potentialClicks: 65, doc: null },
      ],
    })
    render(<CtrOpportunitiesPanel />)
    expect(await screen.findByText(/about-us/)).toBeTruthy()
    expect(await screen.findByText(/\+65/)).toBeTruthy()
  })

  it('AlertsPanel: 404 (feature off) → shows the "no channel / disabled" hint, not an error', async () => {
    mockFetch(404, { error: 'Not Found' })
    render(<AlertsPanel />)
    expect(await screen.findByText(/No channel configured/i)).toBeTruthy()
  })

  it('HealthPanel: renders status + warnings from /health', async () => {
    mockFetch(200, {
      ok: false,
      config: { aiKey: true, pageSpeedKey: false, gscConfigured: false, alertWebhook: false, alertEmail: false },
      runtime: { gscConnected: false, lastRankSnapshot: null },
      warnings: ['No alert channel configured'],
    })
    render(<HealthPanel />)
    expect(await screen.findByText(/SEO module health/i)).toBeTruthy()
    expect(await screen.findByText(/No alert channel configured/i)).toBeTruthy()
  })
})

describe('CoreWebVitalsPanel — when it was measured', () => {
  const metric = (value: number, unit: string) => ({ value, unit, rating: 'good' })
  const cwv = (extra: Record<string, unknown>) => ({
    url: 'http://localhost/',
    strategy: 'mobile',
    source: 'field',
    hasFieldData: true,
    keyConfigured: true,
    metrics: { lcp: metric(2000, 'ms'), inp: metric(100, 'ms'), cls: metric(0.05, 'score'), tbt: metric(50, 'ms') },
    ...extra,
  })

  it('shows "Measured <relative time>" next to the data source', async () => {
    mockFetch(200, cwv({ builtAt: Date.now() - 3 * 3_600_000 }))
    render(<CoreWebVitalsPanel />)
    fireEvent.click(screen.getByText('Test'))
    expect(await screen.findByText(/Field data \(real users, CrUX\) · Measured 3 hours ago/)).toBeTruthy()
  })

  it('omits it when the result has no builtAt (in-memory cache)', async () => {
    mockFetch(200, cwv({ cached: true }))
    render(<CoreWebVitalsPanel />)
    fireEvent.click(screen.getByText('Test'))
    expect(await screen.findByText(/Field data \(real users, CrUX\)/)).toBeTruthy()
    expect(screen.queryByText(/Measured/)).toBeNull()
  })

  it('formats the age in the largest whole unit', () => {
    const now = 1_000_000_000_000
    expect(formatMeasuredAgo(now - 5_000, now)).toBe('just now')
    expect(formatMeasuredAgo(now - 5 * 60_000, now)).toBe('5 minutes ago')
    expect(formatMeasuredAgo(now - 90 * 60_000, now)).toBe('1 hour ago')
    expect(formatMeasuredAgo(now - 49 * 3_600_000, now)).toBe('2 days ago')
    expect(formatMeasuredAgo(now + 5_000, now)).toBe('just now')
  })
})
