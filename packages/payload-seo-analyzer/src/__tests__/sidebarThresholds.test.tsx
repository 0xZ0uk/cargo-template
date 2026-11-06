// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

// The sidebar used to call analyzeSeo without any config, so neither the plugin's
// `thresholds` option nor the thresholds saved in /admin/seo-config reached it.
let pluginThresholds: Record<string, number> | undefined
vi.mock('@payloadcms/ui', async () => {
  const { payloadUiStub } = await import('./helpers/payloadUiStub.js')
  return {
    ...payloadUiStub,
    useConfig: () => ({
      config: {
        routes: { api: '/api', admin: '/admin' },
        admin: { custom: { seoAnalyzer: { endpointBasePath: '/seo-plugin', thresholds: pluginThresholds } } },
      },
    }),
    useDocumentInfo: () => ({ id: 7, collectionSlug: 'pages' }),
    useAllFormFields: () => [
      {
        'meta.title': { value: 'a'.repeat(40) },
        slug: { value: 'coffee-brewing' },
      },
      vi.fn(),
    ],
    useLocale: () => ({}),
    useTranslation: () => ({ i18n: { language: 'en' } }),
  }
})

import SeoAnalyzer from '../components/SeoAnalyzer.js'

let saved: Record<string, unknown> | undefined
beforeEach(() => {
  pluginThresholds = undefined
  saved = undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).endsWith('/settings') ? { settings: { thresholds: saved } } : {}),
  }))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('sidebar thresholds', () => {
  it('scores with the defaults when none are set', async () => {
    render(<SeoAnalyzer />)
    await screen.findByText(/Meta title \(40 chars\)/)
    expect(screen.getByText(/Meta title \(40 chars\) — Ideal length/)).toBeTruthy()
  })

  it('uses the plugin option', async () => {
    pluginThresholds = { titleLengthMin: 50 }
    render(<SeoAnalyzer />)
    expect(await screen.findByText(/Too short\. Aim for 50 to 60 characters/)).toBeTruthy()
  })

  it('layers the saved settings over the plugin option', async () => {
    pluginThresholds = { titleLengthMin: 50 }
    saved = { titleLengthMin: 45, titleLengthMax: 55 }
    render(<SeoAnalyzer />)
    await waitFor(() => expect(screen.getByText(/Aim for 45 to 55 characters/)).toBeTruthy())
  })
})
