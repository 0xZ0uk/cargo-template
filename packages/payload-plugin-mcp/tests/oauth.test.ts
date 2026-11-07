/**
 * The OAuth 2.1 authorization server (fork addition): discovery, registration, authorize with
 * consent, the token endpoint, and `/api/mcp` with the access token. Real Payload 4 on SQLite;
 * every request goes through Payload's own endpoint router (`handleEndpoints`), as `/api/*` does.
 */
import type { CollectionSlug, Payload, SanitizedConfig } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildConfig, getPayload, handleEndpoints } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mcpPlugin, OAUTH_SLUGS } from '../src/index.js'
import { getPluginConfig } from '../src/utils/getPluginConfig.js'
import { oauthWellKnownTarget } from '../src/exports/wellKnown.js'

const ORIGIN = 'http://localhost:3000'
const RESOURCE = `${ORIGIN}/api/mcp`
const REDIRECT_URI = 'https://client.example/callback'
const password = 'test-password-123'

let tmpDir: string
let config: SanitizedConfig
let payload: Payload
const users: Record<string, { cookie: string; email: string; id: number | string }> = {}
const apiKey = randomUUID()

const slug = (s: string) => s as CollectionSlug

// --- HTTP helpers -------------------------------------------------------------------------------

const call = (
  method: string,
  path: string,
  { body, headers = {}, target = config }: { body?: string; headers?: Record<string, string>; target?: SanitizedConfig } = {},
) =>
  handleEndpoints({
    config: target,
    payloadInstanceCacheKey: target === config ? 'mcp-oauth' : 'mcp-plain',
    request: new Request(`${ORIGIN}${path}`, { body, headers, method }),
  })

type OAuthJson = {
  [key: string]: unknown
  access_token: string
  client_id: string
  error?: string
  refresh_token: string
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString()

const register = async (metadata: Record<string, unknown>) => {
  const response = await call('POST', '/api/oauth/register', {
    body: JSON.stringify(metadata),
    headers: { 'Content-Type': 'application/json' },
  })
  return { body: (await response.json()) as OAuthJson, status: response.status }
}

const newClient = async (name = 'Test client') => {
  const { body, status } = await register({ client_name: name, redirect_uris: [REDIRECT_URI] })
  expect(status).toBe(201)
  return body.client_id
}

/** PKCE, computed here independently of the plugin's code. */
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { challenge: createHash('sha256').update(verifier).digest('base64url'), verifier }
}

const authorizeParams = (clientId: string, challenge: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: REDIRECT_URI,
    resource: RESOURCE,
    response_type: 'code',
    state: 'state-123',
    ...extra,
  })

const authorizePage = (params: URLSearchParams, cookie?: string) =>
  call('GET', `/api/oauth/authorize?${params}`, { headers: cookie ? { Cookie: cookie } : {} })

const unescape = (value: string) =>
  value.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))

const consentFields = (html: string): Record<string, string> =>
  Object.fromEntries(
    [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map(
      ([, name, value]) => [unescape(name), unescape(value)],
    ),
  )

const SAME_ORIGIN = { 'Sec-Fetch-Site': 'same-origin', Origin: ORIGIN }

const decide = (fields: Record<string, string>, cookie: string, headers: Record<string, string> = SAME_ORIGIN) =>
  call('POST', '/api/oauth/authorize', {
    body: form(fields),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie, ...headers },
  })

/** Shows the consent page to `user`, clicks Allow, and returns the code from the redirect. */
const authorize = async (user: string, clientId: string, challenge: string) => {
  const page = await authorizePage(authorizeParams(clientId, challenge), users[user]!.cookie)
  expect(page.status).toBe(200)
  const response = await decide({ ...consentFields(await page.text()), decision: 'allow' }, users[user]!.cookie)
  expect(response.status).toBe(303)
  const location = new URL(response.headers.get('Location')!)
  expect(location.origin + location.pathname).toBe(REDIRECT_URI)
  expect(location.searchParams.get('state')).toBe('state-123')
  return location.searchParams.get('code')!
}

