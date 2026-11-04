// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

vi.mock('@payloadcms/ui', async () => ({
  ...(await import('./helpers/payloadUiStub.js')).payloadUiStub,
  useTranslation: () => ({ i18n: { language: 'en' } }),
  useLocale: () => ({}),
}))

import { SeoView } from '../components/SeoView.js'

const item = (id: number, title: string, score: number) => ({
  id,
  title,
  slug: `p-${id}`,
  collection: 'pages',
  score,
  level: 'good',
  status: 'published',
  focusKeyword: 'kw',
  metaTitle: 'm',
  metaDescription: 'd',
  wordCount: 100,
  readabilityScore: 60,
  headingCount: 1,
  hasH1: true,
  h1Count: 1,
  internalLinkCount: 0,
  updatedAt: '2026-11-01T00:00:00.000Z',
  isCornerstone: false,
  contentLastReviewed: '',
  daysSinceUpdate: 1,
})

const stats = (n: number, avgScore: number) => ({
  totalPages: n,
  avgScore,
  good: n,
  needsWork: 0,
  critical: 0,
  noKeyword: 0,
  noMetaTitle: 0,
  noMetaDesc: 0,
  avgWordCount: 100,
  avgReadability: 60,
})

const audit = (results: unknown[], extra: Record<string, unknown>) => ({
  results,
  stats: stats(results.length, 80),
  pagination: { page: 1, totalPages: 1 },
  cached: true,
  ...extra,
})

const OLD = Date.UTC(2026, 10, 3, 9, 30)

function stubFetch(auditResponses: Array<{ status?: number; body: unknown }>) {
  const auditUrls: string[] = []
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/audit?')) {
      auditUrls.push(url)
      const next = auditResponses.length > 1 ? auditResponses.shift()! : auditResponses[0]
      return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
    }
    return new Response(JSON.stringify({}), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return auditUrls
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('dashboard: stale audit while a newer one builds', () => {
  it('shows the stale audit with a note, starts the rebuild, and swaps in the new audit', async () => {
    const auditUrls = stubFetch([
      // Dashboard open (peek): a stale audit, nothing building.
      { body: audit([item(1, 'Old title', 40)], { builtAt: OLD, stale: true }) },
      // The follow-up poll (no noBuild) starts the rebuild.
      { body: audit([item(1, 'Old title', 40)], { builtAt: OLD, stale: true, refreshing: true }) },
      // The rebuild landed.
      { body: audit([item(1, 'New title', 90)], { builtAt: OLD + 60_000 }) },
    ])
    render(<SeoView />)

    expect(await screen.findByText('Old title')).toBeTruthy()
    // No "building" placeholder: the old results are on screen, with the note.
    expect(screen.queryByText(/Building the SEO audit/)).toBeNull()
    expect(await screen.findByText(/Showing results from .*refreshing…/)).toBeTruthy()
    expect(auditUrls[0]).toContain('noBuild=1')
    expect(auditUrls[1]).not.toContain('noBuild=1')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    expect(await screen.findByText('New title')).toBeTruthy()
    expect(screen.queryByText(/Showing results from/)).toBeNull()
  })

  it('shows each finished build, even one that is already stale again', async () => {
    stubFetch([
      { body: audit([item(1, 'First', 40)], { builtAt: OLD, refreshing: true }) },
      // A build finished, but a save landed while it ran: shown, still refreshing.
      { body: audit([item(1, 'Second', 50)], { builtAt: OLD + 1000, stale: true, refreshing: true }) },
      { body: audit([item(1, 'Third', 60)], { builtAt: OLD + 2000 }) },
    ])
    render(<SeoView />)
    expect(await screen.findByText('First')).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    expect(await screen.findByText('Second')).toBeTruthy()
    expect(screen.getByText(/Showing results from .*refreshing…/)).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    expect(await screen.findByText('Third')).toBeTruthy()
    expect(screen.queryByText(/Showing results from/)).toBeNull()
  })

  it('shows no note for a current audit', async () => {
    const auditUrls = stubFetch([{ body: audit([item(1, 'Current', 90)], { builtAt: OLD }) }])
    render(<SeoView />)
    expect(await screen.findByText('Current')).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    expect(screen.queryByText(/Showing results from/)).toBeNull()
    expect(auditUrls).toHaveLength(1)
  })
})
