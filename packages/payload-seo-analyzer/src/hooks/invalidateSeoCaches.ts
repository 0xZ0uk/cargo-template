/**
 * Cache invalidation hooks.
 *
 * Attached by the plugin to the target collections/globals (content caches), the
 * redirects collection (redirect-derived caches) and `seo-settings` (everything that
 * depends on scoring settings). Independent of score history: invalidation used to live
 * inside the score-tracking hook, so with `features.scoreHistory: false` nothing was ever
 * invalidated and the dashboard served stale scores until the TTL expired.
 *
 * With a `cacheStore`, invalidating a persistent base bumps its generation in the store,
 * which every isolate reads. The bump is awaited (a couple of small writes) so the next
 * dashboard request is guaranteed to see it; a store failure is logged, never fails the save.
 */

import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  GlobalAfterChangeHook,
  PayloadRequest,
} from 'payload'
import { defaultSeoSharedCache, type SeoSharedCache } from '../cache.js'

const CONTEXT_KEY = 'seoAnalyzerInvalidatedBases'

/**
 * Invalidate `bases`, at most once per base per request (a bulk operation saving 50
 * documents would otherwise write 50 generations per base).
 */
export async function invalidateForRequest(
  cache: SeoSharedCache,
  req: Pick<PayloadRequest, 'context' | 'payload'> | undefined,
  bases: readonly string[],
): Promise<void> {
  let pending = bases
  const ctx = req?.context as Record<string, unknown> | undefined
  if (ctx) {
    const done = (ctx[CONTEXT_KEY] as Set<string> | undefined) ?? new Set<string>()
    ctx[CONTEXT_KEY] = done
    pending = bases.filter((b) => !done.has(b))
    for (const b of pending) done.add(b)
  }
  if (pending.length === 0) return
  try {
    await cache.invalidate(pending)
  } catch (e) {
    req?.payload?.logger?.error(
      `[seo] cache invalidation failed: ${e instanceof Error ? e.message : 'unknown'}`,
    )
  }
}

export function createInvalidateCachesHook(
  bases: readonly string[],
  cache: SeoSharedCache = defaultSeoSharedCache,
): CollectionAfterChangeHook & CollectionAfterDeleteHook & GlobalAfterChangeHook {
  // One function satisfies afterChange (collection + global) and afterDelete: all three
  // receive `{ doc, req }` and expect the doc back (afterDelete ignores the return value).
  return (async ({ doc, req }: { doc: unknown; req: PayloadRequest }) => {
    await invalidateForRequest(cache, req, bases)
    return doc
  }) as CollectionAfterChangeHook & CollectionAfterDeleteHook & GlobalAfterChangeHook
}
