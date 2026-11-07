import type { PayloadRequest, User } from 'payload'

import { UnauthorizedError } from 'payload'

import type { SanitizedOAuthConfig } from './config.js'

import {
  ACCESS_TOKEN_PREFIX,
  bearerChallenge,
  getOrigin,
  mcpResource,
  OAUTH_STRATEGY,
} from './metadata.js'
import { authenticateAccessToken } from './store.js'

/**
 * The MCP endpoint's side of OAuth. `Authorization: Bearer pmcp_at_…` is only ever tried as an
 * OAuth access token; anything else (an API key, the admin's cookie, a login JWT) goes to Payload's
 * own authentication as before.
 */

/** The OAuth access token of the request, or null when it carries none. */
export const readAccessToken = (req: PayloadRequest): null | string => {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get('Authorization') ?? '')
  return match?.[1]?.startsWith(ACCESS_TOKEN_PREFIX) ? match[1] : null
}

/**
 * A 401 that sends OAuth clients to the discovery document (`WWW-Authenticate`, RFC 9728 §5.1).
 * Payload's error response merges `req.responseHeaders` into the 401.
 */
export const oauthUnauthorized = (
  req: PayloadRequest,
  oauth: SanitizedOAuthConfig,
  error?: 'invalid_token',
): UnauthorizedError => {
  req.responseHeaders = new Headers({
    'WWW-Authenticate': bearerChallenge(req, getOrigin(req, oauth), error),
  })
  return new UnauthorizedError(req.t)
}

/**
 * Authenticates an OAuth access token and sets `req.user` to its user, with `_strategy:
 * 'mcp-oauth'`. Throws a 401 with the challenge when the token is unknown, expired, revoked, bound
 * to another resource, or its user may no longer connect.
 */
export const authenticateOAuthRequest = async (
  req: PayloadRequest,
  oauth: SanitizedOAuthConfig,
  token: string,
): Promise<User> => {
  const user = await authenticateAccessToken(req, oauth, token, mcpResource(req, getOrigin(req, oauth)))
  if (!user) {
    throw oauthUnauthorized(req, oauth, 'invalid_token')
  }
  req.user = { ...user, _strategy: OAUTH_STRATEGY } as PayloadRequest['user']
  return user
}
