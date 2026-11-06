// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'

// The sidebar reads the form's own values: the preview must show them, not the placeholders.
vi.mock('@payloadcms/ui', async () => {
  const { payloadUiStub } = await import('./helpers/payloadUiStub.js')
  return {
    ...payloadUiStub,
    useConfig: () => ({
      config: { routes: { api: '/api', admin: '/admin' }, admin: { custom: {} } },
    }),
    useDocumentInfo: () => ({ id: 7, collectionSlug: 'pages' }),
    useAllFormFields: () => [
      {
        title: { value: 'Coffee brewing basics' },
        slug: { value: 'coffee-brewing' },
        focusKeyword: { value: 'cafe' },
        'meta.title': { value: 'Brewing café at home' },
        'meta.description': { value: 'A short guide to brewing great coffee at home.' },
      },
      vi.fn(),
    ],
    useLocale: () => ({}),
    useTranslation: () => ({ i18n: { language: 'en' } }),
  }
})

import SeoAnalyzer from '../components/SeoAnalyzer.js'

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('sidebar Google preview', () => {
  it("shows the form's meta title, description and path, with the focus keyword bolded", () => {
    const { container } = render(<SeoAnalyzer />)
    fireEvent.click(screen.getByRole('button', { name: /google preview/i })) // starts collapsed
    const serp = container.querySelector('.seo-serp-preview') as HTMLElement
    expect(serp).not.toBeNull()

    expect(serp.querySelector('.seo-serp__title')?.textContent).toBe('Brewing café at home')
    expect(serp.querySelector('.seo-serp__title strong')?.textContent).toBe('café')
    expect(serp.querySelector('.seo-serp__description')?.textContent).toBe(
      'A short guide to brewing great coffee at home.',
    )
    expect(serp.querySelector('.seo-serp__url')?.textContent).toContain('coffee brewing')
    expect(serp.textContent).not.toMatch(/no meta (title|description)/i)
  })
})
