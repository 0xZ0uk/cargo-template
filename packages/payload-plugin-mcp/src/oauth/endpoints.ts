import type { Endpoint, PayloadHandler, PayloadRequest, User } from 'payload'

import type { SanitizedOAuthConfig } from './config.js'
import type { OAuthClient, StoredToken } from './store.js'

import { OAUTH_ENDPOINT_PATHS } from '../exports/wellKnown.js'
import { CONTINUE_VIEW_PATH } from './config.js'
import { consentPage, errorPage, languageOf } from './consent.js'
import { pkceChallenge, sign, verify } from './crypto.js'
import {
  authorizationServerMetadata,
  getOrigin,
  mcpResource,
  protectedResourceMetadata,
  PUBLIC_CORS_HEADERS,
} from './metadata.js'
import {
  approve,
  claim,
  countPendingClients,
  findClient,
  findPresented,
  isExpired,
  issueTokens,
  markClientAuthorized,
  mayConnect,
  registerClient,
  revokeConnection,
  sweep,
} from './store.js'

/**
 * The OAuth 2.1 authorization server of the MCP endpoint, per the MCP authorization spec:
 * discovery (RFC 9728, RFC 8414), Dynamic Client Registration of public clients (RFC 7591),
 * authorize with a consent page, and token (codes with PKCE S256, rotating refresh tokens).
 * Payload endpoints, so under `/api/oauth/*`; the site serves the discovery documents at
 * `/.well-known/*` too (`@cargo/payload-plugin-mcp/well-known`).
 */

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' } as const

/** JSON answer of the registration and token endpoints. */
const json = (body: unknown, status = 200): Response =>
  Response.json(body, { headers: { ...NO_STORE, ...PUBLIC_CORS_HEADERS }, status })

/** An OAuth error response (RFC 6749 §5.2, RFC 7591 §3.2.2). */
const oauthError = (error: string, description: string, status = 400): Response =>
  json({ error, error_description: description }, status)

const preflight: PayloadHandler = () =>
  new Response(null, { headers: PUBLIC_CORS_HEADERS, status: 204 })

const discovery = (body: unknown): Response =>
  Response.json(body, {
    headers: { ...PUBLIC_CORS_HEADERS, 'Cache-Control': 'public, max-age=300' },
  })

/** Rate limited, or too many pending registrations: try again later. */
const tooMany = (description: string): Response =>
  new Response(JSON.stringify({ error: 'temporarily_unavailable', error_description: description }), {
    headers: { ...NO_STORE, ...PUBLIC_CORS_HEADERS, 'Content-Type': 'application/json', 'Retry-After': '60' },
    status: 429,
  })

const redirect = (location: string): Response =>
  new Response(null, { headers: { Location: location, ...NO_STORE }, status: 303 })

// --- Registration -------------------------------------------------------------------------------

const MAX_REDIRECT_URIS = 5
const MAX_URI_LENGTH = 2000
const MAX_CLIENT_NAME_LENGTH = 100
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

/**
 * Redirect URIs a client may register: `https`, or `http` on a loopback address (local tools such
 * as the MCP Inspector). No custom schemes, credentials or fragments.
 */
const isAllowedRedirectUri = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > MAX_URI_LENGTH) {
    return false
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.hash || url.username || url.password || value.includes('#')) {
    return false
  }
  return (
    url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname))
  )
}

type AuthorizationRequest = {
  client: OAuthClient
  codeChallenge: string
  redirectUri: string
  resource: string
  state: null | string
}

/** A base64url SHA-256: what S256 produces. */
const S256_CHALLENGE = /^[\w-]{43}$/
const MAX_STATE_LENGTH = 1000
/** RFC 7636 §4.1: 43 to 128 unreserved characters. */
const CODE_VERIFIER = /^[\w.~-]{43,128}$/

/** Sends an error back to the client's (already verified) redirect URI (RFC 6749 §4.1.2.1). */
const redirectError = (
  redirectUri: string,
  state: null | string,
  error: string,
  description: string,
): Response => {
  const url = new URL(redirectUri)
  url.searchParams.set('error', error)
  url.searchParams.set('error_description', description)
  if (state !== null) {
    url.searchParams.set('state', state)
  }
  return redirect(url.toString())
}