const tokenRequest = async (fields: Record<string, string>) => {
  const response = await call('POST', '/api/oauth/token', {
    body: form(fields),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  return { body: (await response.json()) as OAuthJson, headers: response.headers, status: response.status }
}

const exchangeCode = (clientId: string, code: string, verifier: string) =>
  tokenRequest({
    client_id: clientId,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
    resource: RESOURCE,
  })

const refresh = (clientId: string, refreshToken: string) =>
  tokenRequest({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken })

/** The whole flow: register, consent, exchange. */
const connect = async (user: string) => {
  const clientId = await newClient()
  const { challenge, verifier } = pkce()
  const code = await authorize(user, clientId, challenge)
  const { body, status } = await exchangeCode(clientId, code, verifier)
  expect(status).toBe(200)
  return { access_token: body.access_token, clientId, refresh_token: body.refresh_token }
}

type RpcBody = { result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] } }

const mcp = async (
  headers: Record<string, string>,
  method = 'tools/list',
  params = {},
  target = config,
) => {
  const response = await call('POST', '/api/mcp', {
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2025-06-18',
      ...headers,
    },
    target,
  })
  const text = await response.text()
  let body: null | RpcBody = null
  try {
    body = text ? (JSON.parse(text) as RpcBody) : null
  } catch {
    // not JSON (an error page)
  }
  return { body, headers: response.headers, status: response.status }
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

const toolNames = async (headers: Record<string, string>) => {
  const { body, status } = await mcp(headers)
  expect(status).toBe(200)
  return (body!.result!.tools ?? []).map((tool) => tool.name).sort()
}

const connectionsOf = async (userId: number | string) =>
  (
    await payload.find({
      collection: slug(OAUTH_SLUGS.connections),
      overrideAccess: true,
      where: { user: { equals: userId } },
    })
  ).docs

/** The connection made through `clientId`. */
const connectionOf = async (clientId: string) => {
  const { docs } = await payload.find({
    collection: slug(OAUTH_SLUGS.clients),
    overrideAccess: true,
    where: { clientId: { equals: clientId } },
  })
  const connections = await payload.find({
    collection: slug(OAUTH_SLUGS.connections),
    depth: 0,
    overrideAccess: true,
    where: { client: { equals: docs[0]!.id } },
  })
  return connections.docs[0]!
}

const allTokens = async () =>
  (
    await payload.find({
      collection: slug(OAUTH_SLUGS.tokens),
      depth: 0,
      overrideAccess: true,
      pagination: false,
    })
  ).docs as unknown as { connection: number | string; hash: string; kind: string }[]

// --- Setup --------------------------------------------------------------------------------------

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mcp-oauth-'))
  config = await buildConfig({
    admin: { user: 'users' },
    collections: [
      {
        slug: 'users',
        auth: { useAPIKey: true },
        fields: [{ name: 'roles', type: 'select', hasMany: true, options: ['admin', 'editor', 'viewer'] }],
      },
      {
        slug: 'pages',
        access: {
          create: ({ req }) => Boolean(req.user),
          delete: ({ req }) => Boolean((req.user as { roles?: string[] } | null)?.roles?.includes('admin')),
          read: () => true,
          update: ({ req }) => Boolean(req.user),
        },
        fields: [{ name: 'title', type: 'text' }],
      },
    ],
    db: sqliteAdapter({ client: { url: `file:${join(tmpDir, 'oauth.db')}` }, push: true }),
    plugins: [
      mcpPlugin({
        collections: { pages: { description: 'Pages.' } },
        mcp: { serverOptions: { serverInfo: { name: 'Test Site' } } },
        oauth: {
          canConnect: ({ user }) =>
            Boolean((user as { roles?: string[] }).roles?.some((r) => r === 'admin' || r === 'editor')),
          canManageAllConnections: ({ user }) => Boolean((user as { roles?: string[] }).roles?.includes('admin')),
        },
      }),
    ],
    secret: 'test-secret',
  })
  payload = await getPayload({ config, key: 'mcp-oauth' })

  for (const [label, roles] of [
    ['admin', ['admin']],
    ['editor', ['editor']],
    ['other', ['editor']],
    ['demoted', ['editor']],
    ['deleted', ['editor']],
    ['viewer', ['viewer']],
  ] as const) {
    const email = `${label}@example.com`
    const user = await payload.create({
      collection: slug('users'),
      data: {
        email,
        password,
        roles: [...roles],
        ...(label === 'editor' ? { apiKey, enableAPIKey: true } : {}),
      } as never,
      overrideAccess: true,
    })
    const { token } = await payload.login({ collection: slug('users') as never, data: { email, password } })
    users[label] = { cookie: `payload-token=${token}`, email, id: user.id }
  }
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  rmSync(tmpDir, { force: true, recursive: true })
})

