import { describe, it, expect } from 'vitest'
import { seoAnalyzerPlugin } from '../plugin.js'

// Minimal Payload config the plugin transforms. Cast loosely — we only assert what the plugin
// adds (endpoints, collections, fields, hooks), not full Payload typing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function baseConfig(): any {
  return {
    collections: [
      { slug: 'pages', fields: [] },
      { slug: 'posts', fields: [] },
      { slug: 'media', fields: [], upload: true },
      { slug: 'users', fields: [], auth: true },
    ],
    globals: [],
    endpoints: [],
    admin: {},
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const paths = (out: any): string[] => (out.endpoints || []).map((e: any) => e.path)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const slugs = (out: any): string[] => (out.collections || []).map((c: any) => c.slug)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function run(pluginConfig: any) {
  return seoAnalyzerPlugin(pluginConfig)(baseConfig())
}

describe('seoAnalyzerPlugin — integration (config transform)', () => {
  it('registers the always-on endpoints', () => {
    const out = run({ collections: ['pages', 'posts'] })
    const p = paths(out)
    for (const expected of [
      '/seo-plugin/validate',
      '/seo-plugin/audit',
      '/seo-plugin/health',
      '/seo-plugin/sitemap.xml',
      '/seo-plugin/robots.txt',
    ]) {
      expect(p).toContain(expected)
    }
  })

  it('adds the SEO tab + meta fields to target collections only', () => {
    const out = run({ collections: ['pages', 'posts'] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pages = out.collections.find((c: any) => c.slug === 'pages')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const users = out.collections.find((c: any) => c.slug === 'users')
    expect(pages.fields.length).toBeGreaterThan(0)
    // SEO fields were injected (focusKeyword is part of seoFields) — wrapping in a tabs field
    // is an implementation detail that depends on the collection's existing fields.
    expect(JSON.stringify(pages.fields)).toContain('focusKeyword')
    // The "Hide from search engines" checkbox, read as `doc.noindex` by every consumer.
    expect(JSON.stringify(pages.fields)).toMatch(/"name":"noindex","type":"checkbox","defaultValue":false/)
    // Non-target collection untouched
    expect(users.fields.length).toBe(0)
  })

  it('registers default-on feature collections (history, redirects, settings)', () => {
    const out = run({ collections: ['pages', 'posts'] })
    const s = slugs(out)
    expect(s).toContain('seo-score-history')
    expect(s).toContain('seo-redirects')
    expect(s).toContain('seo-settings')
    // gscApi off by default → no GSC collections
    expect(s).not.toContain('seo-gsc-auth')
    expect(s).not.toContain('seo-rank-history')
  })

  it('registers AI endpoints when aiFeatures is on (default)', () => {
    const p = paths(run({ collections: ['pages', 'posts'] }))
    expect(p).toContain('/seo-plugin/ai-optimize')
    expect(p).toContain('/seo-plugin/ai-optimize-bulk')
    expect(p).toContain('/seo-plugin/ai-content-brief')
    expect(p).toContain('/seo-plugin/ai-alt-text')
  })

  it('gates AI endpoints off when aiFeatures is false', () => {
    const p = paths(run({ collections: ['pages', 'posts'], features: { aiFeatures: false } }))
    expect(p).not.toContain('/seo-plugin/ai-optimize')
    expect(p).not.toContain('/seo-plugin/ai-optimize-bulk')
  })

  it('enables GSC suite (collections + endpoints) when gscApi is on', () => {
    const out = run({ collections: ['pages', 'posts'], features: { gscApi: true } })
    expect(slugs(out)).toContain('seo-gsc-auth')
    expect(slugs(out)).toContain('seo-rank-history')
    const p = paths(out)
    expect(p).toContain('/seo-plugin/rank-history')
    expect(p).toContain('/seo-plugin/ctr-opportunities')
    expect(p).toContain('/seo-plugin/gsc/status')
  })

  it('enables alerts + indexNow endpoints + hook when opted in', () => {
    const out = run({ collections: ['pages', 'posts'], features: { alerts: true, indexNow: true } })
    const p = paths(out)
    expect(p).toContain('/seo-plugin/alerts-digest')
    expect(p).toContain('/seo-plugin/indexnow-key.txt')
    // IndexNow adds an afterChange hook to target collections
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pages = out.collections.find((c: any) => c.slug === 'pages')
    const after = pages.hooks?.afterChange || []
    expect(Array.isArray(after) ? after.length : 0).toBeGreaterThan(0)
  })

  it('wires a beforeChange redirect hook on target collections by default', () => {
    const out = run({ collections: ['pages', 'posts'] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pages = out.collections.find((c: any) => c.slug === 'pages')
    const before = pages.hooks?.beforeChange || []
    expect(Array.isArray(before) ? before.length : 0).toBeGreaterThan(0)
  })

  it('respects a custom endpointBasePath', () => {
    const p = paths(run({ collections: ['pages', 'posts'], endpointBasePath: '/seo' }))
    expect(p).toContain('/seo/validate')
    expect(p).toContain('/seo/health')
  })

  it('forwards the analyzed collections that exist to admin.custom (schema builder picker)', () => {
    const out = run({ collections: ['pages', 'posts', 'missing'] })
    expect(out.admin.custom.seoAnalyzer.collections).toEqual(['pages', 'posts'])
  })

  it('sets an onInit function (composes with existing)', () => {
    const out = run({ collections: ['pages', 'posts'] })
    expect(typeof out.onInit).toBe('function')
  })

  it('keeps existing admin.custom keys when forwarding the feature flags', () => {
    const base = baseConfig()
    base.admin.custom = { host: true, seoAnalyzer: { other: 1 } }
    const out = seoAnalyzerPlugin({ collections: ['pages'] })(base)
    expect(out.admin.custom).toMatchObject({ host: true, seoAnalyzer: { other: 1 } })
  })

  // The panels skip the endpoints of a disabled feature instead of logging a 404.
  it('forwards the resolved feature flags to the client config', () => {
    const out = run({ collections: ['pages'], features: { gscApi: false, alerts: true } })
    expect(out.admin.custom.seoAnalyzer.features).toMatchObject({ gscApi: false, alerts: true, dashboard: true })
  })
})

// Every time-series feature off, so retention has nothing to do unless asked.
const NO_TIME_SERIES = { scoreHistory: false, performance: false, seoLogs: false, gscApi: false }

describe('seoAnalyzerPlugin — retention purge (mandatory for time-series features)', () => {
  it('registers no retention route when no time-series feature is on and nothing is named', () => {
    // The route does not exist rather than existing and refusing.
    expect(paths(run({ collections: ['pages'], features: NO_TIME_SERIES }))).not.toContain('/seo-plugin/retention')
  })

  it('registers the routes as soon as a time-series feature is on, without any option', () => {
    for (const feature of ['scoreHistory', 'performance', 'seoLogs', 'gscApi']) {
      const out = run({ collections: ['pages'], features: { ...NO_TIME_SERIES, [feature]: true } })
      expect(paths(out)).toContain('/seo-plugin/retention')
    }
  })

  it('registers a GET (dry run) and a POST (run now) once a window is set', () => {
    const out = run({ collections: ['pages'], features: NO_TIME_SERIES, retentionDays: { 'seo-logs': 90 } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const routes = (out.endpoints || []).filter((e: any) => e.path === '/seo-plugin/retention')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(routes.map((e: any) => e.method).sort()).toEqual(['get', 'post'])
  })

  it('registers nothing for a window that would mean "delete everything"', () => {
    // 0 and negatives are dropped by resolveRetention, so the config resolves to
    // no target — and the endpoints must follow.
    for (const days of [0, -1, Number.NaN]) {
      const out = run({ collections: ['pages'], features: NO_TIME_SERIES, retentionDays: { 'seo-logs': days } })
      expect(paths(out)).not.toContain('/seo-plugin/retention')
    }
  })

  it('leaves the rest of the config untouched when retention is on', () => {
    const withRetention = run({ collections: ['pages'], features: NO_TIME_SERIES, retentionDays: { 'seo-logs': 30 } })
    const without = run({ collections: ['pages'], features: NO_TIME_SERIES })
    expect(slugs(withRetention)).toEqual(slugs(without))
    expect(paths(withRetention).filter((p) => p !== '/seo-plugin/retention')).toEqual(paths(without))
  })
})

describe('seoAnalyzerPlugin — dataStore option', () => {
  const ALL_ON = { scoreHistory: true, performance: true, seoLogs: true, gscApi: true }
  const TIME_SERIES = ['seo-score-history', 'seo-performance', 'seo-logs', 'seo-rank-history']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fakeStore: any = { kind: 'fake' }

  it('without a store, registers the upstream time-series collections', () => {
    const s = slugs(run({ collections: ['pages'], features: ALL_ON }))
    for (const slug of TIME_SERIES) expect(s).toContain(slug)
  })

  it('with a store, registers none of them, but keeps seo-gsc-auth and every endpoint', () => {
    const withStore = run({ collections: ['pages'], features: ALL_ON, dataStore: fakeStore })
    const without = run({ collections: ['pages'], features: ALL_ON })
    const s = slugs(withStore)
    for (const slug of TIME_SERIES) expect(s).not.toContain(slug)
    expect(s).toContain('seo-gsc-auth')
    expect(paths(withStore)).toEqual(paths(without))
  })

  it('leaves the store and the enabled datasets in server-only custom config', () => {
    const out = run({ collections: ['pages'], features: { ...NO_TIME_SERIES, seoLogs: true }, dataStore: fakeStore })
    const runtime = out.custom.seoAnalyzer.store
    expect(runtime.enabled).toEqual(['seo-logs'])
    expect(runtime.resolveStore({})).toBe(fakeStore)
    // Not in the client config.
    expect(JSON.stringify(out.admin.custom)).not.toContain('resolveStore')
  })
})

describe('seoAnalyzerPlugin — cache invalidation wiring', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hooksOf = (out: any, slug: string, kind: string): unknown[] => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = out.collections.find((x: any) => x.slug === slug)
    const h = c?.hooks?.[kind] ?? []
    return Array.isArray(h) ? h : [h]
  }

  it('invalidates on save/delete even with score history off (the apps/web setup)', () => {
    const out = run({ collections: ['pages'], features: { scoreHistory: false } })
    expect(hooksOf(out, 'pages', 'afterChange').length).toBe(1)
    expect(hooksOf(out, 'pages', 'afterDelete').length).toBe(1)
  })

  it('invalidates on redirects and settings changes', () => {
    const out = run({ collections: ['pages'] })
    expect(hooksOf(out, 'seo-redirects', 'afterChange').length).toBeGreaterThan(0)
    expect(hooksOf(out, 'seo-redirects', 'afterDelete').length).toBeGreaterThan(0)
    expect(hooksOf(out, 'seo-settings', 'afterChange').length).toBeGreaterThan(0)
  })

  it('routes the dashboard audit through the cacheStore and waitUntil', async () => {
    const data = new Map<string, string>()
    const store = {
      get: async (k: string) => data.get(k) ?? null,
      put: async (k: string, v: string) => void data.set(k, v),
      delete: async (k: string) => void data.delete(k),
    }
    const background: Promise<unknown>[] = []
    const out = run({
      collections: ['pages'],
      cacheStore: store,
      waitUntil: (p: Promise<unknown>) => void background.push(p),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const audit = out.endpoints.find((e: any) => e.path === '/seo-plugin/audit')
    const payload = {
      config: { admin: { user: 'users' } },
      logger: { warn: () => {}, error: () => {}, info: () => {} },
      find: async () => ({ docs: [], hasNextPage: false }),
      findGlobal: async () => null,
    }
    const res = await audit.handler({
      user: { id: 'cache-wiring', collection: 'users' },
      url: 'http://localhost/api/seo-plugin/audit',
      payload,
    })
    expect(res.status).toBe(202)
    expect(background).toHaveLength(1)
    await Promise.all(background)
    expect([...data.keys()].some((k) => k.startsWith('entry/audit'))).toBe(true)
  })
})