export const oauthEndpoints = (oauth: SanitizedOAuthConfig): Endpoint[] => {
  const resourceName = oauth.resourceName ?? 'Payload'

  /**
   * Dynamic Client Registration. Every client is public (`token_endpoint_auth_method: none`, PKCE
   * instead of a secret): another requested method is replaced by `none` (RFC 7591 §3.2.1 lets the
   * server substitute values), and only the name and the redirect URIs are kept.
   */
  const register: PayloadHandler = async (req) => {
    if (oauth.rateLimit && !(await oauth.rateLimit({ endpoint: 'register', req }))) {
      return tooMany('Too many registrations: try again later.')
    }
    let body: Record<string, unknown>
    try {
      body = (await req.json!()) as Record<string, unknown>
    } catch {
      return oauthError('invalid_client_metadata', 'The body must be a JSON object.')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return oauthError('invalid_client_metadata', 'The body must be a JSON object.')
    }

    const redirectUris = body.redirect_uris
    if (
      !Array.isArray(redirectUris) ||
      redirectUris.length === 0 ||
      redirectUris.length > MAX_REDIRECT_URIS ||
      !redirectUris.every(isAllowedRedirectUri)
    ) {
      return oauthError(
        'invalid_redirect_uri',
        `redirect_uris must list 1 to ${MAX_REDIRECT_URIS} https URLs (http only on localhost), without fragments.`,
      )
    }
    const grantTypes = body.grant_types ?? ['authorization_code']
    if (!Array.isArray(grantTypes) || !grantTypes.includes('authorization_code')) {
      return oauthError('invalid_client_metadata', 'grant_types must include authorization_code.')
    }
    const responseTypes = body.response_types ?? ['code']
    if (!Array.isArray(responseTypes) || !responseTypes.includes('code')) {
      return oauthError('invalid_client_metadata', 'response_types must include code.')
    }
    const name =
      typeof body.client_name === 'string'
        ? body.client_name
            .replace(/[\p{Cc}\p{Cf}]/gu, '')
            .trim()
            .slice(0, MAX_CLIENT_NAME_LENGTH)
        : ''

    await sweep(req, oauth)
    // Registration is public: bound what anonymous callers can store in the database.
    if ((await countPendingClients(req)) >= oauth.maxPendingClients) {
      return tooMany('Too many pending registrations: try again later.')
    }
    const client = await registerClient(req, {
      clientName: name || 'MCP client',
      redirectUris: [...new Set(redirectUris)],
    })
    return json(
      {
        client_id: client.clientId,
        client_id_issued_at: Math.floor(new Date(client.createdAt).getTime() / 1000),
        client_name: client.clientName,
        grant_types: ['authorization_code', 'refresh_token'],
        redirect_uris: client.redirectUris,
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      201,
    )
  }

  // --- Authorize --------------------------------------------------------------------------------

  /**
   * Validates an authorization request, the same way for the page (GET) and the decision (POST).
   * Until the client and its redirect URI are known, errors are shown on a page: redirecting to an
   * unverified URI would make this an open redirector.
   */
  const validateAuthorizationRequest = async (
    req: PayloadRequest,
    params: URLSearchParams,
  ): Promise<{ request: AuthorizationRequest } | { response: Response }> => {
    const language = languageOf(req.i18n?.language)
    const client = await findClient(req, params.get('client_id') ?? '')
    if (!client) {
      return { response: errorPage(language, 'unknownClient', 400) }
    }
    const redirectUri = params.get('redirect_uri') ?? ''
    const registered = Array.isArray(client.redirectUris) ? client.redirectUris : []
    if (!registered.includes(redirectUri)) {
      return { response: errorPage(language, 'redirectMismatch', 400) }
    }

    const state = params.get('state')
    if (state !== null && state.length > MAX_STATE_LENGTH) {
      return { response: redirectError(redirectUri, null, 'invalid_request', 'state is too long.') }
    }
    const fail = (error: string, description: string) => ({
      response: redirectError(redirectUri, state, error, description),
    })
    if (params.get('response_type') !== 'code') {
      return fail('unsupported_response_type', 'Only response_type=code is supported.')
    }
    const codeChallenge = params.get('code_challenge') ?? ''
    if (params.get('code_challenge_method') !== 'S256' || !S256_CHALLENGE.test(codeChallenge)) {
      return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required.')
    }
    // RFC 8707: the only resource is the MCP endpoint. Clients that don't send it get it anyway.
    const resource = mcpResource(req, getOrigin(req, oauth))
    const requested = params.get('resource')
    if (requested !== null && requested !== resource) {
      return fail('invalid_target', `The only resource is ${resource}.`)
    }
    return { request: { client, codeChallenge, redirectUri, resource, state } }
  }

  /** The admin panel's session (cookie): not an API key, an OAuth token or a JWT header. */
  const sessionUser = (req: PayloadRequest): null | User => {
    const user = req.user
    return user?.collection === oauth.userCollection &&
      user._strategy === 'local-jwt' &&
      !req.headers.get('Authorization')
      ? user
      : null
  }

  /**
   * The consent form's CSRF token: an HMAC (key: Payload's secret) over the user, the whole
   * authorization request and the time it was shown. A POST is accepted only for the same user and
   * request, within `ttl.consent`; another site can't obtain one for the victim's session.
   */
  const consentMessage = (issuedAt: number, userId: number | string, request: AuthorizationRequest) =>
    JSON.stringify([
      'mcp-oauth-consent',
      issuedAt,
      userId,
      request.client.clientId,
      request.redirectUri,
      request.codeChallenge,
      request.state,
      request.resource,
    ])

  const consentToken = async (
    req: PayloadRequest,
    userId: number | string,
    request: AuthorizationRequest,
  ) => {
    const issuedAt = Math.floor(Date.now() / 1000)
    const signature = await sign(req.payload.secret, consentMessage(issuedAt, userId, request))
    return `${issuedAt}.${signature}`
  }

  const verifyConsentToken = async (
    req: PayloadRequest,
    token: string,
    userId: number | string,
    request: AuthorizationRequest,
  ): Promise<boolean> => {
    const [issued, signature, ...rest] = token.split('.')
    const issuedAt = Number(issued)
    const age = Date.now() / 1000 - issuedAt
    if (
      rest.length ||
      !signature ||
      !Number.isInteger(issuedAt) ||
      age < -60 ||
      age > oauth.ttl.consent
    ) {
      return false
    }
    return verify(req.payload.secret, consentMessage(issuedAt, userId, request), signature)
  }

  const describe = (language: 'en' | 'pt'): string | undefined => {
    const description = oauth.consentDescription
    return typeof description === 'string'
      ? description
      : (description?.[language] ?? description?.en)
  }

  /**
   * GET: the consent page. Signed out, it sends the user to the admin login, which comes back here;
   * a user who may not connect (`canConnect`) can't approve.
   */
  const authorizePage: PayloadHandler = async (req) => {
    const params = new URL(req.url!).searchParams
    const validated = await validateAuthorizationRequest(req, params)
    if ('response' in validated) {
      return validated.response
    }
    const { request } = validated

    const user = sessionUser(req)
    if (!user) {
      const { config } = req.payload
      const back = `${config.routes.api}${OAUTH_ENDPOINT_PATHS.authorize}?${params.toString()}`
      // The login form navigates with the admin's client-side router, which can't open an API
      // route; the continue view does the last step with a full page load.
      const next = `${config.routes.admin}${CONTINUE_VIEW_PATH}?to=${encodeURIComponent(back)}`
      const login = `${config.routes.admin}${config.admin.routes?.login ?? '/login'}`
      return redirect(`${login}?redirect=${encodeURIComponent(next)}`)
    }
    const language = languageOf(req.i18n?.language)
    if (!(await mayConnect(req, oauth, user))) {
      return errorPage(language, 'notAllowed', 403)
    }

    return consentPage({
      action: `${req.payload.config.routes.api}${OAUTH_ENDPOINT_PATHS.authorize}`,
      clientName: request.client.clientName,
      description: describe(language),
      fields: {
        client_id: request.client.clientId,
        code_challenge: request.codeChallenge,
        code_challenge_method: 'S256',
        redirect_uri: request.redirectUri,
        resource: request.resource,
        response_type: 'code',
        ...(request.state !== null ? { state: request.state } : {}),
        csrf: await consentToken(req, user.id, request),
      },
      language,
      redirectUri: request.redirectUri,
      resourceName,
      userLabel: String(user.email ?? (user as { username?: string }).username ?? user.id),
    })
  }

  /**
   * POST: the user's decision. Accepted only from this origin (`Origin` / `Sec-Fetch-Site`), for
   * the signed-in user, with a valid CSRF token for this very request. Allow creates the connection
   * and redirects with the code; Deny redirects with `access_denied`.
   */
  const authorizeDecision: PayloadHandler = async (req) => {
    const language = languageOf(req.i18n?.language)
    const origin = req.headers.get('Origin')
    const site = req.headers.get('Sec-Fetch-Site')
    const ownOrigins = [getOrigin(req, oauth), new URL(req.url!).origin]
    if ((origin !== null && !ownOrigins.includes(origin)) || (site !== null && site !== 'same-origin')) {
      return errorPage(language, 'forbidden', 403)
    }
    if (!req.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) {
      return errorPage(language, 'forbidden', 400)
    }
    const form = new URLSearchParams(await req.text!())

    const validated = await validateAuthorizationRequest(req, form)
    if ('response' in validated) {
      return validated.response
    }
    const { request } = validated

    const user = sessionUser(req)
    if (!user) {
      return errorPage(language, 'forbidden', 401)
    }
    if (!(await mayConnect(req, oauth, user))) {
      return errorPage(language, 'notAllowed', 403)
    }
    if (!(await verifyConsentToken(req, form.get('csrf') ?? '', user.id, request))) {
      return errorPage(language, 'forbidden', 403)
    }

    if (form.get('decision') !== 'allow') {
      return redirectError(request.redirectUri, request.state, 'access_denied', 'The user denied access.')
    }
    const code = await approve(req, oauth, { ...request, user })
    const url = new URL(request.redirectUri)
    url.searchParams.set('code', code)
    if (request.state !== null) {
      url.searchParams.set('state', request.state)
    }
    return redirect(url.toString())
  }

  // --- Token ------------------------------------------------------------------------------------

  /**
   * Finds the code or refresh token and runs the checks both grants share. A code or refresh token
   * presented a second time means it leaked (or a client is broken): the whole connection is
   * revoked (OAuth 2.1 §4.1.3, §4.3.1).
   */
  const presented = async (
    req: PayloadRequest,
    form: URLSearchParams,
    kind: 'code' | 'refresh',
    secret: string,
  ): Promise<{ error: Response } | { token: StoredToken }> => {
    const found = await findPresented(req, oauth, secret, kind)
    if (!found) {
      return { error: oauthError('invalid_grant', `Unknown ${kind === 'code' ? 'code' : 'refresh token'}.`) }
    }
    if ('reusedConnection' in found) {
      await revokeConnection(req, found.reusedConnection)
      return { error: oauthError('invalid_grant', 'Already used: the connection was revoked.') }
    }
    const { token } = found
    if (isExpired(token.expiresAt)) {
      return { error: oauthError('invalid_grant', 'Expired.') }
    }
    if (token.client.clientId !== form.get('client_id')) {
      return { error: oauthError('invalid_grant', 'Issued to another client.') }
    }
    const resource = form.get('resource')
    if (resource !== null && resource !== token.connection.resource) {
      return { error: oauthError('invalid_target', `The only resource is ${token.connection.resource}.`) }
    }
    return { token }
  }

  /** Marks the code or refresh token used and checks the user may still connect, then issues. */
  const exchange = async (req: PayloadRequest, token: StoredToken): Promise<Response> => {
    if (!(await claim(req, token))) {
      // Lost a race with a concurrent use of the same secret: a reuse.
      await revokeConnection(req, token.connection.id)
      return oauthError('invalid_grant', 'Already used: the connection was revoked.')
    }
    if (!(await mayConnect(req, oauth, token.user))) {
      await revokeConnection(req, token.connection.id)
      return oauthError('invalid_grant', 'The connection is no longer valid.')
    }
    return json(await issueTokens(req, oauth, token.connection))
  }

  const authorizationCodeGrant = async (req: PayloadRequest, form: URLSearchParams) => {
    const code = form.get('code')
    const verifier = form.get('code_verifier') ?? ''
    if (!code || !form.get('client_id') || !form.get('redirect_uri')) {
      return oauthError('invalid_request', 'code, client_id and redirect_uri are required.')
    }
    if (!CODE_VERIFIER.test(verifier)) {
      return oauthError('invalid_request', 'A PKCE code_verifier is required.')
    }
    const result = await presented(req, form, 'code', code)
    if ('error' in result) {
      return result.error
    }
    const { token } = result
    if (token.connection.redirectUri !== form.get('redirect_uri')) {
      return oauthError('invalid_grant', 'redirect_uri does not match the authorization request.')
    }
    if ((await pkceChallenge(verifier)) !== token.codeChallenge) {
      return oauthError('invalid_grant', 'The code_verifier does not match the code_challenge.')
    }
    const response = await exchange(req, token)
    if (response.ok) {
      await markClientAuthorized(req, token.client)
      await sweep(req, oauth)
    }
    return response
  }

  const refreshTokenGrant = async (req: PayloadRequest, form: URLSearchParams) => {
    const secret = form.get('refresh_token')
    if (!secret || !form.get('client_id')) {
      return oauthError('invalid_request', 'refresh_token and client_id are required.')
    }
    const result = await presented(req, form, 'refresh', secret)
    return 'error' in result ? result.error : exchange(req, result.token)
  }

  /** The token endpoint: `authorization_code` and `refresh_token` grants, public clients only. */
  const token: PayloadHandler = async (req) => {
    if (oauth.rateLimit && !(await oauth.rateLimit({ endpoint: 'token', req }))) {
      return tooMany('Too many token requests: try again later.')
    }
    if (!req.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) {
      return oauthError('invalid_request', 'Use application/x-www-form-urlencoded.')
    }
    const form = new URLSearchParams(await req.text!())
    switch (form.get('grant_type')) {
      case 'authorization_code':
        return authorizationCodeGrant(req, form)
      case 'refresh_token':
        return refreshTokenGrant(req, form)
      default:
        return oauthError(
          'unsupported_grant_type',
          'Only authorization_code and refresh_token are supported.',
        )
    }
  }

  // --- Discovery --------------------------------------------------------------------------------

  const authorizationServer: PayloadHandler = (req) =>
    discovery(authorizationServerMetadata(req, getOrigin(req, oauth)))

  const protectedResource: PayloadHandler = (req) =>
    discovery(protectedResourceMetadata(req, getOrigin(req, oauth), resourceName))

  const P = OAUTH_ENDPOINT_PATHS
  return [
    { handler: register, method: 'post', path: P.register },
    { handler: preflight, method: 'options', path: P.register },
    { handler: authorizePage, method: 'get', path: P.authorize },
    { handler: authorizeDecision, method: 'post', path: P.authorize },
    { handler: token, method: 'post', path: P.token },
    { handler: preflight, method: 'options', path: P.token },
    { handler: authorizationServer, method: 'get', path: P.authorizationServerMetadata },
    { handler: preflight, method: 'options', path: P.authorizationServerMetadata },
    { handler: protectedResource, method: 'get', path: P.protectedResourceMetadata },
    { handler: preflight, method: 'options', path: P.protectedResourceMetadata },
  ]
}
