import type {
  AuthCollectionSlug,
  Config,
  MaybePromise,
  PayloadRequest,
  SanitizedConfig,
  User,
} from 'payload'

/**
 * Options of the OAuth 2.1 authorization server (`mcpPlugin({ oauth })`). Fork addition: ChatGPT
 * and claude.ai only connect to MCP servers over OAuth. See README, "OAuth".
 */
export type MCPOAuthConfig = {
  /**
   * Who may approve a client, and whose connections keep working. Checked on the consent page and
   * again on every MCP request and token refresh, so taking the right away stops a connection at
   * once.
   *
   * @default every user of `userCollection`
   */
  canConnect?: (args: { req: PayloadRequest; user: User }) => MaybePromise<boolean>
  /**
   * Who sees and revokes every user's connections in the admin panel. Everyone else sees and
   * revokes only their own.
   *
   * @default nobody: every user manages their own
   */
  canManageAllConnections?: (args: { req: PayloadRequest; user: User }) => boolean
  /**
   * What a connected client can do, in a sentence, on the consent page (per language code, or one
   * string for every language). Defaults to a generic sentence about reading and editing content.
   */
  consentDescription?: Record<string, string> | string
  /**
   * Most registered clients that haven't completed an authorization yet. Registration is public, so
   * this bounds what anonymous callers can store (about 10 KB per client at most); past it,
   * registration answers `429` until stale clients are cleaned up (`ttl.unusedClient`).
   *
   * @default 1000
   */
  maxPendingClients?: number
  /**
   * Rate limit for the public endpoints that anonymous callers reach: return `false` to answer
   * `429`. Key it by client IP (`CF-Connecting-IP` on Workers), e.g. with a Workers Rate Limiting
   * binding. Without it, only `maxPendingClients` applies.
   */
  rateLimit?: (args: { endpoint: 'register' | 'token'; req: PayloadRequest }) => MaybePromise<boolean>
  /**
   * Shown on the consent page ("Allow ChatGPT to access <resourceName>?") and as `resource_name`
   * in the protected resource metadata.
   *
   * @default `mcp.serverOptions.serverInfo.name`, else "Payload"
   */
  resourceName?: string
  /**
   * Public origin of the site, the OAuth issuer (no path, no trailing slash).
   *
   * @default `serverURL` from the Payload config, else the origin of each request
   */
  serverURL?: string
  /** Lifetimes, in seconds. */
  ttl?: Partial<OAuthTTL>
  /**
   * The auth collection whose users approve connections and whom the tokens act as.
   *
   * @default `admin.user` of the Payload config
   */
  userCollection?: AuthCollectionSlug
}

export type OAuthTTL = {
  /** Access tokens. @default 3600 (an hour) */
  access: number
  /** Authorization codes: single use. @default 60 */
  code: number
  /** How long the consent form may be submitted after it was shown. @default 600 */
  consent: number
  /** Each refresh token; refreshing issues a new one, so a connection in use never expires. @default 30 days */
  refresh: number
  /**
   * A registered client that hasn't completed an authorization by then is deleted. Real clients
   * authorize within minutes of registering; a short lifetime also means one IP can't keep
   * `maxPendingClients` full (1,000 an hour is more than a 10/min per-IP limit allows).
   * @default 3600 (an hour)
   */
  unusedClient: number
}

export type SanitizedOAuthConfig = {
  maxPendingClients: number
  ttl: OAuthTTL
  userCollection: AuthCollectionSlug
} & Omit<MCPOAuthConfig, 'maxPendingClients' | 'ttl' | 'userCollection'>

export const DEFAULT_TTL: OAuthTTL = {
  access: 60 * 60,
  code: 60,
  consent: 10 * 60,
  refresh: 30 * 24 * 60 * 60,
  unusedClient: 60 * 60,
}

/** Slugs of the plugin's collections (closed to every API but the connections' read and delete). */
export const OAUTH_SLUGS = {
  clients: 'mcp-oauth-clients',
  connections: 'mcp-oauth-connections',
  tokens: 'mcp-oauth-tokens',
} as const

/** Admin path of the view that finishes the login → authorize trip (`exports/client.tsx`). */
export const CONTINUE_VIEW_PATH = '/mcp-oauth/continue'

export const sanitizeOAuthConfig = (
  oauth: boolean | MCPOAuthConfig | undefined,
  config: Config | SanitizedConfig,
): SanitizedOAuthConfig | undefined => {
  if (!oauth) {
    return undefined
  }
  const options = oauth === true ? {} : oauth
  const userCollection = (options.userCollection ?? config.admin?.user ?? 'users') as AuthCollectionSlug
  const collection = config.collections?.find((c) => c.slug === userCollection)
  if (!collection?.auth) {
    throw new Error(
      `[plugin-mcp] oauth.userCollection "${userCollection}" must be an auth collection of this config.`,
    )
  }
  return {
    ...options,
    maxPendingClients: options.maxPendingClients ?? 1000,
    serverURL: options.serverURL?.replace(/\/+$/, ''),
    ttl: { ...DEFAULT_TTL, ...options.ttl },
    userCollection,
  }
}
