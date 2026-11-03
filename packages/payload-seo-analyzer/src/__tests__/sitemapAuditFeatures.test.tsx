// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// The Sitemap Audit view has two tabs backed by optional features (404 logs → `seoLogs`,
// external links → `externalLinks`). With the feature off, the endpoint isn't registered,
// so fetching it costs a request and a 404 in the browser console on every visit.
let features: Record<string, boolean> | undefined
vi.mock('@payloadcms/ui', async () => {
  const { payloadUiStub } = await import('./helpers/payloadUiStub.js')
  return {
    ...payloadUiStub,
    useConfig: () => ({
      config: {
        routes: { api: '/api', admin: '/admin' },
        admin: { custom: { seoAnalyzer: { endpointBasePath: '/seo-plugin', features } } },
      },
    }),
    useLocale: () => ({}),
    useTranslation: () => ({ i18n: { language: 'en' } }),
  }
})

import { SitemapAuditView } from '../components/SitemapAuditView.js'

const auditBody = {
  orphanPages: [],
  weakPages: [],
  linkHubs: [],
  brokenLinks: [],
  stats: { totalPages: 1, totalLinks: 0, avgLinksPerPage: 0, orphanCount: 0, weakCount: 0, hubCount: 0, brokenCount: 0 },
}

function mockFetch() {
  const fn = vi.fn(async (url: string) => {
    const body = url.includes('/sitemap-audit') ? auditBody : url.includes('/seo-logs') ? { logs: [] } : { results: [] }
    return { ok: true, status: 200, json: async () => body }
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = fn
  return fn
}

const requested = (fn: ReturnType<typeof mockFetch>) => fn.mock.calls.map(([url]) => String(url))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
beforeEach(() => {
  features = undefined
})

describe('SitemapAuditView — optional tabs follow the feature flags', () => {
  it('does not fetch /seo-logs nor show the 404 / external tabs when the features are off', async () => {
    features = { seoLogs: false, externalLinks: false }
    const fetch = mockFetch()
    render(<SitemapAuditView />)
    expect(await screen.findByRole('tab', { name: /orphan/i })).toBeTruthy()
    expect(requested(fetch).some((u) => u.includes('/seo-logs'))).toBe(false)
    expect(screen.queryByRole('tab', { name: /404/i })).toBeNull()
    expect(screen.queryByRole('tab', { name: /external/i })).toBeNull()
  })

  it('keeps both tabs (and the 404 count fetch) when the flags are on or unavailable', async () => {
    const fetch = mockFetch()
    render(<SitemapAuditView />)
    expect(await screen.findByRole('tab', { name: /404/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /external/i })).toBeTruthy()
    expect(requested(fetch).some((u) => u.includes('/api/seo-plugin/seo-logs'))).toBe(true)
  })

  it('labels the bulk 301 buttons in the admin language', async () => {
    const fetch = mockFetch()
    const broken = { sourceId: 1, sourceTitle: 'A', sourceSlug: 'a', targetUrl: '/gone', targetSlug: 'gone', collection: 'pages', suggestedSlug: 'b' }
    auditBody.brokenLinks = [broken] as never[]
    auditBody.stats = { ...auditBody.stats, brokenCount: 1 }
    try {
      render(<SitemapAuditView />)
      expect(await screen.findByRole('button', { name: '301 all (1)' })).toBeTruthy()
      expect(screen.queryByText(/301 tout/)).toBeNull()
      expect(fetch).toHaveBeenCalled()
    } finally {
      auditBody.brokenLinks = []
      auditBody.stats = { ...auditBody.stats, brokenCount: 0 }
    }
  })
})
