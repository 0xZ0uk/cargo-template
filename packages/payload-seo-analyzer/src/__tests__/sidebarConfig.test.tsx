// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

import type { SeoConfig } from '../types.js'

// The config the sidebar scores with: the plugin's (forwarded in `admin.custom`) with the saved
// settings on top until `/sidebar-content` answers, then the server's effective config.
let pluginConfig: SeoConfig | undefined
const formFields = {
  'meta.title': { value: 'a'.repeat(40) },
  slug: { value: 'coffee-brewing' },
}
vi.mock('@payloadcms/ui', async () => {
  const { payloadUiStub } = await import('./helpers/payloadUiStub.js')
  return {
    ...payloadUiStub,
    useConfig: () => ({
      config: {
        routes: { api: '/api', admin: '/admin' },
        admin: { custom: { seoAnalyzer: { endpointBasePath: '/seo-plugin', config: pluginConfig } } },
      },
    }),
    useDocumentInfo: () => ({ id: 7, collectionSlug: 'pages' }),
    useAllFormFields: () => [formFields, vi.fn()],
    useLocale: () => ({}),
    useTranslation: () => ({ i18n: { language: 'en' } }),
  }
})

import SeoAnalyzer from '../components/SeoAnalyzer.js'
import { invalidateSeoConfig } from '../hooks/useSeoConfig.js'
import { seoInputFromDoc } from '../helpers/seoInputFromDoc.js'
import { formStateToDoc } from '../helpers/sidebarContent.js'

let saved: Record<string, unknown> | undefined
let served: SeoConfig | undefined
beforeEach(() => {
  invalidateSeoConfig() // the /settings response is shared across mounts
  pluginConfig = undefined
  saved = undefined
  served = undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = vi.fn(async (url: string) => {
    const path = String(url).split('?')[0]
    const body = path.endsWith('/settings')
      ? { settings: saved }
      : path.endsWith('/sidebar-content') && served
        ? { input: seoInputFromDoc(formStateToDoc(formFields), { collection: 'pages' }), config: served }
        : {}
    return { ok: true, status: 200, json: async () => body }
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('sidebar config', () => {
  it('scores with the defaults when nothing is set', async () => {
    render(<SeoAnalyzer />)
    await screen.findByText(/Meta title \(40 chars\)/)
    expect(screen.getByText(/Meta title \(40 chars\) — Ideal length/)).toBeTruthy()
  })

  it("uses the plugin's thresholds before anything answers", async () => {
    pluginConfig = { thresholds: { titleLengthMin: 50 } }
    render(<SeoAnalyzer />)
    expect(await screen.findByText(/Too short\. Aim for 50 to 60 characters/)).toBeTruthy()
  })

  it("leaves out the plugin's disabled rules", async () => {
    pluginConfig = { disabledRules: ['title'] }
    render(<SeoAnalyzer />)
    await screen.findByText('SEO Score')
    expect(screen.queryByText(/Meta title \(40 chars\)/)).toBeNull()
  })

  it('layers the saved settings over the plugin config', async () => {
    pluginConfig = { thresholds: { titleLengthMin: 50 } }
    saved = { thresholds: { titleLengthMin: 45, titleLengthMax: 55 } }
    render(<SeoAnalyzer />)
    await waitFor(() => expect(screen.getByText(/Aim for 45 to 55 characters/)).toBeTruthy())
  })

  it("switches to the server's effective config once /sidebar-content answers", async () => {
    pluginConfig = { thresholds: { titleLengthMin: 50 } }
    served = { thresholds: { titleLengthMin: 42, titleLengthMax: 48 } }
    render(<SeoAnalyzer />)
    await waitFor(() => expect(screen.getByText(/Aim for 42 to 48 characters/)).toBeTruthy())
  })
})
