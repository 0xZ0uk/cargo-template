import { encodeCookieNamePart } from "./encodeCookieNamePart";

export const DEFAULT_BUCKET_COOKIE_PREFIX = "payload_ab_bucket";

/**
 * The per-page bucket cookie: `{prefix}_{key without the leading slash, "/" → "_"}`, with the
 * key URI-encoded. Shared by the resolver (which sets it) and the conversion endpoint (which
 * reads it).
 */
export function bucketCookieName(manifestKey: string, prefix = DEFAULT_BUCKET_COOKIE_PREFIX): string {
  return `${prefix}_${encodeCookieNamePart(manifestKey.replace(/^\//, "").replace(/\//g, "_"))}`;
}
