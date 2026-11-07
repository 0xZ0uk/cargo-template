import type { MCPOAuthConfig } from '@cargo/payload-plugin-mcp'

/** Rate-limit key: the client IP, which Cloudflare's edge sets and clients can't forge. */
const clientKey = (headers: Headers) => headers.get('cf-connecting-ip')?.trim() || 'unknown'

/**
 * The MCP plugin's `oauth.rateLimit`: client registration (`POST /api/oauth/register`, public) per
 * client IP, through the `OAUTH_RATE_LIMIT_REGISTER` binding (wrangler.jsonc), shared by every
 * isolate in a location. The token endpoint isn't limited here: ChatGPT and claude.ai refresh
 * tokens for every connected user from their own servers, and it only stores rows for valid codes.
 * Without the binding (Node dev server, tests), everything passes.
 */
export function oauthRateLimit(binding: RateLimit | undefined): MCPOAuthConfig['rateLimit'] {
  return async ({ endpoint, req }) => {
    if (!binding || endpoint !== 'register') return true
    const { success } = await binding.limit({ key: `oauth-register:${clientKey(req.headers)}` })
    return success
  }
}
