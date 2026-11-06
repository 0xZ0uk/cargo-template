/**
 * A cached manifest entry: the variants for a key, or `null` when the key runs no experiment
 * (a negative entry, so pages without experiments skip the database too).
 */
export type ManifestCacheValue<TVariantData extends object = object> = TVariantData[] | null;

/**
 * Read cache in front of a storage adapter. Implementations store plain values only: on
 * Cloudflare Workers a promise belongs to the request that created it, so never cache an
 * in-flight read.
 */
export interface ManifestCache<TVariantData extends object = object> {
  /** The cached value, `null` for a cached "no experiment", or `undefined` on a miss. */
  get(
    key: string
  ):
    | ManifestCacheValue<TVariantData>
    | undefined
    | Promise<ManifestCacheValue<TVariantData> | undefined>;
  /** Stores a value for `ttlSeconds`. */
  set(key: string, value: ManifestCacheValue<TVariantData>, ttlSeconds: number): void | Promise<void>;
  delete(key: string): void | Promise<void>;
}

export interface ManifestCacheOptions<TVariantData extends object = object> {
  cache: ManifestCache<TVariantData>;
  /**
   * Seconds an entry lives. Bounds how long a cache that missed a write (another isolate or
   * colo) can keep serving the old variants. Default: 30
   */
  ttl?: number;
}
