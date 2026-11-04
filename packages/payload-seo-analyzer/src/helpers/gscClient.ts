/**
 * Google Search Console — shared low-level client primitives.
 *
 * Single source of truth for the GSC OAuth config, token refresh (from the encrypted refresh
 * token at rest) and Search Analytics queries. Used by both the OAuth HTTP handlers
 * (`endpoints/gscOAuth.ts`) and the rank-tracking job (`endpoints/rankTracking.ts`) so the
 * security-sensitive token handling lives in exactly one place.
 */
import type { Payload } from 'payload'
import type { SeoConfig } from '../types.js'
import { decryptToken } from './tokenCrypto.js'
import { isSeoAdmin, isSeoAdminRequest } from './isAdmin.js'
import { requestOrigin, resolveSiteUrl } from './siteUrl.js'

export const GSC_AUTH_COLLECTION = 'seo-gsc-auth'
export const GSC_SCOPES = 'https://www.googleapis.com/auth/webmasters.readonly openid email'

/** Admin gate for GSC endpoints — delegates to the shared SEO admin gate. */
export const isGscAdmin = isSeoAdmin
/**
 * Request-level admin gate for GSC endpoints: also verifies the session comes
 * from the host's admin-panel collection (see helpers/isAdmin.ts).
 */
export const isGscAdminRequest = isSeoAdminRequest

export function resolveGscSiteUrl(seoConfig?: SeoConfig, req?: { url?: string | null }): string | undefined {
  return resolveSiteUrl(seoConfig?.siteUrl, req ? requestOrigin(req) : undefined) || undefined
}

export interface GscOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  siteUrl: string
}

/**
 * Site URL: the plugin's `siteUrl` option, then `SITE_URL`, then (when `req` is given) the
 * request's origin, so a host that sets neither still gets a working redirect URI. The
 * origin only ever feeds the OAuth redirect URI (Google rejects one that was not
 * registered) and the default GSC property; it never gates an outgoing fetch.
 * Callers without a request (scheduled jobs) need `siteUrl` / `SITE_URL`.
 *
 * `apiRoute` is Payload's `routes.api` (`payload.config.routes.api`); it defaults
 * to `/api` for callers that have no Payload instance at hand.
 */
export function getGscOAuthConfig(
  basePath: string,
  seoConfig?: SeoConfig,
  apiRoute: string = '/api',
  req?: { url?: string | null },
): GscOAuthConfig | null {
  const clientId = process.env.GSC_OAUTH_CLIENT_ID || ''
  const clientSecret = process.env.GSC_OAUTH_CLIENT_SECRET || ''
  const siteUrl = resolveGscSiteUrl(seoConfig, req)
  if (!clientId || !clientSecret || !siteUrl) return null
  return { clientId, clientSecret, siteUrl, redirectUri: `${siteUrl}${apiRoute}${basePath}/gsc/callback` }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getOrCreateGscAuthDoc(payload: Payload): Promise<any> {
  const found = await payload.find({ collection: GSC_AUTH_COLLECTION, limit: 1, overrideAccess: true })
  if (found.docs.length > 0) return found.docs[0]
  return payload.create({ collection: GSC_AUTH_COLLECTION, data: {}, overrideAccess: true })
}

/** Exchange an authorization code or refresh token for a fresh access token. */
export async function gscTokenRequest(
  cfg: GscOAuthConfig,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      ...body,
    }).toString(),
  })
  const json = (await resp.json()) as Record<string, unknown>
  if (!resp.ok) {
    throw new Error(`Token endpoint error: ${resp.status} ${(json.error as string) || ''}`)
  }
  return json
}

/**
 * Refresh and return a usable access token from the stored encrypted refresh token.
 * Throws a coded Error ('not_connected' | 'decrypt_failed' | 'refresh_failed') on problems.
 */
export async function getGscAccessToken(
  payload: Payload,
  cfg: GscOAuthConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authDoc: any,
): Promise<string> {
  if (!authDoc?.refreshTokenEnc) throw new Error('not_connected')
  const secret = (payload as unknown as { secret?: string }).secret || ''
  let refreshToken: string
  try {
    refreshToken = await decryptToken(authDoc.refreshTokenEnc as string, secret)
  } catch (cause) {
    // Keep the reason (wrong key, tampering, legacy format without node:crypto): never swallow it.
    const reason = cause instanceof Error ? cause.message : String(cause)
    payload.logger?.error?.(`[seo] gsc: could not decrypt the stored refresh token: ${reason}`)
    throw new Error('decrypt_failed', { cause })
  }
  const tokens = await gscTokenRequest(cfg, { refresh_token: refreshToken, grant_type: 'refresh_token' })
  const accessToken = tokens.access_token as string | undefined
  if (!accessToken) throw new Error('refresh_failed')
  return accessToken
}

export interface GscRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/** Query the Search Analytics API. Throws on a non-OK response. */
export async function queryGscSearchAnalytics(
  accessToken: string,
  property: string,
  body: { startDate: string; endDate: string; dimensions: string[]; rowLimit?: number },
): Promise<GscRow[]> {
  const resp = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const json = (await resp.json()) as Record<string, unknown>
  if (!resp.ok) {
    const err = (json.error as Record<string, unknown>)?.message || resp.status
    throw new Error(`GSC query failed: ${err}`)
  }
  return (json.rows as GscRow[]) || []
}
