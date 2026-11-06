/**
 * XML Sitemap endpoint handler.
 * GET — Dynamically generates sitemap.xml from published documents
 * across all target collections, respecting seo-settings configuration.
 */

import type { PayloadHandler } from 'payload'
import type { SeoConfig } from '../types.js'
import { buildDocPath } from '../helpers/docUrl.js'
import { requestOrigin, resolveSiteUrl } from '../helpers/siteUrl.js'
import { buildSelect } from '../helpers/buildSelect.js'
import { fetchAllDocs } from '../helpers/fetchAllDocs.js'
import { defaultSeoSharedCache, hashConfig, safeLookup, safeSet, type SeoSharedCache } from '../cache.js'
import { sha256Hex } from '../helpers/sha256.js'

/**
 * Cache key base for the rendered XML. Scoped by the collections the handler was
 * built with (never by anything the caller sends): the document is identical for
 * every anonymous visitor, so a shared entry leaks nothing and is no oracle.
 * Cleared by the same afterChange invalidation as the other caches — see
 * CONTENT_CACHE_BASES in cache.ts. Persisted in the shared `cacheStore` when one is
 * configured, so every isolate serves the same build and a save invalidates all of them.
 */
export const SITEMAP_XML_CACHE_BASE = 'sitemap-xml'

/**
 * Memory cap for the public sitemap build.
 *
 * This handler used to pass a hard-coded `limit: 10000` to fetchAllDocs, which
 * takes precedence over SEO_FETCH_MAX_DOCS: an operator lowering that variable to
 * survive on a constrained host still loaded 10 000 documents on every ANONYMOUS
 * request. The cap now comes from the environment, like every other site-wide read,
 * and reuses the SEO_SITEMAP_MAX_DOCS name already honoured by the news/image/video
 * sitemaps so the two public paths share one knob.
 */
function sitemapMaxDocs(): number {
  const raw = process.env.SEO_SITEMAP_MAX_DOCS ?? process.env.SEO_FETCH_MAX_DOCS
  const parsed = raw != null ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000
}

/** Document fields the sitemap reads (see the loop in the handler). */
export const SITEMAP_SELECT_PATHS = ['slug', 'updatedAt', '_status', 'noindex', 'meta.noindex']

/** Escape special XML characters */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Check if a slug matches a pattern (supports trailing wildcard: blog/*) */
function matchesPattern(slug: string, pattern: string): boolean {
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2)
    return slug === prefix || slug.startsWith(prefix + '/')
  }
  return slug === pattern
}

interface SitemapUrl {
  loc: string
  lastmod?: string
  changefreq?: string
  priority?: string
}

/**
 * GET handler — generates sitemap.xml dynamically.
 * Public endpoint, no authentication required.
 */
