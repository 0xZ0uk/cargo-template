// @vitest-environment jsdom
/**
 * The sidebar scores exactly what `/validate` scores (cargo-template #130): the same input
 * mapping (author, dates, canonical, hreflang, every focus keyword…) and the same effective
 * config (the plugin's `disabledRules`, `overrideWeights`, `localSeoSlugs` and thresholds,
 * with the saved `disabledRules`, `siteName` and thresholds on top).
 *
 * Both endpoints run for real against a stand-in Payload. The sidebar path is the real hook:
 * the edit form's state is posted to `/sidebar-content`, and the sidebar scores
 * `analyzeSeo(input, config)` from what the hook returns. Population itself (IDs → documents)
 * is covered against a real Payload in `apps/web/tests/int/localD1/seoSidebarParity.ts`; here
 * the form already holds the document `/validate` reads.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import type { PayloadHandler } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { analyzeSeo } from '../analyzer.js'
import { createSidebarContentHandler } from '../endpoints/sidebarContent.js'
import { createValidateHandler } from '../endpoints/validate.js'
import { SIDEBAR_CONTENT_DEBOUNCE_MS, useSidebarContent } from '../hooks/useSidebarContent.js'
import { buildSeoConfig } from '../plugin.js'
import type { SeoCheck } from '../types.js'
import { toFormState } from './helpers/formState.js'

const paragraph = (text: string) => ({ type: 'paragraph', children: [{ type: 'text', text }] })
const heading = (tag: string, text: string) => ({ type: 'heading', tag, children: [{ type: 'text', text }] })
const richText = (...children: unknown[]) => ({ root: { type: 'root', children } })

/** A saved page, populated like a `depth: 1` read. */
const page = {
  id: 12,
  title: 'Plumber in Lisbon',
  slug: 'plumber-lisbon',
  focusKeyword: 'plumber lisbon',
  // More than ten: the sidebar used to stop at ten.
  focusKeywords: Array.from({ length: 12 }, (_, i) => ({ id: `k${i}`, keyword: `emergency plumber ${i}` })),
  isCornerstone: true,
  meta: {
    title: 'Plumber in Lisbon: fast repairs, fair prices | Cargo',
    description: 'A plumber in Lisbon for leaks, boilers and blocked drains. Same-day visits across the city, fixed quotes.',
    canonicalUrl: 'https://other.example.com/plumber-lisbon',
  },
  populatedAuthors: [{ name: 'Ana Sousa', url: 'https://example.com/team/ana' }],
  publishedAt: '2026-01-10T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  contentLastReviewed: '2026-09-01T09:00:00.000Z',
  localeAlternates: [
    { hreflang: 'en', href: 'https://example.com/plumber-lisbon' },
    { hreflang: 'pt', href: 'https://example.com/pt/canalizador-lisboa' },
  ],
  layout: [
    {
      blockType: 'richText',
      richText: richText(
        heading('h1', 'Plumber in Lisbon'),
        paragraph('Our plumber in Lisbon fixes leaks, boilers and blocked drains the same day.'),
        heading('h2', 'Emergency plumber 3'),
        paragraph('Call us any time: we answer around the clock and quote before we start.'),
      ),
    },
  ],
}

/** The plugin options an app sets, and the settings saved in `/admin/seo-config`. */
const seoConfig = buildSeoConfig({
  disabledRules: ['social'],
  overrideWeights: { title: 25, content: 1 },
  localSeoSlugs: ['plumber-lisbon'],
  siteUrl: 'https://example.com',
  thresholds: { titleLengthMax: 70 },
})
const savedSettings = {
  disabledRules: ['freshness'],
  siteName: 'Cargo',
  thresholds: { metaDescLengthMax: 120, titleLengthMax: null },
}

const payload = {
  config: { maxDepth: 10, globals: [], custom: {}, admin: {} },
  collections: { pages: { config: { slug: 'pages', fields: [] } } },
  findByID: vi.fn(async () => structuredClone(page)),
  find: vi.fn(async ({ collection }: { collection: string }) => ({
    docs: collection === 'seo-settings' ? [savedSettings] : [],
  })),
  logger: { error: vi.fn() },
}

const call = async (handler: PayloadHandler, url: string, body: unknown) => {
  const res = await handler({
    payload,
    user: { id: 1 },
    method: 'POST',
    url,
    context: {},
    locale: 'en',
    payloadDataLoader: { load: vi.fn() },
    json: async () => structuredClone(body),
  } as never)
  return res.json()
}

const validate = createValidateHandler(['pages'], [], seoConfig)
const sidebarContent = createSidebarContentHandler(['pages'], [], seoConfig)
const ENDPOINT = 'http://localhost/api/seo-plugin/sidebar-content'

const shape = (checks: SeoCheck[]) => checks.map(({ id, status, weight }) => ({ id, status, weight }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('sidebar ↔ /validate parity', () => {
  it('gives the same score and checks for the same document, with rules, weights, local-SEO slugs and saved settings set', async () => {
    const fromValidate = (await call(validate, 'http://localhost/api/seo-plugin/validate', {
      id: page.id,
      collection: 'pages',
    })) as { score: number; checks: SeoCheck[] }

    vi.useFakeTimers()
    globalThis.fetch = vi.fn(async (url: string, init?: { body?: string }) => {
      const body = await call(sidebarContent, url, JSON.parse(init?.body ?? '{}'))
      return { ok: true, json: async () => JSON.parse(JSON.stringify(body)) }
    }) as never
    const formState = toFormState(page)
    const { result } = renderHook(() => useSidebarContent(formState, { collection: 'pages' }, ENDPOINT, 'en'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIDEBAR_CONTENT_DEBOUNCE_MS + 10)
    })
    expect(result.current.resolved).toBe(true)
    const { input, config } = result.current
    const fromSidebar = analyzeSeo(input, config!)

    expect(fromSidebar.score).toBe(fromValidate.score)
    expect(shape(fromSidebar.checks)).toEqual(shape(fromValidate.checks))

    // Every input field /validate maps reached the sidebar.
    expect(input).toMatchObject({
      author: 'Ana Sousa',
      authorUrl: 'https://example.com/team/ana',
      publishedAt: page.publishedAt,
      displayedDate: page.publishedAt,
      canonicalUrl: page.meta.canonicalUrl,
      localeAlternates: page.localeAlternates,
      isGlobal: false,
    })
    expect(input.focusKeywords).toHaveLength(12)
    // The effective config: the plugin's options with the saved settings merged in.
    expect(config).toMatchObject({
      disabledRules: ['social', 'freshness'],
      overrideWeights: { title: 25, content: 1 },
      localSeoSlugs: ['plumber-lisbon'],
      siteName: 'Cargo',
      thresholds: { titleLengthMax: 70, metaDescLengthMax: 120 },
    })
    expect(fromSidebar.checks.some((c) => c.group === 'social' || c.group === 'freshness')).toBe(false)

    // Not vacuous: scoring with the thresholds alone, as the sidebar used to, differs, and so
    // does leaving out any one of the options.
    expect(analyzeSeo(input, { thresholds: config!.thresholds }).score).not.toBe(fromValidate.score)
    for (const key of ['disabledRules', 'overrideWeights', 'localSeoSlugs'] as const) {
      const without = analyzeSeo(input, { ...config, [key]: undefined })
      expect(JSON.stringify(shape(without.checks)), key).not.toBe(JSON.stringify(shape(fromSidebar.checks)))
    }
  })
})
