// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@payloadcms/ui', async () => (await import('./helpers/payloadUiStub.js')).payloadUiStub)

import { loadRemainingAuditPages } from '../components/SeoView.js'

const row = (id: number) => ({ id, collection: 'pages' }) as never

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dashboard audit paging', () => {
  it('fetches every remaining page of the cached audit without starting a build', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const page = Number(new URL(url, 'http://x').searchParams.get('page'))
      return new Response(JSON.stringify({ results: [row(page * 10)], pagination: { page, totalPages: 3 } }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const items = await loadRemainingAuditPages(
      { results: [row(1)], pagination: { page: 1, totalPages: 3 } },
      '/api/seo-plugin/audit?limit=500',
    )

    expect(items.map((i: { id: number }) => i.id)).toEqual([1, 20, 30])
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([
      '/api/seo-plugin/audit?limit=500&noBuild=1&page=2',
      '/api/seo-plugin/audit?limit=500&noBuild=1&page=3',
    ])
  })

  it('stops and keeps what it has when the cache is dropped mid-way', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ notBuilt: true, results: [] }))))
    const items = await loadRemainingAuditPages(
      { results: [row(1)], pagination: { page: 1, totalPages: 4 } },
      '/api/seo-plugin/audit?limit=500',
    )
    expect(items).toHaveLength(1)
  })

  it('makes no extra request for a single page', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await loadRemainingAuditPages({ results: [row(1)], pagination: { page: 1, totalPages: 1 } }, '/a?limit=500')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
