/**
 * Core Web Vitals endpoint (SEO 2026).
 *
 * Fetches real CWV (LCP / INP / CLS) for a page via the Google PageSpeed Insights API.
 * Prefers CrUX *field* data (real users) and falls back to Lighthouse *lab* data.
 *
 * Design constraints from the SEO analysis:
 *  - INFORMATIONAL ONLY — CWV is a tie-breaker, never injected into the SEO score.
 *  - Thresholds are Google's official CWV thresholds (NOT the unconfirmed "2.0s" rumor),
 *    and overridable via the `thresholds` query param shape if needed.
 *  - On-demand only (no automatic site-wide crawl — that would blow the PSI quota).
 *  - SSRF-safe: only the configured site's own origin can be tested.
 *
 * `PAGESPEED_API_KEY` (env) is effectively REQUIRED on a deployed Worker: without a key PSI
 * uses a shared keyless quota that usually answers 429. The code still runs without one, so
 * local dev and tests work, and the panel says why a request failed.
 * Read-only; requires an authenticated user.
 *
 * `originFallback`: PSI sets `loadingExperience.origin_fallback` when the page has too little
 * CrUX traffic and the field data is the whole site's. The response passes it on.
 */
import type { PayloadHandler } from 'payload'
import type { SeoConfig } from '../types.js'
import { defaultSeoSharedCache, type SeoSharedCache } from '../cache.js'
import { isSeoAdminRequest, isSeoPanelUser } from '../helpers/isAdmin.js'
import { resolveSiteUrl as resolveSharedSiteUrl } from '../helpers/siteUrl.js'

// Google's official Core Web Vitals thresholds (good / needs-improvement boundaries).
const CWV_THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 }, // ms
  inp: { good: 200, poor: 500 }, // ms
  cls: { good: 0.1, poor: 0.25 }, // unitless
} as const

type Rating = 'good' | 'needs-improvement' | 'poor' | 'unknown'

function rate(value: number | null, t: { good: number; poor: number }): Rating {
  if (value === null || Number.isNaN(value)) return 'unknown'
  if (value <= t.good) return 'good'
  if (value <= t.poor) return 'needs-improvement'
  return 'poor'
}

function resolveSiteUrl(seoConfig?: SeoConfig): string | undefined {
  return resolveSharedSiteUrl(seoConfig?.siteUrl) || undefined
}

