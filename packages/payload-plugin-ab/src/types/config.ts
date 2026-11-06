import type { CollectionConfig, GlobalConfig, Payload } from "payload";

export interface StorageAdapter<TVariantData extends object = object> {
  /**
   * Stores the variants for one manifest key, without touching other keys. Called on every
   * recompute, including draft autosaves with nothing new: skip the write when the stored
   * value is already `variants`.
   */
  write(path: string, variants: TVariantData[], payload: Payload): Promise<void>;
  /**
   * Reads the variants for one manifest key. Called on every routed request, so it must be
   * cheap. `payload` is passed when the resolver runs in the same process as Payload (a
   * TanStack Start loader or server function on the Worker); adapters should then read
   * through it instead of over HTTP.
   */
  read(path: string, payload?: Payload): Promise<TVariantData[] | null>;
  clear(path: string, payload: Payload): Promise<void>;
  /** A global the adapter stores into, added to the config by the plugin. */
  createGlobal?(debug: boolean): GlobalConfig;
  /** A collection the adapter stores into, added to the config by the plugin. */
  createCollection?(debug: boolean): CollectionConfig;
}

export interface CollectionABConfig<TVariantData extends object = object> {
  /**
   * Dot-notation path to the slug field on the document.
   * Used to generate the cloned variant's slug: `{slug}--{nanoid}`.
   * Default: 'slug'
   */
  slugField?: string;
  /**
   * Optional dot-notation path to the tenant field on the document.
   * When set, the field is hidden on variant documents to prevent mismatches.
   */
  tenantField?: string;
  /**
   * Optional dot-notation path to a human-readable title field on the document,
   * used as the variant display name in analytics surfaces. Falls back to the
   * variant slug when unset or empty.
   */
  nameField?: string;
  /**
   * Maps a document to the URL path used as the manifest key.
   * Return null to skip writing the manifest for that document.
   * Called once per locale when localization is enabled.
   */
  generatePath: (args: {
    doc: Record<string, unknown>;
    locale: string | undefined;
  }) => string | null;
  /**
   * Builds the data stored per variant in the manifest.
   * When omitted, auto-generates: { bucket: variantSlug, rewritePath: generatePath(variantDoc), passPercentage: _abPassPercentage }
   */
  generateVariantData?: (args: {
    doc: Record<string, unknown>;
    variantDoc: Record<string, unknown>;
    locale: string | undefined;
  }) => TVariantData;
}

export interface AbTestingPluginConfig<TVariantData extends object = object> {
  /** Default: true */
  enabled?: boolean;
  /** If true, the adapter's manifest storage and the experiments collection show in the admin panel. Default: false */
  debug?: boolean;
  /** Map of parent collection slug => A/B config for that collection. */
  collections: Record<string, CollectionABConfig<TVariantData>>;
  /** Storage adapter instance. */
  storage: StorageAdapter<TVariantData>;
  /**
   * Slug for the auto-injected lifecycle collection that records each
   * experiment's `startedAt`. Default: 'ab-experiments'. Must match the
   * analytics plugin's `ab.experimentsCollectionSlug` if overridden.
   */
  experimentsCollectionSlug?: string;
}
