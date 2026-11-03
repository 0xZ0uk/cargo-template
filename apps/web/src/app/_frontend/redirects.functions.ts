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
 * Looks up a redirect for a path that matched no page. Call it only after the page lookup
 * misses, so existing pages never pay for it.
 */
export const resolveRedirect = createServerFn({ method: 'GET' })
  .validator((data: ResolveRedirectInput): ResolveRedirectInput => data)
  .handler(
    async ({ data }): Promise<ResolvedRedirect | null> =>
      matchRedirect(await getIndex(), data.pathname, data.search),
  )
