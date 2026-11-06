// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

// The length counters (field, SERP preview, social preview) must use the same limits as the
// rules: a 180-character description passes the check when the max is 200, so its counter
// cannot read `180 / 160` in the warning tone.
let pluginThresholds: Record<string, number> | undefined
let fieldValue = ''
vi.mock('@payloadcms/ui', async () => ({
  ...(await import('./helpers/payloadUiStub.js')).payloadUiStub,
  useField: () => ({ value: fieldValue, setValue: () => {} }),
  useDocumentInfo: () => ({ collectionSlug: 'pages', id: '1' }),
  useTranslation: () => ({ i18n: { language: 'en' } }),
  useConfig: () => ({
    config: {
      routes: { api: '/api', admin: '/admin' },
      admin: { custom: { seoAnalyzer: { endpointBasePath: '/seo-plugin', thresholds: pluginThresholds } } },
    },
  }),
}))

import { MetaDescriptionField } from '../components/MetaDescriptionField.js'
import { MetaTitleField } from '../components/MetaTitleField.js'
import { SeoSocialPreview } from '../components/SeoSocialPreview.js'
import { SerpPreview } from '../components/SerpPreview.js'
import { invalidateSeoThresholds } from '../hooks/useSeoThresholds.js'
import { resolveThresholds } from '../helpers/thresholds.js'
import { getDashboardT } from '../dashboard-i18n.js'

let saved: Record<string, unknown> | undefined
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  pluginThresholds = undefined
  saved = undefined
  fieldValue = ''
  invalidateSeoThresholds()
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).endsWith('/settings') ? { settings: { thresholds: saved } } : {}),
  }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Both previews start collapsed: open them.
const expand = () => screen.getAllByRole('button', { expanded: false }).forEach((b) => fireEvent.click(b))

const settingsCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/settings')).length

describe('meta description counter', () => {
  it('keeps 120-160 without custom values', async () => {
    fieldValue = 'a'.repeat(180)
    const { container } = render(<MetaDescriptionField path="meta.description" field={{} as never} />)
    expect(await screen.findByText(/180 \/ 160/)).toBeTruthy()
    expect(container.querySelector('.seo-meta-field__count--danger')).toBeTruthy()
  })

  it('shows 180 / 200 in the ok tone when the saved max is 200', async () => {
    saved = { metaDescLengthMax: 200 }
    fieldValue = 'a'.repeat(180)
    const { container } = render(<MetaDescriptionField path="meta.description" field={{} as never} />)
    expect(await screen.findByText(/180 \/ 200/)).toBeTruthy()
    expect(container.querySelector('.seo-meta-field__count--success')).toBeTruthy()
    expect(container.querySelector('.seo-meta-field__count--danger')).toBeNull()
    expect(screen.getByText(/Optimal.*120-200/i)).toBeTruthy()
  })

  it('uses the plugin option before the settings arrive', async () => {
    pluginThresholds = { metaDescLengthMax: 220 }
    fieldValue = 'a'.repeat(180)
    render(<MetaDescriptionField path="meta.description" field={{} as never} />)
    expect(await screen.findByText(/180 \/ 220/)).toBeTruthy()
  })
})

describe('meta title counter', () => {
  it('follows the saved title range', async () => {
    saved = { titleLengthMin: 40, titleLengthMax: 70 }
    fieldValue = 'a'.repeat(65)
    const { container } = render(<MetaTitleField path="meta.title" field={{} as never} />)
    expect(await screen.findByText(/65 \/ 70/)).toBeTruthy()
    expect(container.querySelector('.seo-meta-field__count--success')).toBeTruthy()
  })
})