/** Lowercase hex SHA-256 of `text` (WebCrypto: Workers and Node). */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function createCoreWebVitalsHandler(
  seoConfig?: SeoConfig,
  cache: SeoSharedCache = defaultSeoSharedCache,
): PayloadHandler {
  return async (req) => {
    try {
      if (!isSeoPanelUser(req)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const reqUrl = new URL(req.url as string)
      const target = reqUrl.searchParams.get('url')
      const strategy = reqUrl.searchParams.get('strategy') === 'desktop' ? 'desktop' : 'mobile'

      if (!target) {
        return Response.json({ error: 'Missing required query param: url' }, { status: 400 })
      }

      // SSRF protection — only allow the configured site's own origin.
      const siteUrl = resolveSiteUrl(seoConfig)
      if (!siteUrl) {
        return Response.json(
          { error: 'siteUrl is not configured — set it in the plugin config or the SITE_URL environment variable.' },
          { status: 400 },
        )
      }
      let targetOrigin: string
      let siteOrigin: string
      try {
        targetOrigin = new URL(target).origin
        siteOrigin = new URL(siteUrl).origin
      } catch {
        return Response.json({ error: 'Invalid url.' }, { status: 400 })
      }
      if (targetOrigin !== siteOrigin) {
        return Response.json(
          { error: 'Only the configured site origin can be tested.' },
          { status: 403 },
        )
      }

      // Cache by url+strategy in the shared cache (24 h, survives isolates) — CrUX field data
      // changes slowly and the PSI quota is strict (repeated panel opens would otherwise
      // hammer the API → 429). The URL is hashed so the key stays within the store's
      // `[a-z0-9:/._-]` alphabet whatever the query string holds. Two isolates that miss on
      // the same cold key still both call PSI; this shrinks that, it doesn't remove it.
      // Cache-busting forces a fresh PSI call (one slice of the quota), so it is reserved
      // to SEO admins — the same gate as /audit?nocache=1. A panel user without the role
      // silently gets the cached result instead of a 403.
      const noCache = reqUrl.searchParams.get('nocache') === '1' && isSeoAdminRequest(req)
      const CACHE_KEY = `core-web-vitals:${strategy}:${await sha256Hex(target)}`
      const lookup = await cache.lookup<Record<string, unknown>>('core-web-vitals', CACHE_KEY)
      const cachedCwv = noCache ? null : lookup.data
      if (cachedCwv) {
        return Response.json(
          { ...cachedCwv, cached: true, ...(lookup.builtAt !== undefined ? { builtAt: lookup.builtAt } : {}) },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      }

      const apiKey = process.env.PAGESPEED_API_KEY || ''

      const psi = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed')
      psi.searchParams.set('url', target)
      psi.searchParams.set('category', 'performance')
      psi.searchParams.set('strategy', strategy)
      if (apiKey) psi.searchParams.set('key', apiKey)

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)
      let psiData: Record<string, unknown>
      try {
        const resp = await fetch(psi.toString(), { signal: controller.signal })
        if (!resp.ok) {
          const detail = resp.status === 429 ? ' (PSI quota exceeded — set PAGESPEED_API_KEY)' : ''
          return Response.json(
            { error: `PageSpeed Insights request failed: ${resp.status}${detail}` },
            { status: 502 },
          )
        }
        psiData = (await resp.json()) as Record<string, unknown>
      } finally {
        clearTimeout(timeout)
      }

      // ---- Field data (CrUX, real users) ----
      const loadingExperience = (psiData.loadingExperience || {}) as Record<string, unknown>
      const metrics = (loadingExperience.metrics || {}) as Record<string, Record<string, unknown>>
      const fieldMetric = (key: string): number | null => {
        const m = metrics[key]
        const p = m?.percentile
        return typeof p === 'number' ? p : null
      }
      const fieldLcp = fieldMetric('LARGEST_CONTENTFUL_PAINT_MS')
      const fieldInp = fieldMetric('INTERACTION_TO_NEXT_PAINT')
      const fieldClsRaw = fieldMetric('CUMULATIVE_LAYOUT_SHIFT_SCORE')
      const fieldCls = fieldClsRaw !== null ? fieldClsRaw / 100 : null // CrUX returns CLS * 100
      const hasFieldData = fieldLcp !== null || fieldInp !== null || fieldCls !== null
      // PSI answers with the whole origin's CrUX data when the page has too little traffic.
      const originFallback = hasFieldData && loadingExperience.origin_fallback === true

      // ---- Lab data (Lighthouse) fallback ----
      const lighthouse = (psiData.lighthouseResult || {}) as Record<string, unknown>
      const audits = (lighthouse.audits || {}) as Record<string, Record<string, unknown>>
      const labNumeric = (id: string): number | null => {
        const v = audits[id]?.numericValue
        return typeof v === 'number' ? v : null
      }
      const labLcp = labNumeric('largest-contentful-paint')
      const labCls = labNumeric('cumulative-layout-shift')
      // INP has no lab equivalent; TBT is the lab proxy.
      const labTbt = labNumeric('total-blocking-time')

      const lcp = fieldLcp ?? labLcp
      const inp = fieldInp // field only
      const cls = fieldCls ?? labCls

      const responseData = {
        url: target,
        strategy,
        source: hasFieldData ? 'field' : 'lab',
        hasFieldData,
        originFallback,
        metrics: {
          lcp: { value: lcp, unit: 'ms', rating: rate(lcp, CWV_THRESHOLDS.lcp) },
          inp: {
            value: inp,
            unit: 'ms',
            rating: rate(inp, CWV_THRESHOLDS.inp),
            note: inp === null ? 'INP needs real-user (field) data; not available in lab.' : undefined,
          },
          cls: { value: cls, unit: 'score', rating: rate(cls, CWV_THRESHOLDS.cls) },
          tbt: { value: labTbt, unit: 'ms', source: 'lab' },
        },
        thresholds: CWV_THRESHOLDS,
        keyConfigured: !!apiKey,
        note: 'Informational only — Core Web Vitals are a ranking tie-breaker, not part of the on-page SEO score.',
      }

      const builtAt = await cache.set('core-web-vitals', CACHE_KEY, responseData, lookup.gen)
      return Response.json({ ...responseData, builtAt }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[seo] core-web-vitals error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
