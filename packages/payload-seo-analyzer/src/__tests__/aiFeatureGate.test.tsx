// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

// The `/ai-*` endpoints are only registered with `features.aiFeatures`. With the feature off,
// the sidebar's "Generate meta" / "Optimize with AI" buttons answered 404
// ('Route not found "/api/seo-plugin/ai-generate"').
let features: Record<string, boolean> | undefined
let docInfo: { id?: string | number; collectionSlug?: string } = {}
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
    // Like Payload 4: no `id` in the form state, the edit view knows it.
    useDocumentInfo: () => docInfo,
    useAllFormFields: () => [
      {
        title: { value: 'Coffee brewing basics' },
        slug: { value: 'coffee-brewing' },
      },
      vi.fn(),
    ],
    useLocale: () => ({}),
    useTranslation: () => ({ i18n: { language: 'en' } }),
  }
})

import SeoAnalyzer from '../components/SeoAnalyzer.js'

beforeEach(() => {
  features = undefined
  docInfo = { id: 7, collectionSlug: 'pages' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const aiButtons = () => [
  screen.queryByRole('button', { name: /generate meta/i }),
  screen.queryByRole('button', { name: /optimize with ai/i }),
]

describe('sidebar AI buttons follow features.aiFeatures', () => {
  it('hides them when the feature is off', () => {
    features = { aiFeatures: false }
    render(<SeoAnalyzer />)
    expect(aiButtons()).toEqual([null, null])
  })

  it('shows them when the feature is on, or when the flags are unknown', () => {
    features = { aiFeatures: true }
    render(<SeoAnalyzer />)
    expect(aiButtons().every(Boolean)).toBe(true)
    cleanup()

    features = undefined
    render(<SeoAnalyzer />)
    expect(aiButtons().every(Boolean)).toBe(true)
  })
})

describe('"Optimize with AI" on a saved document', () => {
  it('takes the id from the edit view (not the form state) and posts it', async () => {
    features = { aiFeatures: true }
    render(<SeoAnalyzer />)
    const button = screen.getByRole('button', { name: /optimize with ai/i }) as HTMLButtonElement
    expect(button.disabled).toBe(false)

    fireEvent.click(button)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchMock = (globalThis as any).fetch as ReturnType<typeof vi.fn>
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/ai-optimize'))).toBe(true),
    )
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/ai-optimize'))!
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ collection: 'pages', id: '7' })
  })

  it('stays disabled, saying why, on a document that was never saved', () => {
    features = { aiFeatures: true }
    docInfo = {}
    render(<SeoAnalyzer />)
    const button = screen.getByRole('button', { name: /optimize with ai/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})
