import { createServerFn } from '@tanstack/react-start'

import type { RedirectIndex, ResolvedRedirect } from '@/utilities/redirects'

import { buildRedirectIndex, matchRedirect } from '@/utilities/redirects'
import { r2SeoCacheStore } from '@/plugins/seoCacheStore'
import { FRONTEND_REDIRECTS_CACHE_BASE } from '@shipment/payload-seo-analyzer/shared'

import { createRedirectIndexCache } from './redirectIndexCache'

type ResolveRedirectInput = {
  /** The request's URL pathname. */
  pathname: string
  /** The request's raw query string, carried over to the target. */
  search?: string
}

/** Bounds the isolate's memory: the index is reloaded at least this often. */
const CACHE_TTL_MS = 60_000
/** After a failed read, serve "no redirect" this long before trying D1 again. */
const FAILURE_TTL_MS = 10_000
/** Bounds the isolate's memory; redirect lists are far smaller in practice. */
const MAX_REDIRECTS = 5000

const GENERATION_KEY = `gen/${FRONTEND_REDIRECTS_CACHE_BASE}`

const loadIndex = async (): Promise<{ index: RedirectIndex; ok: boolean }> => {
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

    return { index: buildRedirectIndex(docs), ok: true }
  } catch (error) {
    payload.logger.error({ err: error, msg: 'Failed to load seo-redirects' })

    return { index: new Map(), ok: false }
  }
}

/**
 * The marker the plugin's redirect hooks bump (in the R2 cache store) on every create, update
 * and delete, so a change reaches every isolate on its next lookup instead of after the TTL.
 * A store without the marker yet (no redirect saved since it was added) reads as '0'.
 */
const readGeneration = async () => {
  const { cloudflareEnv } = await import('#cloudflare-runtime')

  return (await r2SeoCacheStore(cloudflareEnv.R2).get(GENERATION_KEY)) ?? '0'
}

const warnGenerationError = async (error: unknown) => {
  const { getPayload } = await import('payload')
  const payload = await getPayload({ config: (await import('@payload-config')).default })

  payload.logger.warn({ err: error, msg: 'Failed to read the redirects generation; using the cached index' })
}

// Per-isolate: it saves D1 reads for repeated misses, and the shared generation keeps it
// current. A cold isolate simply reads the table again.
const getIndex = createRedirectIndexCache({
  readGeneration,
  load: loadIndex,
  ttlMs: CACHE_TTL_MS,
  failureTtlMs: FAILURE_TTL_MS,
  onGenerationError: (error) => void warnGenerationError(error).catch(() => {}),
})

/**
 * Records the 404 in the SEO analyzer's 404 log (the admin's sitemap audit, 404 tab), in the
 * background. A no-op while the plugin's `seoLogs` feature is off. Rows go to the SEO_D1
 * database, capped (`SEO_LOGS_MAX_ROWS`) and pruned by the retention job.
 */
const recordNotFound = async (pathname: string) => {
  const [{ getPayload }, { recordSeoNotFound }, { getRequestHeader }, { waitUntil }] = await Promise.all([
    import('payload'),
    import('@shipment/payload-seo-analyzer'),
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
