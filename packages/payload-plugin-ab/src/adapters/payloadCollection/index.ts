import type { CollectionSlug } from "payload";
import type { StorageAdapter } from "../../types/config";
import type { PayloadCollectionAdapterConfig } from "./config";
import { fetchEntry, findEntry } from "./api/entries";
import { createCollection } from "./utils/createCollection";
import { withManifestCache } from "../../cache/withManifestCache";

export type { PayloadCollectionAdapterConfig } from "./config";
export type { ManifestCache, ManifestCacheOptions, ManifestCacheValue } from "../../cache/types";
export { withManifestCache, DEFAULT_MANIFEST_CACHE_TTL } from "../../cache/withManifestCache";
export { createMemoryManifestCache } from "../../cache/memoryManifestCache";
export type { MemoryManifestCacheOptions } from "../../cache/memoryManifestCache";

export const DEFAULT_MANIFEST_COLLECTION_SLUG = "ab-manifest";

/**
 * Stores the manifest in a hidden collection, one row per manifest key. A write touches only
 * its key's row, so publishes of different pages never overwrite each other.
 */
export function payloadCollectionAdapter<TVariantData extends object>(
  config: PayloadCollectionAdapterConfig<TVariantData> = {}
): StorageAdapter<TVariantData> {
  const slug = config.collectionSlug ?? DEFAULT_MANIFEST_COLLECTION_SLUG;
  const collection = slug as CollectionSlug;

  const adapter: StorageAdapter<TVariantData> = {
    async write(path, variants, payload) {
      const update = (id: number | string) =>
        payload.update({
          collection,
          id,
          data: { variants } as never,
          depth: 0,
          overrideAccess: true,
        });

      const existing = await findEntry<TVariantData>(payload, slug, path);
      if (existing) {
        // Drafts can recompute on every autosave; don't rewrite an unchanged row.
        if (JSON.stringify(existing.variants ?? null) === JSON.stringify(variants)) return;
        await update(existing.id);
        return;
      }

      try {
        await payload.create({
          collection,
          data: { key: path, variants } as never,
          depth: 0,
          overrideAccess: true,
        });
      } catch (error) {
        // Another write created the row first (unique key): update it instead, once.
        const raced = await findEntry<TVariantData>(payload, slug, path);
        if (!raced) throw error;
        await update(raced.id);
      }
    },

    async read(path, payload) {
      // Same process as Payload (e.g. a loader on the Worker): read through the Local API. A
      // Worker fetching its own REST API is a needless subrequest, and a loop on some routes.
      if (payload) {
        const entry = await findEntry<TVariantData>(payload, slug, path);
        return entry?.variants ?? null;
      }

      // The collection isn't public: without credentials there's nothing to read.
      if (!config.authorization) return null;

      const url = `${config.serverURL ?? ""}${config.apiRoute ?? "/api"}/${slug}`;
      return fetchEntry<TVariantData>(url, config.authorization, path);
    },

    async clear(path, payload) {
      await payload.delete({
        collection,
        where: { key: { equals: path } },
        depth: 0,
        overrideAccess: true,
      });
    },

    createCollection(debug = false) {
      return createCollection(slug, debug);
    },
  };

  return config.cache
    ? withManifestCache(adapter, { cache: config.cache, ttl: config.cacheTtl })
    : adapter;
}
