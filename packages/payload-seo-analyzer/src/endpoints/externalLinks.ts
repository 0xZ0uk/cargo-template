/**
 * External Links Check endpoint handler.
 * Scans all pages/posts for external links, then verifies each URL (HEAD, GET fallback)
 * to detect broken external links.
 *
 * Workers limits (PLAN.md, P2 item 13): the scan stays inside the per-invocation subrequest
 * budget and the 6 open connections, see `helpers/linkChecker.ts`. A scan is capped at
 * `SEO_EXTERNAL_LINKS_MAX` unique URLs (default 100) and, if links are slow, runs in steps:
 * each call checks what it can within `stepMs` / the subrequest budget, saves every result
 * in the shared cache (`external-link-checks`, R2 on Workers), and answers `partial: true`
 * with the count still `pending`. Calling again resumes from the saved results.
 * A finished scan is cached as `external-links`.
 *
 * NOTE: Rate limiting is not handled by this plugin. The consuming application
 * should implement rate limiting via its own middleware (e.g., express-rate-limit,
 * Next.js middleware, or a reverse proxy like Nginx/Caddy).
 */

import type { PayloadHandler } from 'payload'
import { defaultSeoSharedCache, type SeoSharedCache } from '../cache.js'
import { fetchAllDocs } from '../helpers/fetchAllDocs.js'
import { checkLinks, type LinkCheckResult, type LinkCheckerOptions } from '../helpers/linkChecker.js'
import { classifyLink, countLinkStates, LINK_STATES } from '../helpers/linkStatus.js'
import type { SeoConfig } from '../types.js'
import { resolveSiteUrl } from '../helpers/siteUrl.js'
import { parseJsonBody } from '../helpers/parseBody.js'
import { isSeoAdminRequest, isSeoPanelUser } from '../helpers/isAdmin.js'
import { safeCacheLocale } from '../helpers/safeCacheLocale.js'

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** A stored link check is reused for this long (the blob itself lives as long as the shared cache TTL). */
const CHECK_TTL_MS = 60 * 60 * 1000 // 1 hour
/** Stop starting links this long into one call (leaves room to answer before proxies time out). */
const DEFAULT_STEP_MS = 25_000

export const EXTERNAL_LINK_CHECKS_BASE = 'external-link-checks'
export const EXTERNAL_LINKS_BASE = 'external-links'

function envInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] || '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Unique URLs checked per scan. Env `SEO_EXTERNAL_LINKS_MAX`, default 100. */
export function externalLinksMax(): number {
  return envInt('SEO_EXTERNAL_LINKS_MAX', 100)
}

/**
 * Subrequests one call may spend on checks (fetches, redirect hops and DNS lookups).
 * Env `SEO_EXTERNAL_LINKS_MAX_SUBREQUESTS`, default 1000. Workers allow 10,000 per invocation
 * on the paid plan and 50 on Free, and D1/R2 calls (reading the pages, the cache) count too.
 * On Free, set it to about 30 and `SEO_EXTERNAL_LINKS_MAX` to about 10.
 */
export function externalLinksMaxSubrequests(): number {
  return envInt('SEO_EXTERNAL_LINKS_MAX_SUBREQUESTS', 1000)
}

export interface ExternalLinksOptions {
  /** Overrides for the checker (tests: `fetchImpl`, `guard`, `concurrency`…). */
  checker?: LinkCheckerOptions
  /** Stop starting links this many ms into a call (default 25 s). */
  stepMs?: number
}

// ---------------------------------------------------------------------------
// Recursive Lexical node traversal to extract external URLs
// ---------------------------------------------------------------------------

function extractExternalLinks(node: unknown): string[] {
  if (!node || typeof node !== 'object') return []

  const n = node as Record<string, unknown>
  const links: string[] = []

  // Standard Lexical link node
  if (n.type === 'link' && n.fields && typeof n.fields === 'object') {
    const fields = n.fields as Record<string, unknown>
    if (typeof fields.url === 'string') {
      const url = fields.url
      if (url.startsWith('http://') || url.startsWith('https://')) {
        links.push(url)
      }
    }
  }

  // Lexical autolink node
  if (n.type === 'autolink' && n.fields && typeof n.fields === 'object') {
    const fields = n.fields as Record<string, unknown>
    if (typeof fields.url === 'string') {
      const url = fields.url
      if (url.startsWith('http://') || url.startsWith('https://')) {
        links.push(url)
      }
    }
  }

  // Recurse into children
  if (Array.isArray(n.children)) {
    for (const child of n.children) {
      links.push(...extractExternalLinks(child))
    }
  }

  // Recurse into root (Lexical root node)
  if (n.root && typeof n.root === 'object') {
    links.push(...extractExternalLinks(n.root))
  }

  return links
}

