import type { ManifestCache, ManifestCacheValue } from "./types";

export interface MemoryManifestCacheOptions {
  /** Oldest entries are dropped past this size. Default: 1000 */
  maxEntries?: number;
  /** Clock in milliseconds, for tests. Default: Date.now */
  now?: () => number;
}

/**
 * Reference `ManifestCache` in a `Map`: per process (per isolate on Workers), so it only
 * sees writes made in the same process. Use it under Node, or as a model for a shared cache.
 */
export function createMemoryManifestCache<TVariantData extends object = object>(
  options: MemoryManifestCacheOptions = {}
): ManifestCache<TVariantData> {
  const { maxEntries = 1000, now = Date.now } = options;
  const entries = new Map<string, { value: ManifestCacheValue<TVariantData>; expiresAt: number }>();

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },

    set(key, value, ttlSeconds) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value as string;
        entries.delete(oldest);
      }
    },

    delete(key) {
      entries.delete(key);
    },
  };
}
