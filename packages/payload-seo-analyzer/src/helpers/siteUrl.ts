/**
 * Public site URL, resolved in one place.
 *
 * Order: the plugin's `siteUrl` option, then the `SITE_URL` environment
 * variable, then `fallback` (whatever the caller can derive, e.g. a dev default),
 * then `''`. Trailing slashes are stripped, so callers append `/path` directly.
 *
 * No framework-specific variables (`NEXT_PUBLIC_SERVER_URL` and friends) are read:
 * the host declares `SITE_URL` in its own env schema.
 *
 * Do not pass a value derived from the request (`Host`, `req.origin`) as the
 * fallback where the URL gates an outgoing fetch (SSRF allowlists): a client
 * controls it.
 */

function readSiteUrlEnv(): string | undefined {
  // `process` can be absent in some runtimes; the helpers here also run in the host's frontend.
  return typeof process !== 'undefined' ? process.env?.SITE_URL : undefined
}

function clean(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '')
}

export function resolveSiteUrl(configured?: string, fallback?: string): string {
  return clean(configured) || clean(readSiteUrlEnv()) || clean(fallback)
}