describe('SERP and social preview counters', () => {
  it('SerpPreview counters follow the saved limits, truncation stays on the display limits', async () => {
    saved = { titleLengthMax: 70, metaDescLengthMax: 200 }
    render(<SerpPreview metaTitle={'t'.repeat(65)} metaDescription={'d'.repeat(180)} slug="x" />)
    expand()
    expect(await screen.findByText(/65 \/ 70/)).toBeTruthy()
    expect(screen.getByText(/180 \/ 200/).className).toContain('seo-text--success')
  })

  it('SeoSocialPreview counters follow the saved limits', async () => {
    saved = { metaDescLengthMax: 200 }
    render(<SeoSocialPreview metaTitle="a title" metaDescription={'d'.repeat(180)} />)
    expand()
    await waitFor(() => expect(screen.getAllByText(/180 \/ 200/).length).toBeGreaterThan(0))
  })

  it('both keep 60 / 160 without custom values', async () => {
    render(<SerpPreview metaTitle={'t'.repeat(40)} metaDescription={'d'.repeat(180)} slug="x" />)
    render(<SeoSocialPreview metaTitle="a title" metaDescription={'d'.repeat(180)} />)
    expand()
    expect((await screen.findAllByText(/180 \/ 160/)).length).toBe(2)
    expect(screen.getByText(/40 \/ 60/)).toBeTruthy()
  })
})

describe('shared settings request', () => {
  it('fetches /settings once for several consumers', async () => {
    saved = { metaDescLengthMax: 200 }
    fieldValue = 'a'.repeat(180)
    render(
      <>
        <MetaDescriptionField path="meta.description" field={{} as never} />
        <MetaTitleField path="meta.title" field={{} as never} />
        <SerpPreview metaTitle="t" metaDescription={'d'.repeat(180)} slug="x" />
        <SeoSocialPreview metaTitle="t" metaDescription={'d'.repeat(180)} />
      </>,
    )
    expand()
    await waitFor(() => expect(screen.getAllByText(/180 \/ 200/).length).toBeGreaterThanOrEqual(3))
    expect(settingsCalls()).toBe(1)
  })

  it('does not keep a failed request', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new Error('offline')
    })
    const first = render(<MetaDescriptionField path="meta.description" field={{} as never} />)
    await waitFor(() => expect(settingsCalls()).toBe(1))
    first.unmount()
    // Let the rejected request settle (and drop its cache entry).
    await new Promise((r) => setTimeout(r, 0))
    saved = { metaDescLengthMax: 200 }
    fieldValue = 'a'.repeat(180)
    render(<MetaDescriptionField path="meta.description" field={{} as never} />)
    expect(await screen.findByText(/180 \/ 200/)).toBeTruthy()
    expect(settingsCalls()).toBe(2)
  })

  it('invalidateSeoThresholds forces the next consumer to refetch', async () => {
    const first = render(<MetaDescriptionField path="meta.description" field={{} as never} />)
    await waitFor(() => expect(settingsCalls()).toBe(1))
    first.unmount()
    invalidateSeoThresholds()
    render(<MetaDescriptionField path="meta.description" field={{} as never} />)
    await waitFor(() => expect(settingsCalls()).toBe(2))
  })
})

describe('dashboard text', () => {
  it('the meta-description suggestion quotes the limits', () => {
    const { min, max } = { min: 150, max: 200 }
    const r = resolveThresholds({ metaDescLengthMin: min, metaDescLengthMax: max })
    expect(getDashboardT().seoAnalyzer.writeMetaDesc(r.metaDescLengthMin, r.metaDescLengthMax)).toBe(
      'Write a meta description of 150-200 characters',
    )
    const d = resolveThresholds()
    expect(getDashboardT().seoAnalyzer.writeMetaDesc(d.metaDescLengthMin, d.metaDescLengthMax)).toBe(
      'Write a meta description of 120-160 characters',
    )
  })
})

describe('sidebar tips quote the resolved limits', () => {
  it('title and word-count tips follow custom values, and keep the defaults otherwise', () => {
    const t = getDashboardT()
    const d = resolveThresholds()
    expect(t.seoAnalyzer.titleCharactersIdeal(d.titleLengthMin, d.titleLengthMax)).toBe('characters, ideal: 30-60')
    expect(t.seoAnalyzer.enrichContent(d.minWordsGeneric)).toContain('minimum 300 words')
    const c = resolveThresholds({ titleLengthMin: 40, titleLengthMax: 70, minWordsGeneric: 500 })
    expect(t.seoAnalyzer.titleCharactersIdeal(c.titleLengthMin, c.titleLengthMax)).toBe('characters, ideal: 40-70')
    expect(t.seoAnalyzer.enrichContent(c.minWordsGeneric)).toContain('minimum 500 words')
  })
})