export function createSitemapHandler(
  targetCollections: string[],
  seoConfig?: SeoConfig,
  cache: SeoSharedCache = defaultSeoSharedCache,
): PayloadHandler {
  const xmlResponse = (xml: string) =>
    new Response(xml, {
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    })

  return async (req) => {
    try {
      // Serve the rendered XML when it is still warm. Without this, every anonymous
      // hit re-scanned the whole corpus — the most expensive request in the plugin,
      // on its only unauthenticated (and deliberately un-rate-limited) endpoint.
      // Staleness stays bounded by the cache TTL, which is well under the one-hour
      // Cache-Control this endpoint has always advertised.
      // The entry lives in the shared cache (R2 with a `cacheStore`), so isolates share one
      // build and a save invalidates it everywhere. A miss, e.g. right after a save, is a plain
      // rebuild with no stale-while-revalidate: several concurrent requests may each rebuild
      // once, which is acceptable now that the build only reads the fields it needs.
      // Without a configured site URL, fall back to the request's origin (sitemap
      // `<loc>` values must be absolute). The XML then depends on the host, so the
      // origin is part of the cache key.
      const serverUrl = resolveSiteUrl(seoConfig?.siteUrl, requestOrigin(req))
      // The collections and the origin (request-derived: uppercase host, IPv6 literal, query
      // string…) are hashed so the key stays within the store's `[a-z0-9:/._-]`.
      // Persisted entries outlive deploys: scope them by the config that shapes the XML
      // (`collectionRoutes` builds every `<loc>`).
      const configSuffix = cache.persistent ? `:${hashConfig({ v: 1, seoConfig: seoConfig ?? null })}` : ''
      const cacheKey = `${SITEMAP_XML_CACHE_BASE}:${await sha256Hex(JSON.stringify([targetCollections, serverUrl]))}${configSuffix}`
      const lookup = await safeLookup<string>(cache, SITEMAP_XML_CACHE_BASE, cacheKey, req)
      if (typeof lookup.data === 'string') return xmlResponse(lookup.data)

      // Read sitemap config from seo-settings
      const settingsResult = await req.payload.find({
        collection: 'seo-settings',
        limit: 1,
        overrideAccess: true,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = settingsResult.docs[0] as Record<string, any> | undefined
      const sitemapConfig = config?.sitemap || {}

      const excludedSlugs: string[] = (sitemapConfig.excludedSlugs || []).map(
        (entry: { slug: string }) => entry.slug,
      )
      const defaultChangefreq: string = sitemapConfig.defaultChangefreq || 'weekly'
      const defaultPriority: number = sitemapConfig.defaultPriority ?? 0.5
      const priorityOverrides: Array<{
        slugPattern: string
        priority: number
        changefreq?: string
      }> = sitemapConfig.priorityOverrides || []

      // Fetch all published documents from target collections
      const allDocs = await fetchAllDocs(req.payload, {
        collections: targetCollections,
        depth: 0,
        maxDocs: sitemapMaxDocs(),
        // Only what the loop below reads — never the layout blocks / Lexical trees.
        select: buildSelect(req.payload, targetCollections, SITEMAP_SELECT_PATHS),
      })

      const urls: SitemapUrl[] = []

      for (const { doc, sourceSlug: collectionSlug } of allDocs) {
        // Skip drafts
        if (doc._status === 'draft') continue
        // Skip documents the editor explicitly removed from indexing. sitemap.xml is a
        // PUBLIC, anonymous endpoint built with overrideAccess: true — without this filter
        // it published the URLs of noindex pages (post-purchase thank-you, private pricing,
        // test landing pages) and contradicted /llms.txt, which already honours the flag.
        if (doc.noindex === true || doc?.meta?.noindex === true) continue

        const slug: string = doc.slug || ''

        // Skip excluded slugs
        if (excludedSlugs.some((excluded) => matchesPattern(slug, excluded))) continue

        const isHome = slug === 'home' || slug === ''
        // Prefix by the collection route (posts → /posts/<slug> by default):
        // emitting the bare slug for a `posts` document declares a 404 to
        // Googlebot and wastes crawl budget.
        const path = buildDocPath(slug, collectionSlug, seoConfig?.collectionRoutes)

        // Determine priority and changefreq
        let priority = defaultPriority
        let changefreq = defaultChangefreq

        // Home page always gets highest priority
        if (isHome) {
          priority = 1.0
          changefreq = 'weekly'
        } else if (collectionSlug === 'posts') {
          // Blog posts default to slightly higher priority than generic default
          priority = Math.max(priority, 0.7)
          changefreq = 'weekly'
        } else {
          // Pages default
          priority = Math.max(priority, 0.8)
          changefreq = 'monthly'
        }

        // Apply priority overrides from settings
        for (const override of priorityOverrides) {
          if (matchesPattern(slug, override.slugPattern)) {
            priority = override.priority
            if (override.changefreq) changefreq = override.changefreq
            break
          }
        }

        urls.push({
          loc: `${serverUrl}${path}`,
          lastmod: doc.updatedAt
            ? new Date(doc.updatedAt).toISOString().split('T')[0]
            : undefined,
          changefreq,
          priority: priority.toFixed(1),
        })
      }

      // Build XML
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
      xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      for (const url of urls) {
        xml += '  <url>\n'
        xml += `    <loc>${escapeXml(url.loc)}</loc>\n`
        if (url.lastmod) xml += `    <lastmod>${url.lastmod}</lastmod>\n`
        if (url.changefreq) xml += `    <changefreq>${url.changefreq}</changefreq>\n`
        if (url.priority) xml += `    <priority>${url.priority}</priority>\n`
        xml += '  </url>\n'
      }
      xml += '</urlset>'

      // Stamped with the generation read BEFORE the build: a save that lands meanwhile makes
      // this entry stale instead of masking it.
      await safeSet(cache, SITEMAP_XML_CACHE_BASE, cacheKey, xml, lookup, req)
      return xmlResponse(xml)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[seo] sitemap.xml generation error: ${message}`)
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
        {
          headers: { 'Content-Type': 'application/xml' },
          status: 500,
        },
      )
    }
  }
}
