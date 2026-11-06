import type { StorageAdapter } from "../types/config";
import type { ManifestCacheOptions } from "./types";

export const DEFAULT_MANIFEST_CACHE_TTL = 30;

/** Cache failures must never break routing or publishing: fall back to storage. */
async function attempt<T>(fn: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

/**
 * Wraps a storage adapter with a read cache: reads are cache-first (including "no experiment"
 * entries), writes and clears update the cache after storage succeeds, and a failed write
 * drops the entry. Other caches (other isolates or colos) see a write once their entry
 * expires, so `ttl` bounds how stale routing can be.
 */
export function withManifestCache<TVariantData extends object>(
  storage: StorageAdapter<TVariantData>,
  { cache, ttl = DEFAULT_MANIFEST_CACHE_TTL }: ManifestCacheOptions<TVariantData>
): StorageAdapter<TVariantData> {
  // Bumped on every write or clear, so a read that started before one doesn't cache the old
  // value after it. Plain numbers: nothing request-bound outlives the request.
  const generations = new Map<string, number>();
  const bump = (key: string) => generations.set(key, (generations.get(key) ?? 0) + 1);

  return {
    ...storage,

    async read(path, payload) {
      const generation = generations.get(path);
      const cached = await attempt(() => cache.get(path));
      if (cached !== undefined) return cached;

      const value = await storage.read(path, payload);
      if (generations.get(path) === generation) {
        await attempt(() => cache.set(path, value, ttl));
      }
      return value;
    },

    async write(path, variants, payload) {
      bump(path);
      try {
        await storage.write(path, variants, payload);
      } catch (error) {
        await attempt(() => cache.delete(path));
        throw error;
      }
      // Again once storage is done: a read that began during the write may hold the old value.
      bump(path);
      await attempt(() => cache.set(path, variants, ttl));
    },

    async clear(path, payload) {
      bump(path);
      try {
        await storage.clear(path, payload);
      } catch (error) {
        await attempt(() => cache.delete(path));
        throw error;
      }
      bump(path);
      await attempt(() => cache.set(path, null, ttl));
    },
  };
}
