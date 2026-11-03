/**
 * URL of one of the plugin's endpoints, as the browser must request it.
 *
 * The endpoints are mounted by Payload at `${routes.api}${endpointBasePath}${path}`.
 * Both parts are configurable (Payload's `routes.api`, the plugin's
 * `endpointBasePath`), so the admin UI never hard-codes `/api/seo-plugin`: it
 * builds the URL here from what `useConfig()` and `admin.custom.seoAnalyzer`
 * forward (see hooks/useSeoApi.ts). Pure, so non-hook code and tests can use it.
 */

export const DEFAULT_API_ROUTE = '/api'
export const DEFAULT_ADMIN_ROUTE = '/admin'
export const DEFAULT_ENDPOINT_BASE_PATH = '/seo-plugin'

export interface SeoApiRoutes {
  /** Payload's `routes.api` (default `/api`). */
  apiRoute?: string
  /** The plugin's `endpointBasePath` (default `/seo-plugin`). */
  endpointBasePath?: string
}

/** `a/b/` → `/a/b`; `''` and `/` → `''`. */
function normalizePrefix(value: string | undefined, fallback: string): string {
  const raw = value ?? fallback
  const trimmed = raw.replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}` : ''
}

/**
 * `buildSeoApiUrl({}, '/audit?limit=5')` → `/api/seo-plugin/audit?limit=5`.
 * `path` may carry a query string; a missing leading slash is added.
 */
export function buildSeoApiUrl(routes: SeoApiRoutes | undefined, path: string): string {
  const api = normalizePrefix(routes?.apiRoute, DEFAULT_API_ROUTE)
  const base = normalizePrefix(routes?.endpointBasePath, DEFAULT_ENDPOINT_BASE_PATH)
  const tail = path.startsWith('/') ? path : `/${path}`
  return `${api}${base}${tail}`
}

/** Payload's `routes.api` for server code that builds absolute endpoint URLs. */
export function payloadApiRoute(payload: { config?: { routes?: { api?: string } } } | undefined): string {
  return payload?.config?.routes?.api ?? DEFAULT_API_ROUTE
}

/** URL of one of Payload's own REST routes: `buildPayloadApiUrl(undefined, '/pages/1')` → `/api/pages/1`. */
export function buildPayloadApiUrl(apiRoute: string | undefined, path: string): string {
  return `${normalizePrefix(apiRoute, DEFAULT_API_ROUTE)}${path.startsWith('/') ? path : `/${path}`}`
}
