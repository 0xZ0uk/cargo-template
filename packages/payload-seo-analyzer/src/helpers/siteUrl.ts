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

/**
 * Origin of the incoming request (`https://example.com`), or undefined when the
 * request has no parseable URL. Only for URLs the plugin prints (robots.txt,
 * sitemap.xml, llms.txt) when no site URL is configured: never as an SSRF
 * allowlist, since the client controls the Host header.
 */
export function requestOrigin(req: { url?: string | null }): string | undefined {
  if (!req.url) return undefined
  try {
    return new URL(req.url).origin
  } catch {
    return undefined
  }
}
