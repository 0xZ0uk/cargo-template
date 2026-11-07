import type { PayloadRequest } from 'payload'

import type { SanitizedOAuthConfig } from './config.js'

import { OAUTH_ENDPOINT_PATHS } from '../exports/wellKnown.js'

/**
 * Names and discovery documents of the OAuth server. The site is both the authorization server
 * (issuer = its origin) and the only protected resource, `<origin><api>/mcp`; every token is bound
 * to that resource.
 */

/** Prefixes tell an OAuth token from a Payload API key or JWT in `Authorization: Bearer`. */
export const ACCESS_TOKEN_PREFIX = 'pmcp_at_'
export const REFRESH_TOKEN_PREFIX = 'pmcp_rt_'

/** `req.user._strategy` of a request authenticated with an OAuth access token. */
export const OAUTH_STRATEGY = 'mcp-oauth'

/** The public origin: the configured one, else the request's. */
export const getOrigin = (req: PayloadRequest, oauth: SanitizedOAuthConfig): string =>
  oauth.serverURL ||
  req.payload.config.serverURL?.replace(/\/+$/, '') ||
  new URL(req.url ?? 'http://localhost').origin

const api = (req: PayloadRequest) => req.payload.config.routes.api

/** Absolute URL of one of the OAuth endpoints. */
export const oauthURL = (
  req: PayloadRequest,
  origin: string,
  endpoint: keyof typeof OAUTH_ENDPOINT_PATHS,
): string => `${origin}${api(req)}${OAUTH_ENDPOINT_PATHS[endpoint]}`

/** The protected resource, and the only audience a token may have. */
export const mcpResource = (req: PayloadRequest, origin: string): string =>
  `${origin}${api(req)}/mcp`

/** Where the 401 challenge points (RFC 9728 §3.1, path-suffixed with the resource's path). */
export const protectedResourceMetadataURL = (req: PayloadRequest, origin: string): string =>
  `${origin}/.well-known/oauth-protected-resource${api(req)}/mcp`

/** RFC 9728 protected resource metadata. */
export const protectedResourceMetadata = (req: PayloadRequest, origin: string, name: string) => ({
  authorization_servers: [origin],
  bearer_methods_supported: ['header'],
  resource: mcpResource(req, origin),
  resource_name: name,
})

/** RFC 8414 authorization server metadata: only what is implemented. */
export const authorizationServerMetadata = (req: PayloadRequest, origin: string) => ({
  authorization_endpoint: oauthURL(req, origin, 'authorize'),
  code_challenge_methods_supported: ['S256'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  issuer: origin,
  registration_endpoint: oauthURL(req, origin, 'register'),
  response_types_supported: ['code'],
  token_endpoint: oauthURL(req, origin, 'token'),
  // Public clients only: PKCE instead of a client secret.
  token_endpoint_auth_methods_supported: ['none'],
})

/** The `WWW-Authenticate` challenge of a 401 from the MCP endpoint (RFC 9728 §5.1, RFC 6750 §3). */
export const bearerChallenge = (
  req: PayloadRequest,
  origin: string,
  error?: 'invalid_token',
): string =>
  `Bearer ${[
    ...(error ? [`error="${error}"`] : []),
    `resource_metadata="${protectedResourceMetadataURL(req, origin)}"`,
  ].join(', ')}`

/**
 * Public, credential-less endpoints (discovery, registration, token) answer any origin, so browser
 * clients such as the MCP Inspector can use them. No cookies are involved, so this grants nothing.
 */
export const PUBLIC_CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'Content-Type, MCP-Protocol-Version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Max-Age': '86400',
} as const
