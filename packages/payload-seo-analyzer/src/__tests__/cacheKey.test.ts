/**
 * `keyFor`: the one place the SEO endpoints' cache keys come from. These tests are the policy:
 * which inputs must split two entries and which must not.
 */
import { describe, expect, it } from 'vitest'

import { CACHE_KEY_POLICY, type CacheKeyBase, type CacheKeyReq, keyFor } from '../cacheKey.js'
import { PERSISTENT_CACHE_BASES } from '../cache.js'
import type { SeoContentExtractors } from '../helpers/contentExtractor.js'

const persistent = { persistent: true }
const memory = { persistent: false }
const KEY_CHARS = /^[a-z0-9:._-]+$/

const localized = (extractContent?: SeoContentExtractors): CacheKeyReq['payload'] => ({
  config: {
    localization: { localeCodes: ['de', 'en', 'pt-BR'], defaultLocale: 'de', fallback: false },
    custom: { seoAnalyzer: { ...(extractContent && { extractContent }) } },
  },
})
const withExtractors = (extractContent?: SeoContentExtractors): CacheKeyReq => ({ payload: localized(extractContent) })

const BASES = Object.keys(CACHE_KEY_POLICY) as CacheKeyBase[]
const PERSISTED_BASES = BASES.filter((b) => (PERSISTENT_CACHE_BASES as readonly string[]).includes(b))

describe('keyFor: locale', () => {
  it('gives the same key to every locale for a base with no locale (the audit)', async () => {
    const key = (locale?: string) => keyFor('audit', { locale, payload: localized() }, { cache: persistent })
    expect(await key('de')).toBe(await key('en'))
    expect(await key('en')).toBe(await key())
  })

  it('gives each declared locale, and the cross-locale mode, its own key for a scoped base', async () => {
    const key = (locale?: string) => keyFor('indexation-audit', { locale, payload: localized() }, { cache: persistent })
    const keys = [await key(), await key('de'), await key('en'), await key('pt-BR'), await key('all')]
    expect(new Set(keys).size).toBe(keys.length)
    expect(await key('*')).toBe(await key('all'))
  })

  it('collapses a locale the host never declared onto the unscoped key', async () => {
    const key = (locale?: string) => keyFor('sitemap-audit', { locale, payload: localized() })
    for (const forged of ['a1', 'a2', 'a3', 'DE']) expect(await key(forged)).toBe(await key())
    // Whitespace is trimmed before the check.
    expect(await key('de ')).toBe(await key('de'))
  })

  it('collapses every locale when the site is not localized', async () => {
    const payload = { config: {} }
    expect(await keyFor('link-graph', { locale: 'zz', payload })).toBe(await keyFor('link-graph', { payload }))
  })

  it('keeps distinct locales distinct, and within the store characters, when no config is at hand', async () => {
    const locales = ['pt-BR', 'pt-br', 'pt_br', 'pt__br', 'a:b', 'a_.003ab', 'é', 'é'.normalize('NFD'), '../x', 'A', '_a']
    const keys = await Promise.all(locales.map((locale) => keyFor('external-links', { locale })))
    expect(new Set(keys).size).toBe(locales.length)
    for (const key of keys) expect(key).toMatch(KEY_CHARS)
  })

  it('never reads a locale as an input or config digest', async () => {
    const digest = (await keyFor('duplicate-content', {}, { inputs: 0.7 })).split(':i-')[1]
    const scoped = await keyFor('duplicate-content', { locale: digest }, { inputs: 0.7 })
    const unscoped = await keyFor('duplicate-content', {}, { inputs: 0.7 })
    expect(scoped).not.toBe(unscoped)
    expect(scoped).toBe(`duplicate-content:l-${digest}:i-${digest}`)
  })
})

describe('keyFor: inputs', () => {
  it('splits on different inputs and not on the same ones', async () => {
    const key = (inputs: unknown) => keyFor('sitemap-xml', {}, { inputs })
    expect(await key([['pages'], 'https://a.example'])).toBe(await key([['pages'], 'https://a.example']))
    expect(await key([['pages'], 'https://a.example'])).not.toBe(await key([['pages'], 'https://b.example']))
    expect(await key([['pages'], 'https://a.example'])).not.toBe(await key([['pages', 'posts'], 'https://a.example']))
  })

  it('ignores the order of object keys but not of array items', async () => {
    const key = (inputs: unknown) => keyFor('sitemap-xml', {}, { inputs })
    expect(await key({ a: 1, b: { c: 2, d: 3 } })).toBe(await key({ b: { d: 3, c: 2 }, a: 1 }))
    expect(await key(['pages', 'posts'])).not.toBe(await key(['posts', 'pages']))
  })

  it('hashes inputs, so a hostile origin or query string stays within the store characters', async () => {
    const key = await keyFor('sitemap-news', {}, { inputs: ['pages', 'https://Évil.example:8080/?a=B&c=d#Frag'] })
    expect(key).toMatch(KEY_CHARS)
    expect(key).toMatch(/^sitemap-news:i-[0-9a-f]{64}$/)
  })

  it('adds no segment without inputs', async () => {
    expect(await keyFor('audit', {})).toBe('audit')
    expect(await keyFor('link-graph', {})).toBe('link-graph')
  })
})

