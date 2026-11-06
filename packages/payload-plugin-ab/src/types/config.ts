import type { CollectionConfig, GlobalConfig, Payload, PayloadRequest } from "payload";

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

/** One conversion, as `POST /api/_ab/convert` hands it to `recordConversion`. */
export interface AbConversionEvent {
  /** The manifest key (the original page's path). */
  experiment: string;
  /** 'original' or a variant's bucket, read from the visitor's bucket cookie. */
  bucket: string;
  /** One of `measurement.goals`. */
  goal: string;
  /**
   * From the visitor-id cookie. Pseudonymous but persistent: don't write it to a store that
   * must hold no PII.
   */
  visitorId: string;
}

/** Counts for one bucket since the experiment started. */
export interface AbBucketResult {
  bucket: string;
  impressions: number;
  conversions: number;
}

export type AbResults =
  /** The host can't read results (e.g. no analytics credentials). `reason` is shown to editors. */
  | { configured: false; reason?: string }
  | {
      configured: true;
      buckets: AbBucketResult[];
      /** How many days the analytics store keeps events; older ones no longer count. */
      retentionDays?: number;
    };

export interface AbMeasurementCookieConfig {
  /** Must match the resolver's. Default: 'payload_ab_bucket'. */
  bucketCookiePrefix?: string;
  /** Must match the resolver's. Default: 'ab_visitor_id'. */
  visitorIdCookieName?: string;
  /**
   * Prefix for the cookie that marks a visitor as converted for one experiment and bucket, so
   * repeat clicks count once. Full name built like the bucket cookie's. Default: 'payload_ab_cv'.
   */
  conversionCookiePrefix?: string;
  /** Seconds. Default: 7_776_000 (90 days, the bucket cookie's default). */
  conversionCookieMaxAge?: number;
}

/**
 * Measurement: where conversions go and where results come from. The plugin owns the
 * endpoints, their checks and the admin panel; the host owns the analytics store.
 */
export interface AbMeasurementConfig<TVariantData extends object = object> {
  /** Goal names `POST /api/_ab/convert` accepts. Default: `['cta']`. */
  goals?: string[];
  /** The bucket of a manifest entry. Default: its `bucket` property (the default variant data). */
  getBucket?: (variant: TVariantData) => string;
  /**
   * Stores one conversion. Called once per visitor, experiment and bucket (a cookie marks
   * the visitor as converted), after the bucket was read from the visitor's own cookies and
   * checked against the live manifest.
   */
  recordConversion: (event: AbConversionEvent, req: PayloadRequest) => void | Promise<void>;
  /**
   * Reads the counts for one experiment since `startedAt`, for the Variants panel. Runs on
   * the server only: credentials it uses never reach the browser.
   */
  getResults: (args: {
    experiment: string;
    startedAt: string;
    req: PayloadRequest;
  }) => Promise<AbResults>;
  cookies?: AbMeasurementCookieConfig;
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
  /**
   * Turns on measurement: `POST /api/_ab/convert` (conversions), `GET /api/_ab/results`
   * (counts per bucket, admin-panel users only) and the results in the Variants panel.
   * Without it none of these exist.
   */
  measurement?: AbMeasurementConfig<TVariantData>;
}
