import type {
  AbCookie,
  AbRewrite,
  ResolveAbRewriteConfig,
  ResolveAbRewriteOptions,
} from "./types";
import { pickWeightedBucket } from "./utils/pickWeightedBucket";
import { pickUniformBucket } from "./utils/pickUniformBucket";
import { parseCookieHeader, serializeAbCookie } from "./utils/cookies";
import { DEFAULT_VISITOR_ID_COOKIE_NAME } from "../cookie/constants";
import { defaultGetExpCookieName } from "../cookie/utils/defaultGetExpCookieName";
import {
  DEFAULT_BUCKET_COOKIE_PREFIX,
  bucketCookieName as buildBucketCookieName,
} from "../cookie/utils/bucketCookieName";
const DEFAULT_VISITOR_MAX_AGE = 60 * 60 * 24 * 365;
const DEFAULT_EXP_MAX_AGE = 60 * 60 * 24 * 90;

/**
 * Builds the per-request A/B resolver. Framework-agnostic: it takes a Web `Request` (or its
 * `Cookie` header) and returns which path to render plus the cookies to set, and leaves the
 * rewrite to the host. In TanStack Start, call it from the page loader's server function and
 * load the returned path's document; in any middleware with real rewrites, rewrite to
 * `pathname`.
 */
export function createResolveAbRewrite<TVariantData extends object>(
  config: ResolveAbRewriteConfig<TVariantData>
) {
  const {
    storage,
    getBucket,
    getRewritePath,
    getPassPercentage,
    cookies: cookieConfig = {},
  } = config;

  const {
    bucketCookiePrefix = DEFAULT_BUCKET_COOKIE_PREFIX,
    visitorIdCookieName = DEFAULT_VISITOR_ID_COOKIE_NAME,
    getExpCookieName = defaultGetExpCookieName,
    visitorIdMaxAge = DEFAULT_VISITOR_MAX_AGE,
    expCookieMaxAge = DEFAULT_EXP_MAX_AGE,
    bucketCookieMaxAge = expCookieMaxAge,
  } = cookieConfig;

  /**
   * Resolves the bucket for one page view. Returns null only when the page runs no experiment
   * (or the manifest can't be read): render the page as requested. A visitor already in the
   * original bucket gets an answer too, with no cookies to set, so the host can count the view.
   */
  return async function resolveAbRewrite(
    /** The incoming request, or its `Cookie` header value. */
    request: Request | string | null | undefined,
    /** The URL pathname visible to the user. Kept for API parity; the cookies key on `manifestKey`. */
    _visiblePathname: string,
    /** The manifest key to look up — the path the plugin's `generatePath` returns. */
    manifestKey: string,
    /** Path to render when the visitor is in the 'original' bucket. */
    originalRewritePath: string,
    options: ResolveAbRewriteOptions = {}
  ): Promise<AbRewrite<TVariantData> | null> {
    let variants: TVariantData[] | null = null;

    try {
      variants = await storage.read(manifestKey, options.payload);
    } catch {
      return null;
    }

    if (!variants?.length) return null;

    const requestCookies = parseCookieHeader(
      typeof request === "string" ? request : (request?.headers.get("cookie") ?? null)
    );

    const bucketCookieName = buildBucketCookieName(manifestKey, bucketCookiePrefix);
    const existingBucket = requestCookies.get(bucketCookieName);

    const existingVisitorId = requestCookies.get(visitorIdCookieName);
    const visitorId = existingVisitorId ?? crypto.randomUUID();

    const expCookieName = getExpCookieName(manifestKey);

    const isLiveBucket = (value: string | undefined): value is string =>
      value === "original" || variants.some((v) => getBucket(v) === value);

    const savedBucket = [existingBucket, requestCookies.get(expCookieName)].find(isLiveBucket);
    const bucket =
      savedBucket ??
      (getPassPercentage
        ? pickWeightedBucket(variants, getBucket, getPassPercentage)
        : pickUniformBucket(variants, getBucket));

    const match = variants.find((v) => getBucket(v) === bucket) ?? null;
    const cookies: AbCookie[] = [];
    const set = (name: string, value: string, maxAge: number) =>
      cookies.push({ name, value, options: { path: "/", sameSite: "lax", maxAge } });

    if (existingBucket !== bucket) set(bucketCookieName, bucket, bucketCookieMaxAge);
    if (!existingVisitorId) set(visitorIdCookieName, visitorId, visitorIdMaxAge);
    if (!savedBucket) set(expCookieName, bucket, expCookieMaxAge);

    return {
      bucket,
      pathname: match ? getRewritePath(match) : originalRewritePath,
      variant: match,
      visitorId,
      cookies,
      setCookieHeaders: cookies.map(serializeAbCookie),
    };
  };
}
