// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@payloadcms/ui', async () => ({
  ...(await import('./helpers/payloadUiStub.js')).payloadUiStub,
  useConfig: () => ({
    config: {
      routes: { api: '/cms-api' },
      collections: [
        { slug: 'pages', labels: { plural: 'Pages' }, fields: [{ name: 'title' }, { name: 'slug' }] },
        { slug: 'posts', labels: { plural: 'Posts' }, fields: [{ name: 'title' }] },
        { slug: 'media', labels: { plural: 'Media' }, fields: [{ name: 'alt' }] },
      ],
      admin: { custom: { seoAnalyzer: { endpointBasePath: '/seo', collections: ['pages', 'posts'] } } },
    },
  }),
  useLocale: () => ({}),
}))

import { SchemaBuilderView } from '../components/SchemaBuilderView.js'

const generated = {
  type: 'FAQPage',
  jsonLd: { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [] },
  warnings: ['No Q&A found: FAQPage has an empty mainEntity.'],
  html: '<script type="application/ld+json">{"@type":"FAQPage"}</script>',
}

/** Routes the REST document list and `/schema-generator`; `generatorStatus` simulates an endpoint error. */
function mockApi(generatorStatus = 200, generatorBody: unknown = generated) {
  const fn = vi.fn(async (url: string) => {
    if (url.includes('/schema-generator')) {
      return { ok: generatorStatus < 400, status: generatorStatus, json: async () => generatorBody }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ docs: [{ id: 7, title: 'About us', slug: 'about' }, { id: 8, slug: 'contact' }] }),
    }
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = fn
  return fn
}

const urls = (fn: ReturnType<typeof mockApi>) => fn.mock.calls.map(([u]) => String(u))

async function openPageMode() {
  fireEvent.click(screen.getByRole('tab', { name: 'Generate from page' }))
  await screen.findByRole('option', { name: 'About us' })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Schema builder: page mode', () => {
  it('starts in manual mode and makes no request', () => {
    const fn = mockApi()
    render(<SchemaBuilderView />)
    expect(screen.getByRole('tab', { name: 'Build by hand' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Local Business' })).toBeTruthy()
    expect(fn).not.toHaveBeenCalled()
  })

  it('lists only the analyzed collections and the documents of the first one, via routes.api', async () => {
    const fn = mockApi()
    render(<SchemaBuilderView />)
    await openPageMode()
    expect(screen.getAllByRole('option', { name: /^(Pages|Posts|Media)$/ }).map((o) => o.textContent)).toEqual(['Pages', 'Posts'])
    // Label falls back to the slug when a document has no title.
    expect(screen.getByRole('option', { name: 'contact' })).toBeTruthy()
    const [listUrl] = urls(fn)
    expect(listUrl.startsWith('/cms-api/pages?')).toBe(true)
    expect(listUrl).not.toContain('/schema-generator')
  })

  it('picking a document loads /schema-generator and renders the JSON-LD, type and warnings', async () => {
    const fn = mockApi()
    render(<SchemaBuilderView />)
    await openPageMode()
    fireEvent.change(screen.getByLabelText('Document'), { target: { value: '7' } })

    expect(await screen.findByText(/Generated type: FAQPage/)).toBeTruthy()
    expect(screen.getByRole('region', { name: 'JSON-LD Preview' }).textContent).toContain('"@type": "FAQPage"')
    expect(screen.getByText('No Q&A found: FAQPage has an empty mainEntity.').closest('.banner--type-warning')).toBeTruthy()

    const generatorUrls = urls(fn).filter((u) => u.includes('/schema-generator'))
    expect(generatorUrls).toEqual(['/cms-api/seo/schema-generator?collection=pages&id=7'])
  })

  it('forces the chosen schema type in the query, and copies the endpoint html', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const fn = mockApi()
    render(<SchemaBuilderView />)
    await openPageMode()
    fireEvent.change(screen.getByLabelText('Document'), { target: { value: '7' } })
    await screen.findByText(/Generated type/)
    fireEvent.change(screen.getByLabelText('Schema type'), { target: { value: 'Article' } })
    await waitFor(() =>
      expect(urls(fn).filter((u) => u.includes('/schema-generator')).pop()).toBe(
        '/cms-api/seo/schema-generator?collection=pages&id=7&type=Article',
      ),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Copy script tag' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(generated.html))
  })

  it('searches the documents by the title and slug fields the collection has', async () => {
    const fn = mockApi()
    render(<SchemaBuilderView />)
    await openPageMode()
    fireEvent.change(screen.getByLabelText('Collection'), { target: { value: 'posts' } })
    fireEvent.change(screen.getByLabelText('Search by title or slug'), { target: { value: 'hello' } })
    await waitFor(() => expect(urls(fn).some((u) => u.includes('/cms-api/posts?') && u.includes('hello'))).toBe(true))
    const search = decodeURIComponent(urls(fn).find((u) => u.includes('hello'))!)
    expect(search).toContain('where[or][0][title][like]=hello')
    // `posts` has no slug field, so it is not queried.
    expect(search).not.toContain('[slug][like]')
  })

  it('shows an error banner when the endpoint refuses', async () => {
    mockApi(403, { error: 'Collection not allowed' })
    render(<SchemaBuilderView />)
    await openPageMode()
    fireEvent.change(screen.getByLabelText('Document'), { target: { value: '7' } })
    const banner = await screen.findByText('Collection not allowed')
    expect(banner.closest('.banner--type-danger')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'JSON-LD Preview' })).toBeNull()
  })
})