describe('keyFor: persisted config', () => {
  const config = { collections: ['pages'], globals: [], seoConfig: { siteUrl: 'https://a.example' } }

  it('adds the config segment only for a persisted base in a persistent cache', async () => {
    expect(await keyFor('audit', {}, { cache: persistent, config })).toMatch(/^audit:c-[0-9a-f]{64}$/)
    expect(await keyFor('audit', {}, { cache: memory, config })).toBe('audit')
    expect(await keyFor('audit', {}, { config })).toBe('audit')
    // Not in PERSISTENT_CACHE_BASES: always in memory, whatever the cache.
    expect(await keyFor('cannibalization', {}, { cache: persistent, config })).toBe('cannibalization')
  })

  it('changes with the config when persisted, and not otherwise', async () => {
    const key = (c: unknown, cache = persistent) => keyFor('audit', {}, { cache, config: c })
    const other = { ...config, collections: ['pages', 'posts'] }
    expect(await key(config)).toBe(await key(JSON.parse(JSON.stringify(config))))
    expect(await key(other)).not.toBe(await key(config))
    expect(await key(other, memory)).toBe(await key(config, memory))
  })

  it('ignores the order the config is written in', async () => {
    const key = (c: unknown) => keyFor('indexation-audit', {}, { cache: persistent, config: c })
    expect(await key({ collections: ['pages'], globals: [], seoConfig: { siteUrl: 'x', siteName: 'y' } })).toBe(
      await key({ seoConfig: { siteName: 'y', siteUrl: 'x' }, globals: [], collections: ['pages'] }),
    )
  })

  it('changes with the thresholds, and with the source of a function such as excludeDocs', async () => {
    const key = (seoConfig: unknown) => keyFor('audit', {}, { cache: persistent, config: { ...config, seoConfig } })
    expect(await key({ thresholds: { titleLengthMin: 10 } })).not.toBe(await key({ thresholds: { titleLengthMin: 20 } }))
    expect(await key({ thresholds: { titleLengthMin: 10 } })).not.toBe(await key(null))

    const excludeDocs = (doc: Record<string, unknown>) => doc._abVariantOf != null
    expect(await key({ excludeDocs })).not.toBe(await key({}))
    expect(await key({ excludeDocs })).not.toBe(await key({ excludeDocs: () => false }))
    expect(await key({ excludeDocs })).toBe(await key({ excludeDocs: (doc: Record<string, unknown>) => doc._abVariantOf != null }))
  })

  it('gives every persisted base its own entry for the same inputs and config', async () => {
    const keys = await Promise.all(
      PERSISTED_BASES.map((base) => keyFor(base, {}, { cache: persistent, inputs: 'x', config })),
    )
    expect(new Set(keys).size).toBe(PERSISTED_BASES.length)
    for (const key of keys) expect(key).toMatch(KEY_CHARS)
  })
})

describe('keyFor: extractors', () => {
  const docs: SeoContentExtractors = { docs: ({ doc: d }) => ({ text: [String(d.body)] }) }
  const key = (extractContent?: SeoContentExtractors, base: CacheKeyBase = 'audit', cache = persistent) =>
    keyFor(base, withExtractors(extractContent), { cache, config: { collections: ['pages', 'docs'] } })

  it('changes when an extractor is added, changed or removed', async () => {
    const none = await key()
    expect(await key(docs)).not.toBe(none)
    expect(await key({ docs: ({ doc: d }) => ({ text: [String(d.summary)] }) })).not.toBe(await key(docs))
    expect(await key({ ...docs, pages: () => ({}) })).not.toBe(await key(docs))
    // No extractors, an empty map and a map of non-functions are the same app.
    expect(await key({})).toBe(none)
  })

  it('is stable for the same extractors, whatever order the map is written in', async () => {
    const a = { docs: ({ doc: d }) => ({ text: [String(d.body)] }), pages: () => ({}) } satisfies SeoContentExtractors
    const b = { pages: () => ({}), docs: ({ doc: d }) => ({ text: [String(d.body)] }) } satisfies SeoContentExtractors
    expect(await key(a)).toBe(await key(b))
    expect(await key(docs)).toBe(await key({ docs: ({ doc: d }) => ({ text: [String(d.body)] }) }))
  })

  it('applies to the bases that read documents, not to the others, nor to an in-memory cache', async () => {
    for (const base of BASES.filter((b) => CACHE_KEY_POLICY[b].extractors && PERSISTED_BASES.includes(b))) {
      expect(await key(docs, base)).not.toBe(await key(undefined, base))
    }
    for (const base of ['redirect-chains', 'core-web-vitals'] as const) {
      expect(await key(docs, base)).toBe(await key(undefined, base))
    }
    expect(await key(docs, 'audit', memory)).toBe(await key(undefined, 'audit', memory))
  })

  it('reads the extractors from the Payload config, not from the request or a bare mock', async () => {
    // A mock payload without a `config` whose methods are functions is not an extractor map.
    const mock = { payload: { find: () => ({}), update: () => ({}) } }
    expect(await keyFor('audit', mock, { cache: persistent })).toBe(await keyFor('audit', {}, { cache: persistent }))
  })
})

describe('keyFor: policy table', () => {
  it('keeps every base within the store characters', async () => {
    for (const base of BASES) {
      expect(await keyFor(base, { locale: 'pt-BR' }, { cache: persistent, inputs: ['a', 'B'], config: { x: 1 } })).toMatch(
        KEY_CHARS,
      )
    }
  })
})
