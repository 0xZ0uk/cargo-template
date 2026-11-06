import {
  createMemoryManifestCache,
  payloadCollectionAdapter,
  type ManifestCache,
  type ManifestCacheValue,
} from '@cargo/payload-plugin-ab/adapters/payload-collection'
import { createResolveAbRewrite, type AbRewrite } from '@cargo/payload-plugin-ab/middleware'
import type { Payload } from 'payload'

/** What the manifest stores per variant (the plugin's default `generateVariantData`). */
export type AbVariant = { bucket: string; rewritePath: string; passPercentage: number }

/** Seconds a cached manifest entry lives: the longest a colo that missed a change keeps routing the old way. */
const CACHE_TTL = 30

/**
 * Read cache for the A/B manifest, so a page view doesn't read D1 to learn whether its page
 * runs an experiment.
 *
 * On Workers it's the Cache API (`caches.default`), under synthetic URLs that no request can
 * reach. Its entries are per colo (data centre): a publish updates the entry in the colo that
 * handled it, and every other colo keeps its cached value until the TTL runs out, so a change
 * (a new variant, a new percentage, an unpublished or deleted variant) takes up to `CACHE_TTL`
 * seconds to reach every visitor. On a `*.workers.dev` hostname the Cache API stores nothing,
 * so every read goes to D1; that's still correct, just uncached.
 *
 * Where `caches` doesn't exist (the Node dev server, vitest) it falls back to an in-memory
 * cache in the process. Both hold plain values only: on Workers a promise belongs to the
 * request that created it, so an in-flight read is never shared across requests.
 */
export function workersManifestCache<T extends object>(): ManifestCache<T> {
  const memory = createMemoryManifestCache<T>()
  const workersCache = (): Cache | null =>
    typeof caches !== 'undefined' && 'default' in caches
      ? (caches as unknown as { default: Cache }).default
      : null
  const url = (key: string) => `https://ab-manifest.internal/${encodeURIComponent(key)}`

  return {
    async get(key) {
      const cache = workersCache()
      if (!cache) return memory.get(key)
      const res = await cache.match(url(key))
      if (!res) return undefined
      return ((await res.json()) as { value: ManifestCacheValue<T> }).value
    },
    async set(key, value, ttlSeconds) {
      const cache = workersCache()
      if (!cache) return memory.set(key, value, ttlSeconds)
      await cache.put(
        url(key),
        new Response(JSON.stringify({ value }), {
          headers: {
            'Cache-Control': `max-age=${Math.max(1, Math.round(ttlSeconds))}`,
            'Content-Type': 'application/json',
          },
        }),
      )
    },
    async delete(key) {
      const cache = workersCache()
      if (!cache) return memory.delete(key)
      await cache.delete(url(key))
    },
  }
}

/**
 * The manifest storage, shared by the plugin (payload.config.ts writes through it on publish)
 * and the page loader (reads through it). One instance, so both use the same cache.
 */
export const abStorage = payloadCollectionAdapter<AbVariant>({
  cache: workersManifestCache<AbVariant>(),
  cacheTtl: CACHE_TTL,
})

export type AbRouting = {
  /**
   * The response may depend on the visitor's bucket (the page runs an experiment, or the
   * manifest couldn't be read), so no shared cache may store it.
   */
  varies: boolean
  /**
   * The resolver's answer: the bucket, the variant to render (null for the original) and the
   * cookies to set. Null when the page runs no experiment: render the page as requested.
   */
  ab: AbRewrite<AbVariant> | null
}

const resolverFor = (variants: AbVariant[]) =>
  createResolveAbRewrite<AbVariant>({
    // The variants are already read: the resolver reads them back from here.
    storage: {
      read: async () => variants,
      write: async () => {},
      clear: async () => {},
    },
    getBucket: (v) => v.bucket,
    getRewritePath: (v) => v.rewritePath,
    getPassPercentage: (v) => v.passPercentage,
  })

/**
 * Routes a page view. `key` is the page's path (`pagePath(slug)`), the manifest key the
 * plugin's `generatePath` writes.
 *
 * The manifest is read here once, `varies` reports whether the page has variants, and the
 * resolver runs on those variants. A failed read routes nobody (the page renders as
 * requested), as the resolver itself does, but still counts as `varies`: the next request may
 * well be routed. (`varies` comes from the manifest rather than from `ab`, which is also null
 * when the manifest can't be read.)
 *
 * A routed view also counts as an impression (Workers Analytics Engine, once per visitor and
 * bucket; see `recordImpression`). Its marker cookie joins `ab.setCookieHeaders`.
 */
export async function routeAb(
  cookieHeader: string | undefined,
  key: string,
  payload: Payload,
): Promise<AbRouting> {
  let variants: AbVariant[] | null = null
  try {
    variants = await abStorage.read(key, payload)
  } catch {
    return { varies: true, ab: null }
  }
  if (!variants?.length) return { varies: false, ab: null }
  const ab = await resolverFor(variants)(cookieHeader, key, key, key)
  if (!ab) return { varies: true, ab }

  const { cloudflareEnv } = await import('#cloudflare-runtime')
  const { recordImpression } = await import('./abMeasurement')
  const marker = recordImpression(
    cloudflareEnv.AB_ANALYTICS as AnalyticsEngineDataset | undefined,
    cookieHeader,
    key,
    ab,
  )
  return {
    varies: true,
    ab: marker ? { ...ab, setCookieHeaders: [...ab.setCookieHeaders, marker] } : ab,
  }
}