// --- Tests --------------------------------------------------------------------------------------

describe('discovery', () => {
  it('serves the protected resource metadata (RFC 9728)', async () => {
    const response = await call('GET', '/api/oauth/well-known/oauth-protected-resource')
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await response.json()).toEqual({
      authorization_servers: [ORIGIN],
      bearer_methods_supported: ['header'],
      resource: RESOURCE,
      resource_name: 'Test Site',
    })
  })

  it('serves the authorization server metadata (RFC 8414): S256, public clients, DCR', async () => {
    const response = await call('GET', '/api/oauth/well-known/oauth-authorization-server')
    expect(await response.json()).toEqual({
      authorization_endpoint: `${ORIGIN}/api/oauth/authorize`,
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      issuer: ORIGIN,
      registration_endpoint: `${ORIGIN}/api/oauth/register`,
      response_types_supported: ['code'],
      token_endpoint: `${ORIGIN}/api/oauth/token`,
      token_endpoint_auth_methods_supported: ['none'],
    })
  })

  it('answers CORS preflights of the public endpoints', async () => {
    for (const path of ['/api/oauth/token', '/api/oauth/register', '/api/oauth/well-known/oauth-protected-resource']) {
      const response = await call('OPTIONS', path)
      expect(response.status).toBe(204)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    }
  })

  it('maps the site-root discovery paths to the endpoints', () => {
    expect(oauthWellKnownTarget('/.well-known/oauth-authorization-server')).toBe(
      '/api/oauth/well-known/oauth-authorization-server',
    )
    expect(oauthWellKnownTarget('/.well-known/oauth-protected-resource')).toBe(
      '/api/oauth/well-known/oauth-protected-resource',
    )
    expect(oauthWellKnownTarget('/.well-known/oauth-protected-resource/api/mcp')).toBe(
      '/api/oauth/well-known/oauth-protected-resource',
    )
    expect(oauthWellKnownTarget('/.well-known/oauth-protected-resource/other')).toBeNull()
    expect(oauthWellKnownTarget('/.well-known/security.txt')).toBeNull()
  })

  it('answers /api/mcp without credentials with a 401 pointing at the metadata', async () => {
    const { headers, status } = await mcp({})
    expect(status).toBe(401)
    expect(headers.get('WWW-Authenticate')).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`,
    )
  })

  it('answers an unknown token or API key with invalid_token', async () => {
    for (const authorization of ['Bearer pmcp_at_nope', `users API-Key ${randomUUID()}`]) {
      const { headers, status } = await mcp({ Authorization: authorization })
      expect(status).toBe(401)
      expect(headers.get('WWW-Authenticate')).toMatch(/^Bearer error="invalid_token", resource_metadata=/)
    }
  })
})

describe('client registration', () => {
  it('registers a public client', async () => {
    const { body, status } = await register({
      client_name: ' Claude\u0000 ',
      redirect_uris: [REDIRECT_URI, REDIRECT_URI, 'http://localhost:6274/callback'],
      token_endpoint_auth_method: 'client_secret_basic',
    })
    expect(status).toBe(201)
    expect(body).toMatchObject({
      client_name: 'Claude',
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: [REDIRECT_URI, 'http://localhost:6274/callback'],
      token_endpoint_auth_method: 'none',
    })
    expect(body.client_id).toMatch(/^[\w-]{32}$/)
    expect(body).not.toHaveProperty('client_secret')
  })

  it('refuses unsafe redirect URIs and clients without the authorization_code grant', async () => {
    for (const redirect_uris of [[], ['http://evil.example/cb'], ['https://a.example/cb#x'], ['myapp://cb'], 'x']) {
      expect((await register({ redirect_uris })).body.error).toBe('invalid_redirect_uri')
    }
    const { body } = await register({ grant_types: ['client_credentials'], redirect_uris: [REDIRECT_URI] })
    expect(body.error).toBe('invalid_client_metadata')
  })

  it('deletes clients that never completed an authorization within an hour', async () => {
    const stale = await newClient('Stale')
    const used = await newClient('Used')
    // `used` completes an authorization; then both are made two hours old.
    const { challenge, verifier } = pkce()
    expect((await exchangeCode(used, await authorize('editor', used, challenge), verifier)).status).toBe(200)
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    for (const clientId of [stale, used]) {
      const { docs } = await payload.find({
        collection: slug(OAUTH_SLUGS.clients),
        overrideAccess: true,
        where: { clientId: { equals: clientId } },
      })
      await payload.db.updateOne({
        id: docs[0]!.id,
        collection: slug(OAUTH_SLUGS.clients),
        data: { createdAt: twoHoursAgo },
      })
    }
    await newClient('Trigger') // registration runs the clean-up
    const { docs } = await payload.find({
      collection: slug(OAUTH_SLUGS.clients),
      overrideAccess: true,
      where: { clientId: { in: [stale, used] } },
    })
    expect(docs.map((doc) => (doc as unknown as { clientId: string }).clientId)).toEqual([used])
  })
})

describe('authorize', () => {
  it('sends a signed-out user to the admin login, which comes back here', async () => {
    const params = authorizeParams(await newClient(), pkce().challenge)
    const response = await authorizePage(params)
    expect(response.status).toBe(303)
    const next = `/admin/mcp-oauth/continue?to=${encodeURIComponent(`/api/oauth/authorize?${params}`)}`
    expect(response.headers.get('Location')).toBe(`/admin/login?redirect=${encodeURIComponent(next)}`)
  })

  it('adds the continue view to the admin', () => {
    expect(config.admin.components.views?.mcpOAuthContinue).toMatchObject({ path: '/mcp-oauth/continue' })
  })

  it('shows the consent page: client, site, redirect host, user; framing refused', async () => {
    const page = await authorizePage(authorizeParams(await newClient('<b>Claude</b>'), pkce().challenge), users.editor!.cookie)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('Allow &#60;b&#62;Claude&#60;/b&#62; to access Test Site?')
    expect(html).not.toContain('<b>Claude</b>')
    expect(html).toContain('<strong>client.example</strong>')
    expect(html).toContain('editor@example.com')
    expect(page.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(page.headers.get('Content-Security-Policy')).toContain("form-action 'self' https://client.example")
  })

  it('refuses a user who may not connect (canConnect), and API keys instead of the session', async () => {
    const params = authorizeParams(await newClient(), pkce().challenge)
    expect((await authorizePage(params, users.viewer!.cookie)).status).toBe(403)
    const withKey = await call('GET', `/api/oauth/authorize?${params}`, {
      headers: { Authorization: `users API-Key ${apiKey}` },
    })
    expect(withKey.status).toBe(303)
    expect(withKey.headers.get('Location')).toMatch(/^\/admin\/login/)
  })

  it('shows an error page (never redirects) for an unknown client or a mismatched redirect URI', async () => {
    const clientId = await newClient()
    for (const params of [
      authorizeParams('unknown', pkce().challenge),
      authorizeParams(clientId, pkce().challenge, { redirect_uri: 'https://evil.example/cb' }),
    ]) {
      const response = await authorizePage(params, users.editor!.cookie)
      expect(response.status).toBe(400)
      expect(response.headers.get('Location')).toBeNull()
    }
  })

  it('redirects errors in a verified request back to the client', async () => {
    const clientId = await newClient()
    for (const [extra, error] of [
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
    ] as const) {
      const response = await authorizePage(authorizeParams(clientId, pkce().challenge, extra), users.editor!.cookie)
      expect(response.status).toBe(303)
      const location = new URL(response.headers.get('Location')!)
      expect(location.searchParams.get('error')).toBe(error)
      expect(location.searchParams.get('state')).toBe('state-123')
    }
  })

  it('redirects back with access_denied when the user denies', async () => {
    const page = await authorizePage(authorizeParams(await newClient(), pkce().challenge), users.editor!.cookie)
    const response = await decide({ ...consentFields(await page.text()), decision: 'deny' }, users.editor!.cookie)
    expect(new URL(response.headers.get('Location')!).searchParams.get('error')).toBe('access_denied')
    expect(await connectionsOf(users.editor!.id)).not.toContainEqual(expect.objectContaining({ clientName: 'Denied' }))
  })

  it('refuses an approval that is cross-site, forged, tampered with, or by another user', async () => {
    const clientId = await newClient()
    const page = await authorizePage(authorizeParams(clientId, pkce().challenge), users.editor!.cookie)
    const fields: Record<string, string> = { ...consentFields(await page.text()), decision: 'allow' }
    const cookie = users.editor!.cookie

    expect((await decide(fields, cookie, { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' })).status).toBe(403)
    expect((await decide({ ...fields, csrf: '' }, cookie)).status).toBe(403)
    expect((await decide({ ...fields, csrf: `${Math.floor(Date.now() / 1000)}.AAAA` }, cookie)).status).toBe(403)
    // The CSRF token is bound to the request: another PKCE challenge or state is refused.
    expect((await decide({ ...fields, code_challenge: pkce().challenge }, cookie)).status).toBe(403)
    expect((await decide({ ...fields, state: 'other' }, cookie)).status).toBe(403)
    expect((await decide(fields, users.other!.cookie)).status).toBe(403)
    // An expired one too.
    const old = Math.floor(Date.now() / 1000) - 3600
    expect((await decide({ ...fields, csrf: fields.csrf!.replace(/^\d+/, String(old)) }, cookie)).status).toBe(403)
    // And the real one works.
    expect((await decide(fields, cookie)).status).toBe(303)
  })
})

describe('token endpoint', () => {
  it('exchanges a code with the right PKCE verifier, once; a reuse revokes the connection', async () => {
    const clientId = await newClient()
    const { challenge, verifier } = pkce()
    const code = await authorize('editor', clientId, challenge)

    expect((await exchangeCode(clientId, code, pkce().verifier)).body.error).toBe('invalid_grant')
    const { body, headers, status } = await exchangeCode(clientId, code, verifier)
    expect(status).toBe(200)
    expect(headers.get('Cache-Control')).toBe('no-store')
    expect(body).toMatchObject({ expires_in: 3600, token_type: 'Bearer' })
    expect(body.access_token).toMatch(/^pmcp_at_/)
    expect(body.refresh_token).toMatch(/^pmcp_rt_/)
    expect(await toolNames(bearer(body.access_token))).toContain('findDocuments')

    const again = await exchangeCode(clientId, code, verifier)
    expect(again.body.error).toBe('invalid_grant')
    expect((await mcp(bearer(body.access_token))).status).toBe(401)
  })

  it('stores only hashes of codes and tokens', async () => {
    const { access_token, refresh_token } = await connect('editor')
    const hashes = (await allTokens()).map((token) => token.hash)
    expect(hashes).not.toContain(access_token)
    expect(hashes).not.toContain(refresh_token)
    expect(JSON.stringify(hashes)).not.toContain(access_token.slice(8))
  })

  it('refuses a code for another client or redirect URI, and an expired code', async () => {
    const clientId = await newClient()
    const { challenge, verifier } = pkce()
    const code = await authorize('editor', clientId, challenge)
    expect((await exchangeCode(await newClient(), code, verifier)).body.error).toBe('invalid_grant')
    const wrongRedirect = await tokenRequest({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: 'https://client.example/other',
    })
    expect(wrongRedirect.body.error).toBe('invalid_grant')

    const expiredCode = await authorize('editor', clientId, challenge)
    const codes = (await allTokens()).filter((token) => token.kind === 'code')
    for (const token of codes) {
      await payload.db.updateOne({
        id: (token as unknown as { id: number }).id,
        collection: slug(OAUTH_SLUGS.tokens),
        data: { expiresAt: new Date(Date.now() - 1000).toISOString() },
      })
    }
    expect((await exchangeCode(clientId, expiredCode, verifier)).body).toMatchObject({
      error: 'invalid_grant',
      error_description: 'Expired.',
    })
  })

  it('rotates refresh tokens, and a reused one revokes the whole connection', async () => {
    const { clientId, refresh_token } = await connect('editor')
    const first = await refresh(clientId, refresh_token)
    expect(first.status).toBe(200)
    expect(first.body.refresh_token).not.toBe(refresh_token)
    expect(await toolNames(bearer(first.body.access_token))).toContain('findDocuments')

    const reused = await refresh(clientId, refresh_token)
    expect(reused.body).toMatchObject({ error: 'invalid_grant', error_description: expect.stringMatching(/revoked/) })
    expect((await mcp(bearer(first.body.access_token))).status).toBe(401)
    expect((await refresh(clientId, first.body.refresh_token)).status).toBe(400)
  })

  it('lets only one of two concurrent refreshes with the same token through', async () => {
    const { clientId, refresh_token } = await connect('editor')
    const results = await Promise.all([refresh(clientId, refresh_token), refresh(clientId, refresh_token)])
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1)
    expect(results.some((r) => r.status === 400)).toBe(true)
  })

  it('refuses a refresh token for another client, and unknown grants', async () => {
    const { refresh_token } = await connect('editor')
    expect((await refresh(await newClient(), refresh_token)).body.error).toBe('invalid_grant')
    expect((await tokenRequest({ grant_type: 'client_credentials' })).body.error).toBe('unsupported_grant_type')
    const json = await call('POST', '/api/oauth/token', {
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(json.status).toBe(400)
  })
})

describe('/api/mcp with an OAuth access token', () => {
  it("acts as the user: an editor's token can't do what an editor can't", async () => {
    const { access_token } = await connect('editor')
    const page = await payload.create({ collection: slug('pages'), data: { title: 'Keep' }, overrideAccess: true })
    const { body } = await mcp(bearer(access_token), 'tools/call', {
      name: 'deleteDocuments',
      arguments: { id: String(page.id), slug: 'pages' },
    })
    expect(body?.result?.isError).toBe(true)
    expect(await payload.findByID({ id: page.id, collection: slug('pages'), overrideAccess: true })).toBeTruthy()
  })

  it('never exposes the OAuth collections as tools', async () => {
    const { access_token } = await connect('admin')
    const { body } = await mcp(bearer(access_token), 'tools/call', { name: 'getConfigInfo', arguments: {} })
    const text = body?.result?.content?.map((c) => c.text).join('') ?? ''
    expect(text).toContain('pages')
    expect(text).not.toContain('mcp-oauth')
  })

  it('refuses an expired token, a revoked connection, a refresh token or code as access token', async () => {
    const { access_token, clientId, refresh_token } = await connect('editor')
    expect((await mcp(bearer(refresh_token))).status).toBe(401)

    const connection = await connectionOf(clientId)
    // Revoked in the admin panel: deleting the connection through REST, as its owner.
    const revoke = await call('DELETE', `/api/${OAUTH_SLUGS.connections}/${connection.id}`, {
      headers: { Cookie: users.editor!.cookie },
    })
    expect(revoke.status).toBe(200)
    expect((await mcp(bearer(access_token))).status).toBe(401)
    expect((await allTokens()).filter((token) => token.connection === connection.id)).toEqual([])

    const second = await connect('editor')
    const access = (await allTokens()).filter((token) => token.kind === 'access')
    for (const token of access) {
      await payload.db.updateOne({
        id: (token as unknown as { id: number }).id,
        collection: slug(OAUTH_SLUGS.tokens),
        data: { expiresAt: new Date(Date.now() - 1000).toISOString() },
      })
    }
    expect((await mcp(bearer(second.access_token))).status).toBe(401)
  })

  it('refuses a token bound to another audience (another serverURL)', async () => {
    const { access_token, clientId } = await connect('editor')
    expect((await mcp(bearer(access_token))).status).toBe(200)
    await payload.db.updateOne({
      id: (await connectionOf(clientId)).id,
      collection: slug(OAUTH_SLUGS.connections),
      data: { resource: 'https://other.example/api/mcp' },
    })
    expect((await mcp(bearer(access_token))).status).toBe(401)
  })

  it('stops working when the user may no longer connect, and when the user is deleted', async () => {
    const demoted = await connect('demoted')
    expect((await mcp(bearer(demoted.access_token))).status).toBe(200)
    await payload.update({
      id: users.demoted!.id,
      collection: slug('users'),
      data: { roles: ['viewer'] } as never,
      overrideAccess: true,
    })
    expect((await mcp(bearer(demoted.access_token))).status).toBe(401)
    expect((await refresh(demoted.clientId, demoted.refresh_token)).body.error).toBe('invalid_grant')

    const deleted = await connect('deleted')
    await payload.delete({ id: users.deleted!.id, collection: slug('users'), overrideAccess: true })
    expect(await connectionsOf(users.deleted!.id)).toEqual([])
    expect((await mcp(bearer(deleted.access_token))).status).toBe(401)
  })

  it("still accepts API keys and the admin's session (the assistant)", async () => {
    expect(await toolNames({ Authorization: `users API-Key ${apiKey}` })).toContain('findDocuments')
    expect(await toolNames({ Cookie: users.editor!.cookie })).toContain('findDocuments')
  })
})

describe('limits on anonymous callers', () => {
  it('refuses registration past maxPendingClients, until clients authorize or expire', async () => {
    const oauth = getPluginConfig({ config }).oauth!
    const before = oauth.maxPendingClients
    const { totalDocs } = await payload.count({
      collection: slug(OAUTH_SLUGS.clients),
      overrideAccess: true,
      where: { authorizedAt: { exists: false } },
    })
    oauth.maxPendingClients = totalDocs + 1
    try {
      expect((await register({ redirect_uris: [REDIRECT_URI] })).status).toBe(201)
      const refused = await call('POST', '/api/oauth/register', {
        body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
        headers: { 'Content-Type': 'application/json' },
      })
      expect(refused.status).toBe(429)
      expect(refused.headers.get('Retry-After')).toBe('60')
      expect(((await refused.json()) as OAuthJson).error).toBe('temporarily_unavailable')
    } finally {
      oauth.maxPendingClients = before
    }
  })

  it('applies the rateLimit hook to registration and the token endpoint', async () => {
    const oauth = getPluginConfig({ config }).oauth!
    const seen: string[] = []
    oauth.rateLimit = ({ endpoint }) => {
      seen.push(endpoint)
      return false
    }
    try {
      expect((await register({ redirect_uris: [REDIRECT_URI] })).status).toBe(429)
      expect((await tokenRequest({ grant_type: 'refresh_token' })).status).toBe(429)
      expect(seen).toEqual(['register', 'token'])
    } finally {
      oauth.rateLimit = undefined
    }
  })
})

describe('credentials stay out of reach of OAuth clients', () => {
  const callTool = async (token: string, name: string, args: Record<string, unknown>) => {
    const { body, status } = await mcp(bearer(token), 'tools/call', { name, arguments: args })
    expect(status).toBe(200)
    return body!.result!
  }
  const editor = async () =>
    (await payload.findByID({
      id: users.editor!.id,
      collection: slug('users'),
      overrideAccess: true,
      showHiddenFields: true,
    })) as unknown as { email: string }

  it("can't set an API key, a password or an email, or create an account", async () => {
    const { access_token } = await connect('editor')
    const id = String(users.editor!.id)
    const chosenKey = randomUUID()
    for (const data of [
      { apiKey: chosenKey, enableAPIKey: true },
      { password: 'chosen-by-the-client' },
      { email: 'attacker@example.com' },
    ]) {
      const result = await callTool(access_token, 'updateDocument', { data, id, slug: 'users' })
      expect(result.isError).toBe(true)
    }
    // The key the client chose doesn't authenticate; the user's own still does.
    expect((await mcp({ Authorization: `users API-Key ${chosenKey}` })).status).toBe(401)
    expect((await mcp({ Authorization: `users API-Key ${apiKey}` })).status).toBe(200)
    expect((await editor()).email).toBe('editor@example.com')
    // The password still works, unchanged.
    await payload.login({ collection: slug('users') as never, data: { email: 'editor@example.com', password } })

    const created = await callTool(access_token, 'createDocuments', {
      data: { email: 'new@example.com', password: 'chosen-by-the-client' },
      slug: 'users',
    })
    expect(created.isError).toBe(true)
    const { totalDocs } = await payload.count({
      collection: slug('users'),
      overrideAccess: true,
      where: { email: { equals: 'new@example.com' } },
    })
    expect(totalDocs).toBe(0)
  })

  it('can still edit the other fields of a user, within their access', async () => {
    const { access_token } = await connect('editor')
    const result = await callTool(access_token, 'updateDocument', {
      data: { roles: ['editor'] },
      id: String(users.other!.id),
      slug: 'users',
    })
    expect(result.isError).toBeFalsy()
  })

  it('leaves API keys and the session unaffected', async () => {
    const response = await mcp({ Authorization: `users API-Key ${apiKey}` }, 'tools/call', {
      name: 'updateDocument',
      arguments: { data: { email: 'other2@example.com' }, id: String(users.other!.id), slug: 'users' },
    })
    expect(response.body?.result?.isError).toBeFalsy()
  })
})

describe('admin visibility', () => {
  it('users see their own connections, canManageAllConnections sees all; nobody sees clients or tokens', async () => {
    await connect('editor')
    await connect('other')
    const list = async (collection: string, cookie: string) => {
      const response = await call('GET', `/api/${collection}?depth=0&limit=100`, { headers: { Cookie: cookie } })
      return { body: (await response.json()) as { docs?: { user: unknown }[] }, status: response.status }
    }
    const asEditor = await list(OAUTH_SLUGS.connections, users.editor!.cookie)
    expect(asEditor.body.docs!.length).toBeGreaterThan(0)
    expect(asEditor.body.docs!.every((doc) => doc.user === users.editor!.id)).toBe(true)
    const asAdmin = await list(OAUTH_SLUGS.connections, users.admin!.cookie)
    expect(new Set(asAdmin.body.docs!.map((doc) => doc.user)).size).toBeGreaterThan(1)

    for (const collection of [OAUTH_SLUGS.clients, OAUTH_SLUGS.tokens]) {
      expect((await list(collection, users.admin!.cookie)).status).toBe(403)
    }
  })

  it("can't revoke another user's connection", async () => {
    const connection = await connectionOf((await connect('other')).clientId)
    await call('DELETE', `/api/${OAUTH_SLUGS.connections}/${connection.id}`, {
      headers: { Cookie: users.editor!.cookie },
    })
    expect((await connectionsOf(users.other!.id)).map((c) => c.id)).toContain(connection.id)
  })
})

describe('without oauth', () => {
  it('keeps upstream behaviour: no OAuth endpoints or collections, anonymous gets no tools', async () => {
    const plain = await buildConfig({
      admin: { user: 'users' },
      collections: [{ slug: 'users', auth: true, fields: [] }],
      db: sqliteAdapter({ client: { url: `file:${join(tmpDir, 'plain.db')}` }, push: true }),
      plugins: [mcpPlugin({})],
      secret: 'test-secret',
    })
    await getPayload({ config: plain, key: 'mcp-plain' })
    expect(plain.collections.map((c) => c.slug)).not.toContain(OAUTH_SLUGS.tokens)
    expect((await call('GET', '/api/oauth/well-known/oauth-protected-resource', { target: plain })).status).toBe(404)
    const { body, status } = await mcp({}, 'tools/list', {}, plain)
    expect(status).toBe(200)
    expect(body?.result?.tools ?? []).toEqual([])
  })
})
