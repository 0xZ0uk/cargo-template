/**
 * `@cargo/payload-plugin-mcp/well-known`: for the site-root discovery routes. OAuth clients look
 * for `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource[/api/mcp]`
 * at the root of the site, outside Payload's `/api`, so the app forwards those paths to the
 * plugin's endpoints. Framework-free and Payload-free: import it from any route file.
 *
 * TanStack Start: a `/.well-known/$` route that hands the request to Payload's API handler with
 * the URL from {@link oauthWellKnownTarget}. Next.js: a rewrite in `next.config` from
 * `/.well-known/:path(oauth-authorization-server|oauth-protected-resource)/:rest*` to
 * `/api/oauth/well-known/:path`. See the README, "Setting up a site".
 */

/** Paths of the plugin's OAuth endpoints, under Payload's API route. */
export const OAUTH_ENDPOINT_PATHS = {
  authorizationServerMetadata: '/oauth/well-known/oauth-authorization-server',
  authorize: '/oauth/authorize',
  protectedResourceMetadata: '/oauth/well-known/oauth-protected-resource',
  register: '/oauth/register',
  token: '/oauth/token',
} as const

/**
 * The Payload endpoint path (with `apiRoute`) that serves a site-root discovery path, or `null`
 * when the path is not one of the plugin's.
 *
 * @param pathname e.g. `/.well-known/oauth-protected-resource/api/mcp`
 * @param apiRoute Payload's `routes.api`
 */
export const oauthWellKnownTarget = (pathname: string, apiRoute = '/api'): null | string => {
  switch (pathname.replace(/\/+$/, '')) {
    case '/.well-known/oauth-authorization-server':
      return `${apiRoute}${OAUTH_ENDPOINT_PATHS.authorizationServerMetadata}`
    // RFC 9728 §3.1: the metadata of `<origin>/api/mcp` is at the path-suffixed URL.
    case '/.well-known/oauth-protected-resource':
    case `/.well-known/oauth-protected-resource${apiRoute}/mcp`:
      return `${apiRoute}${OAUTH_ENDPOINT_PATHS.protectedResourceMetadata}`
    default:
      return null
  }
}
