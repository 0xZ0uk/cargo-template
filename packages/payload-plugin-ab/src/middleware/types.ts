import type { Payload } from "payload";
import type { StorageAdapter } from "../types/config";
import type { AbCookieConfig } from "../cookie/types";

export interface ResolveAbRewriteCookieConfig extends AbCookieConfig {
  /**
   * Prefix for the per-path bucket-assignment cookie.
   * Full name: `{prefix}_{manifestKey without the leading slash, "/" → "_"}`.
   * Default: 'payload_ab_bucket'.
   */
  bucketCookiePrefix?: string;
  /** Max age for the visitor ID cookie in seconds. Default: 31_536_000 (365 days). */
  visitorIdMaxAge?: number;
  /** Max age for the experiment bucket cookie in seconds. Default: 7_776_000 (90 days). */
  expCookieMaxAge?: number;
  /** Max age for the bucket-assignment cookie in seconds. Default: `expCookieMaxAge`. */
  bucketCookieMaxAge?: number;
}

export interface ResolveAbRewriteConfig<TVariantData extends object = object> {
  /** Storage adapter instance — must be the same one passed to the plugin. */
  storage: StorageAdapter<TVariantData>;
  /**
   * Extract the bucket string from a variant record.
   * The shape of TVariantData is whatever your `generateVariantData` returns,
   * so you decide which field holds the bucket identifier.
   */
  getBucket: (variant: TVariantData) => string;
  /**
   * Extract the path to serve for a variant record (the variant page's own path).
   * Again, the field name is whatever you put in `generateVariantData`.
   */
  getRewritePath: (variant: TVariantData) => string;
  /**
   * Extract the traffic percentage (0–100) for a variant.
   * When provided, variants are selected by weight and the remaining
   * percentage (100 − sum of all variant weights) is assigned to 'original'.
   * When omitted, all variants and 'original' share equal probability.
   */
  getPassPercentage?: (variant: TVariantData) => number;
  /** Cookie names and TTLs — all have sensible defaults. */
  cookies?: ResolveAbRewriteCookieConfig;
}

/** A cookie the host must set on its response. */
export interface AbCookie {
  name: string;
  value: string;
  options: {
    path: "/";
    sameSite: "lax";
    /** Seconds. */
    maxAge: number;
    /** Hide it from page scripts. The resolver's own cookies leave it off (`ExperimentTracker` reads them). */
    httpOnly?: boolean;
  };
}

export interface AbRewrite<TVariantData extends object = object> {
  /** 'original' or the variant's bucket. */
  bucket: string;
  /** The path to render: the variant's rewrite path, or `originalRewritePath`. */
  pathname: string;
  /** The manifest entry served, or null for the original. */
  variant: TVariantData | null;
  /**
   * The visitor's id: from the visitor-id cookie, or a new one (then also in `cookies`).
   * Pseudonymous but persistent; keep it out of analytics stores that must hold no PII.
   */
  visitorId: string;
  /**
   * Cookies to set on the response (assignment, visitor id, analytics experiment cookie).
   * Empty for a returning visitor whose cookies already say everything.
   */
  cookies: AbCookie[];
  /** `cookies` serialized as `Set-Cookie` header values. */
  setCookieHeaders: string[];
}

export interface ResolveAbRewriteOptions {
  /**
   * The Payload instance, when the resolver runs in the same process (a loader or server
   * function on the Worker). Passed to `storage.read` so it skips the HTTP round trip.
   */
  payload?: Payload;
}
