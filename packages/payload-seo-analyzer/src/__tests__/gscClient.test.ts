import { afterEach, describe, expect, it, vi } from 'vitest'
import { encryptToken } from '../helpers/tokenCrypto'
import { getGscAccessToken, getGscOAuthConfig, resolveGscSiteUrl } from '../helpers/gscClient'

const REQ = { url: 'https://admin.example.com/api/seo-plugin/gsc/auth' }

afterEach(() => {
  delete process.env.SITE_URL
  delete process.env.GSC_OAUTH_CLIENT_ID
  delete process.env.GSC_OAUTH_CLIENT_SECRET
  vi.unstubAllGlobals()
})

function withCredentials() {
  process.env.GSC_OAUTH_CLIENT_ID = 'client-id'
  process.env.GSC_OAUTH_CLIENT_SECRET = 'client-secret'
}

describe('GSC site URL and redirect URI', () => {
  it('prefers the siteUrl option, then SITE_URL, then the request origin', () => {
    expect(resolveGscSiteUrl({ siteUrl: 'https://opt.example/' } as never, REQ)).toBe('https://opt.example')
    process.env.SITE_URL = 'https://env.example/'
    expect(resolveGscSiteUrl({} as never, REQ)).toBe('https://env.example')
    delete process.env.SITE_URL
    expect(resolveGscSiteUrl({} as never, REQ)).toBe('https://admin.example.com')
  })

  it('has no site URL without a request (scheduled jobs) and no option or SITE_URL', () => {
    expect(resolveGscSiteUrl({} as never)).toBeUndefined()
    withCredentials()
    expect(getGscOAuthConfig('/seo-plugin', {} as never, '/api')).toBeNull()
  })

  it('builds the redirect URI from the site URL, Payload routes.api and the plugin base path', () => {
    withCredentials()
    process.env.SITE_URL = 'https://env.example'
    expect(getGscOAuthConfig('/seo-plugin', {} as never, '/api', REQ)?.redirectUri).toBe(
      'https://env.example/api/seo-plugin/gsc/callback',
    )
    expect(getGscOAuthConfig('/tools/seo', { siteUrl: 'https://opt.example' } as never, '/payload-api', REQ)?.redirectUri).toBe(
      'https://opt.example/payload-api/tools/seo/gsc/callback',
    )
  })

  it('falls back to the request origin for the redirect URI', () => {
    withCredentials()
    const cfg = getGscOAuthConfig('/seo-plugin', {} as never, '/api', REQ)
    expect(cfg?.redirectUri).toBe('https://admin.example.com/api/seo-plugin/gsc/callback')
    expect(cfg?.siteUrl).toBe('https://admin.example.com')
  })

  it('is not configured without client credentials', () => {
    process.env.SITE_URL = 'https://env.example'
    expect(getGscOAuthConfig('/seo-plugin', {} as never, '/api', REQ)).toBeNull()
  })
})

describe('getGscAccessToken', () => {
  const cfg = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x/cb', siteUrl: 'https://x' }

  it('decrypts the stored token and refreshes', async () => {
    const fetchMock = vi.fn(async () => Response.json({ access_token: 'access-1' }))
    vi.stubGlobal('fetch', fetchMock)
    const payload = { secret: 'payload-secret', logger: { error: vi.fn() } }
    const refreshTokenEnc = await encryptToken('refresh-1', 'payload-secret')
    expect(await getGscAccessToken(payload as never, cfg, { refreshTokenEnc })).toBe('access-1')
    const body = String((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(body).toContain('refresh_token=refresh-1')
  })

  it('reports decrypt_failed and logs the reason when the key changed', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const error = vi.fn()
    const payload = { secret: 'rotated-secret', logger: { error } }
    const refreshTokenEnc = await encryptToken('refresh-1', 'payload-secret')
    await expect(getGscAccessToken(payload as never, cfg, { refreshTokenEnc })).rejects.toThrow('decrypt_failed')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('wrong key'))
    expect(JSON.stringify(error.mock.calls)).not.toContain('refresh-1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports not_connected without a stored token', async () => {
    await expect(getGscAccessToken({} as never, cfg, {})).rejects.toThrow('not_connected')
  })
})