// ---------------------------------------------------------------------------
// Extract all external links from a Payload document
// ---------------------------------------------------------------------------

export function extractDocExternalLinks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  siteUrl?: string,
): string[] {
  const allLinks: string[] = []

  // Hero richText
  if (doc.hero?.richText) {
    allLinks.push(...extractExternalLinks(doc.hero.richText))
  }

  // Layout blocks
  const blocks = Array.isArray(doc.layout) ? doc.layout : []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue

    // Direct richText on block
    if (block.richText) {
      allLinks.push(...extractExternalLinks(block.richText))
    }

    // Columns with richText
    if (Array.isArray(block.columns)) {
      for (const col of block.columns) {
        if (col?.richText) {
          allLinks.push(...extractExternalLinks(col.richText))
        }
      }
    }
  }

  // Post content (Lexical richText)
  if (doc.content && typeof doc.content === 'object' && !Array.isArray(doc.content)) {
    allLinks.push(...extractExternalLinks(doc.content))
  }

  // Filter out the site's own domain if provided
  if (siteUrl) {
    try {
      const siteHost = new URL(siteUrl).host
      return allLinks.filter((url) => {
        try {
          return new URL(url).host !== siteHost
        } catch {
          return true
        }
      })
    } catch {
      // Invalid siteUrl — return all
    }
  }

  return allLinks
}

// ---------------------------------------------------------------------------
// Endpoint handler
// ---------------------------------------------------------------------------

/** Dedupe key: trimmed, fragment dropped (`#x` never changes the response). */
function normalizeLink(raw: string): string {
  const trimmed = raw.trim()
  try {
    const u = new URL(trimmed)
    u.hash = ''
    return u.toString()
  } catch {
    return trimmed
  }
}

