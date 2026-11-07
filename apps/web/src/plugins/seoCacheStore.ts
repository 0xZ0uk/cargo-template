import type { SeoCacheStore } from '@shipment/payload-seo-analyzer'

/**
 * R2-backed `cacheStore` for the SEO analyzer. Workers isolates don't share memory, so
 * the dashboard audit, sitemap audit and redirect-chain results (and their invalidation
 * generations and build markers) live in R2, where every isolate sees the same state.
 *
 * Small JSON objects under `seo-analyzer/cache/`, overwritten in place. The key space is
 * bounded by locales and config hashes; keys left behind by a config change are expired by
 * the bucket's lifecycle rule on the prefix (`pnpm r2:lifecycle`, 7 days).
 * Under the Node dev server the binding is Wrangler's local proxy.
 */
export function r2SeoCacheStore(bucket: R2Bucket, prefix = 'seo-analyzer/cache/'): SeoCacheStore {
  return {
    async get(key) {
      const object = await bucket.get(prefix + key)
      return object ? object.text() : null
    },
    async put(key, value) {
      await bucket.put(prefix + key, value, {
        httpMetadata: { contentType: 'application/json' },
      })
    },
    async delete(key) {
      await bucket.delete(prefix + key)
    },
  }
}
