// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@payloadcms/ui', async () => ({
  ...(await import('./helpers/payloadUiStub.js')).payloadUiStub,
  useTranslation: () => ({ i18n: { language: 'en' } }),
  useLocale: () => ({}),
}))

import { SeoView } from '../components/SeoView.js'
import { resetModalStub } from './helpers/payloadUiStub.js'

const basePage = {
  id: 1,
  title: 'Coffee',
  slug: 'coffee',
  collection: 'pages',
  score: 78,
  level: 'good',
  status: 'published',
  focusKeyword: 'coffee',
  metaTitle: 'Coffee brewing basics',
  metaDescription: 'Learn to brew better coffee at home.',
  wordCount: 400,
  readabilityScore: 80,
  headingCount: 2,
  hasH1: true,
  h1Count: 1,
  internalLinkCount: 2,
  updatedAt: '2026-11-01T00:00:00.000Z',
  isCornerstone: false,
  contentLastReviewed: '',
  daysSinceUpdate: 1,
}

const audit = (pages: Array<typeof basePage>) => ({
  results: pages,
  stats: {
    totalPages: pages.length,
    avgScore: 78,
    good: 0,
    needsWork: pages.length,
    critical: 0,
    noKeyword: 0,
    noMetaTitle: 0,
    noMetaDesc: 0,
    avgWordCount: 400,
    avgReadability: 80,
  },
  pagination: { page: 1, totalPages: 1 },
  cached: true,
  builtAt: Date.UTC(2026, 10, 3, 9, 30),
})

function stubFetch(pages: Array<typeof basePage>, bulk: () => Response) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/audit?')) return new Response(JSON.stringify(audit(pages)), { status: 200 })
    if (url.includes('/ai-optimize-bulk')) return bulk()
    return new Response(JSON.stringify({}), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const bulkCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes('/ai-optimize-bulk')).length

async function clickOptimizeSite() {
  render(<SeoView />)
  await screen.findByText('Coffee')
  const trigger = screen.getByRole('button', { name: 'Optimize site' }) as HTMLButtonElement
  await waitFor(() => expect(trigger.disabled).toBe(false))
  fireEvent.click(trigger)
}

beforeEach(() => resetModalStub())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('"Optimize site" feedback', () => {
  it('says there is nothing to optimize instead of doing nothing', async () => {
    const fetchMock = stubFetch([basePage], () => new Response('{}', { status: 200 }))
    await clickOptimizeSite()
    expect(await screen.findByText(/^Nothing to optimize/)).toBeTruthy()
    expect(bulkCalls(fetchMock)).toBe(0)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reports a failed proposal request', async () => {
    const fetchMock = stubFetch([{ ...basePage, focusKeyword: '' }], () => new Response('{}', { status: 429 }))
    await clickOptimizeSite()
    expect(await screen.findByText("Couldn't get AI suggestions (HTTP 429). Try again in a minute.")).toBeTruthy()
    expect(bulkCalls(fetchMock)).toBe(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reports a network failure', async () => {
    stubFetch([{ ...basePage, focusKeyword: '' }], () => {
      throw new TypeError('Failed to fetch')
    })
    await clickOptimizeSite()
    expect(await screen.findByText("Couldn't get AI suggestions (Network error). Try again in a minute.")).toBeTruthy()
  })
})

describe('bulk selection bar', () => {
  it('counts the selection without a stray plural', async () => {
    stubFetch([basePage, { ...basePage, id: 2, title: 'Tea', slug: 'tea' }], () => new Response('{}', { status: 200 }))
    render(<SeoView />)
    await screen.findByText('Coffee')
    for (const box of screen.getAllByRole('checkbox', { name: /Coffee|Tea/ })) fireEvent.click(box)
    expect(await screen.findByText('2 selected')).toBeTruthy()
    expect(screen.queryByText(/selecteds/)).toBeNull()
  })
})
