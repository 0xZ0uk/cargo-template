import { createServerFn } from '@tanstack/react-start'

import type { RedirectIndex, ResolvedRedirect } from '@/utilities/redirects'

import { buildRedirectIndex, matchRedirect } from '@/utilities/redirects'

type ResolveRedirectInput = {
  /** The request's URL pathname. */
  pathname: string
  /** The request's raw query string, carried over to the target. */
  search?: string
}

/** A new redirect applies on a warm isolate after at most this long. */
const CACHE_TTL_MS = 60_000
/** After a failed read, serve "no redirect" this long before trying D1 again. */
const FAILURE_TTL_MS = 10_000
/** Bounds the isolate's memory; redirect lists are far smaller in practice. */
const MAX_REDIRECTS = 5000

type CacheEntry = { expiresAt: number; index: RedirectIndex }

// Per-isolate and best effort: it only saves D1 reads for repeated misses. Nothing in the UI
// depends on it, and a cold isolate simply reads the table again.
let cache: CacheEntry | undefined
let inflight: Promise<CacheEntry> | undefined

const loadIndex = async (): Promise<CacheEntry> => {
  const { getPayload } = await import('payload')
  const payload = await getPayload({ config: (await import('@payload-config')).default })

  try {
    // The collection's read access is limited to admin users, but these records are public by
    // nature (they're served as `Location` headers), so this system read bypasses it.
    const { docs } = await payload.find({
      collection: 'seo-redirects',
      depth: 0,
      limit: MAX_REDIRECTS,
      overrideAccess: true,
      pagination: false,
      select: { from: true, to: true, type: true },
      sort: '-updatedAt',
    })

    return { expiresAt: Date.now() + CACHE_TTL_MS, index: buildRedirectIndex(docs) }
  } catch (error) {
    payload.logger.error({ err: error, msg: 'Failed to load seo-redirects' })

    return { expiresAt: Date.now() + FAILURE_TTL_MS, index: new Map() }
  }
}

const getIndex = async () => {
  if (cache && cache.expiresAt > Date.now()) return cache.index

  // Concurrent misses share one read.
  inflight ??= loadIndex().finally(() => {
    inflight = undefined
  })
  cache = await inflight

  return cache.index
}

/**
 * Records the 404 in the SEO analyzer's 404 log (the admin's sitemap audit, 404 tab), in the
 * background. A no-op while the plugin's `seoLogs` feature is off. Rows go to the SEO_D1
 * database, capped (`SEO_LOGS_MAX_ROWS`) and pruned by the retention job.
 */
const recordNotFound = async (pathname: string) => {
  const [{ getPayload }, { recordSeoNotFound }, { getRequestHeader }, { waitUntil }] = await Promise.all([
    import('payload'),
    import('@cargo/payload-seo-analyzer'),
    import('@tanstack/react-start/server'),
    import('#cloudflare-runtime'),
  ])
  const payload = await getPayload({ config: (await import('@payload-config')).default })
  // On a client-side navigation this is the page holding the broken link, which is what an
  // editor needs to fix it.
  const hit = recordSeoNotFound(payload, {
    url: pathname,
    referrer: getRequestHeader('referer'),
    userAgent: getRequestHeader('user-agent'),
  })

  // Don't hold the 404 response for the write. `waitUntil` is undefined on Node, where the
  // promise outlives the response anyway. `recordSeoNotFound` never throws.
  if (waitUntil) waitUntil(hit)
  else void hit
}

/**
 * Looks up a redirect for a path that matched no page, and logs the 404 when there's none.
 * Call it only after the page lookup misses, so existing pages never pay for it.
 */
export const resolveRedirect = createServerFn({ method: 'GET' })
  .validator((data: ResolveRedirectInput): ResolveRedirectInput => data)
  .handler(async ({ data }): Promise<ResolvedRedirect | null> => {
    const target = matchRedirect(await getIndex(), data.pathname, data.search)

    if (!target) await recordNotFound(data.pathname)

    return target
  })
