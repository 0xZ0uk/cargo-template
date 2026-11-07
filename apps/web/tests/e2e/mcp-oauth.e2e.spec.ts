import { createHash, randomBytes } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { cleanupTestUser, seedTestUser, testUser } from '../helpers/seedUser'

// OAuth for the MCP endpoint (packages/payload-plugin-mcp, `oauth`) in a real browser: what the
// plugin's integration tests can't show is that the site-root discovery route works, that the
// admin login sends the user back to the authorize endpoint, and that the consent page's headers
// (CSP `form-action`) let the decision reach the client. The client's redirect URI is answered by
// Playwright, so nothing leaves the machine.
const REDIRECT_URI = 'https://client.example/callback'

test.beforeAll(seedTestUser)
test.afterAll(cleanupTestUser)

test('discovery is served at the site root, and /api/mcp challenges anonymous callers', async ({
  request,
  baseURL,
}) => {
  const resource = await request.get('/.well-known/oauth-protected-resource/api/mcp')
  expect(resource.status()).toBe(200)
  expect(await resource.json()).toMatchObject({
    authorization_servers: [baseURL],
    resource: `${baseURL}/api/mcp`,
  })
  const server = await request.get('/.well-known/oauth-authorization-server')
  expect(await server.json()).toMatchObject({
    issuer: baseURL,
    code_challenge_methods_supported: ['S256'],
  })
  expect((await request.get('/.well-known/not-ours')).status()).toBe(404)

  const mcp = await request.post('/api/mcp', {
    headers: { Accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  })
  expect(mcp.status()).toBe(401)
  expect(mcp.headers()['www-authenticate']).toBe(
    `Bearer resource_metadata="${baseURL}/.well-known/oauth-protected-resource/api/mcp"`,
  )
})

test('a signed-out user logs in, approves, and the client gets a working token', async ({
  page,
  request,
  baseURL,
}) => {
  const registration = await request.post('/api/oauth/register', {
    data: { client_name: 'E2E client', redirect_uris: [REDIRECT_URI] },
  })
  expect(registration.status()).toBe(201)
  const { client_id: clientId } = await registration.json()

  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const authorize = new URL('/api/oauth/authorize', baseURL)
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'e2e-state',
    resource: `${baseURL}/api/mcp`,
  }).toString()

  let callback: URL | undefined
  await page.route(`${REDIRECT_URI}**`, async (route) => {
    callback = new URL(route.request().url())
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'client callback' })
  })

  // Signed out: the admin login, which comes back to the consent page.
  await page.goto(authorize.toString())
  await expect(page).toHaveURL(/\/admin\/login\?redirect=/, { timeout: 30_000 })
  await page.fill('#field-email', testUser.email)
  await page.fill('#field-password', testUser.password)
  await page.click('button[type="submit"]')

  await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E client', {
    timeout: 30_000,
  })
  await expect(page.getByText('client.example')).toBeVisible()
  await expect(page.getByText(testUser.email)).toBeVisible()

  await page.getByRole('button', { name: /^(Allow|Permitir)$/ }).click()
  await expect(page.getByText('client callback')).toBeVisible()
  expect(callback?.searchParams.get('state')).toBe('e2e-state')
  const code = callback?.searchParams.get('code')
  expect(code).toBeTruthy()

  const token = await request.post('/api/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      code: code!,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    },
  })
  expect(token.status()).toBe(200)
  const { access_token: accessToken } = await token.json()

  const mcp = await request.post('/api/mcp', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json, text/event-stream',
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  })
  expect(mcp.status()).toBe(200)
  expect(JSON.stringify(await mcp.json())).toContain('findDocuments')
})