export function createExternalLinksHandler(
  collections: string[],
  globals: string[] = [],
  seoConfig?: SeoConfig,
  sharedCache: SeoSharedCache = defaultSeoSharedCache,
  options: ExternalLinksOptions = {},
): PayloadHandler {
  return async (req) => {
    try {
      if (!isSeoPanelUser(req)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const url = new URL(req.url as string)
      let forceRefresh = false
      if (req.method === 'POST') {
        const body = await parseJsonBody(req)
        forceRefresh = !!body.forceRefresh
      }
      // Bypassing the cache forces the full site-wide recomputation this endpoint caches, so
      // it is reserved to SEO admins — the same gate as /audit?nocache=1. A panel user
      // without the role silently gets the cached result instead of a 403.
      const bypass = (url.searchParams.get('nocache') === '1' || forceRefresh) && isSeoAdminRequest(req)
      // Locale-scoped: content differs per locale, so cache must not collide across locales.
      const reqLocale = safeCacheLocale(req)
      const CACHE_KEY = reqLocale ? `${EXTERNAL_LINKS_BASE}:${reqLocale}` : EXTERNAL_LINKS_BASE
      // Read the generation BEFORE scanning: a save during the scan makes the result stale.
      const lookup = await sharedCache.lookup<Record<string, unknown>>(EXTERNAL_LINKS_BASE, CACHE_KEY)
      if (!bypass && lookup.data) {
        return Response.json({ ...lookup.data, cached: true })
      }

      // Detect site URL for filtering own-domain links
      const siteUrl = resolveSiteUrl(seoConfig?.siteUrl)

      // 1. Collect all external links across all documents
      const urlSources = new Map<string, Array<{ title: string; slug: string; collection: string }>>()

      const allFetched = await fetchAllDocs(req.payload, {
        collections,
        globals,
        depth: 0,
      })

      for (const { doc, sourceType, sourceSlug } of allFetched) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = doc as any
        const collectionLabel = sourceType === 'global' ? `global:${sourceSlug}` : sourceSlug
        const links = extractDocExternalLinks(d, siteUrl)

        for (const rawLink of links) {
          const link = normalizeLink(rawLink)
          if (!urlSources.has(link)) {
            urlSources.set(link, [])
          }
          const sources = urlSources.get(link)!
          // Avoid duplicate source pages for the same URL
          const already = sources.some(
            (s) => s.slug === (d.slug || '') && s.collection === collectionLabel,
          )
          if (!already) {
            sources.push({
              title: d.title || sourceSlug,
              slug: d.slug || '',
              collection: collectionLabel,
            })
          }
        }
      }

      // 2. Cap the unique URLs (deterministic: first seen wins, so a capped scan is stable
      //    across steps and the saved checks keep matching).
      const maxLinks = externalLinksMax()
      const foundUrls = Array.from(urlSources.keys())
      const uniqueUrls = foundUrls.slice(0, maxLinks)
      const capped = foundUrls.length > uniqueUrls.length

      // 3. Reuse saved checks, check the rest within this call's time and subrequest budget.
      //    `bypass` ignores saved checks: that's the "rescan".
      const now = Date.now()
      const stored = bypass
        ? {}
        : (await sharedCache.get<Record<string, LinkCheckResult>>(EXTERNAL_LINK_CHECKS_BASE, EXTERNAL_LINK_CHECKS_BASE)) ?? {}
      const checks = new Map<string, LinkCheckResult>()
      const todo: string[] = []
      for (const link of uniqueUrls) {
        const saved = stored[link]
        if (saved && typeof saved.checkedAt === 'number' && now - saved.checkedAt < CHECK_TTL_MS) {
          checks.set(link, saved)
        } else {
          todo.push(link)
        }
      }

      let pending = 0
      let subrequests = 0
      let stoppedBy: 'budget' | 'deadline' | null = null
      if (todo.length) {
        const run = await checkLinks(todo, {
          maxSubrequests: externalLinksMaxSubrequests(),
          deadline: now + (options.stepMs ?? DEFAULT_STEP_MS),
          ...options.checker,
        })
        for (const [link, result] of run.results) checks.set(link, result)
        pending = run.skipped.length
        subrequests = run.subrequests
        stoppedBy = run.stoppedBy
        // Save progress even when the scan isn't finished: that is what the next call resumes from.
        if (run.results.size) {
          try {
            await sharedCache.set(
              EXTERNAL_LINK_CHECKS_BASE,
              EXTERNAL_LINK_CHECKS_BASE,
              Object.fromEntries(checks),
            )
          } catch (e) {
            req.payload.logger.warn(
              `[seo] external-links: couldn't save link checks: ${e instanceof Error ? e.message : String(e)}`,
            )
          }
        }
      }

      const results = uniqueUrls
        .filter((link) => checks.has(link))
        .map((link) => {
          const result = checks.get(link)!
          return {
            url: link,
            status: result.status,
            ok: result.ok,
            /** The one bucket this link is counted in (see `helpers/linkStatus.ts`). */
            state: classifyLink(result),
            ...(result.error && { error: result.error }),
            sourcePages: urlSources.get(link) || [],
          }
        })

      // 4. Compute stats: every checked link is in exactly one bucket, so
      //    ok + broken + timeout + error + blocked + unverified === total.
      const stats = countLinkStates(results)

      // Worst first (broken, timeout, error, blocked, unverified, ok); stable within a bucket.
      results.sort((a, b) => LINK_STATES.indexOf(a.state) - LINK_STATES.indexOf(b.state))

      const responseData = {
        results,
        stats,
        /** More unique external links exist than `maxLinks`: only the first `maxLinks` were checked. */
        capped,
        totalFound: foundUrls.length,
        maxLinks,
        /** Links not checked yet (this call ran out of time or subrequests): call again to continue. */
        pending,
        partial: pending > 0,
        ...(stoppedBy && { stoppedBy }),
        subrequests,
      }
      // Only a finished scan is cached; a partial one resumes from the saved checks. An older
      // finished result must not outlive a rescan that is still going, or the next call would
      // serve it instead of continuing.
      if (pending === 0) {
        await sharedCache.set(EXTERNAL_LINKS_BASE, CACHE_KEY, responseData, lookup.gen)
      } else if (lookup.data || bypass) {
        await sharedCache.invalidateKey(EXTERNAL_LINKS_BASE, CACHE_KEY)
      }
      return Response.json({ ...responseData, cached: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[seo] external-links error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
