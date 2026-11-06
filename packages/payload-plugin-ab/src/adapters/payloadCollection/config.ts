import type { ManifestCache } from "../../cache/types";

export interface PayloadCollectionAdapterConfig<TVariantData extends object = object> {
  /** Slug of the hidden collection holding one row per manifest key. Default: 'ab-manifest' */
  collectionSlug?: string;
  /**
   * Server URL used to read over REST when the resolver has no `payload` to read through (it
   * runs in another process). Example: 'https://example.com'
   */
  serverURL?: string;
  /** Payload API route prefix. Default: '/api' */
  apiRoute?: string;
  /**
   * `Authorization` header for the REST read, e.g. `users API-Key <key>` for a user with
   * API keys enabled. The collection is not publicly readable, so without it the REST read
   * returns no variants.
   */
  authorization?: string;
  /** Optional read cache. See `withManifestCache`. */
  cache?: ManifestCache<TVariantData>;
  /** Cache TTL in seconds. Default: 30 */
  cacheTtl?: number;
}
