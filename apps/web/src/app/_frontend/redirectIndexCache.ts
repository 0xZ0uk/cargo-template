import type { RedirectIndex } from '@/utilities/redirects'

type CacheEntry = {
  /** The shared generation read before the index was loaded; undefined if that read failed. */
  gen: string | undefined
  expiresAt: number
  index: RedirectIndex
}

export type RedirectIndexCacheOptions = {
  /** Reads the shared generation marker the redirect hooks bump on every change. */
  readGeneration: () => Promise<string>
  /** Reads the redirects table. `ok: false` marks a failed read (cached for `failureTtlMs`). */
  load: () => Promise<{ index: RedirectIndex; ok: boolean }>
  /** Bounds the memory held by an index nothing has invalidated. */
  ttlMs: number
  /** After a failed load, serve "no redirect" this long before trying again. */
  failureTtlMs: number
  onGenerationError?: (error: unknown) => void
  now?: () => number
}

/**
 * Per-isolate redirect index that follows a shared generation. Every lookup reads the
 * generation first (one small R2 read) and serves the cached index only while it matches, so
 * a redirect saved in any isolate applies on the next request everywhere. The generation is
 * read BEFORE loading and stored with the result, so a save racing the load leaves the entry
 * stale instead of masking the save. The TTL only bounds memory. When the generation can't
 * be read, the request falls back to the cached index (or a load) instead of failing.
 */
export const createRedirectIndexCache = (options: RedirectIndexCacheOptions) => {
  const now = options.now ?? Date.now
  let cache: CacheEntry | undefined
  let inflight: { gen: string | undefined; promise: Promise<CacheEntry> } | undefined

  const reload = (gen: string | undefined) => {
    // Concurrent misses on the same generation share one read.
    if (inflight && inflight.gen === gen) return inflight.promise

    const promise = options
      .load()
      .then(({ index, ok }): CacheEntry => ({
        gen,
        expiresAt: now() + (ok ? options.ttlMs : options.failureTtlMs),
        index,
      }))
      .finally(() => {
        if (inflight?.promise === promise) inflight = undefined
      })

    inflight = { gen, promise }

    return promise
  }

  return async (): Promise<RedirectIndex> => {
    let gen: string | undefined

    try {
      gen = await options.readGeneration()
    } catch (error) {
      options.onGenerationError?.(error)
      // Without the marker we can't tell if the index is current: keep serving what we have
      // until its TTL, then reload from D1.
      if (cache && cache.expiresAt > now()) return cache.index
    }

    if (gen !== undefined && cache && cache.gen === gen && cache.expiresAt > now())
      return cache.index

    cache = await reload(gen)

    return cache.index
  }
}
