import type { CollectionSlug, PayloadRequest, User, Where } from 'payload'

import type { SanitizedOAuthConfig } from './config.js'

import { OAUTH_SLUGS } from './config.js'
import { hashSecret, randomSecret } from './crypto.js'
import { ACCESS_TOKEN_PREFIX, REFRESH_TOKEN_PREFIX } from './metadata.js'

/**
 * Reads and writes of the OAuth collections (`collections.ts`), through the Local API with
 * `overrideAccess: true`: the collections are closed to every API, and the callers (the OAuth
 * endpoints, the MCP endpoint) authorize the request themselves.
 *
 * Database-agnostic, and safe on Cloudflare D1:
 * - Bulk deletes go to the adapter's `deleteMany` with conditions on the collection's own columns
 *   only, which the SQL adapters run as one `DELETE … WHERE` statement. Payload's `delete`
 *   operation lists the matching ids in one query instead, which D1 refuses past 100 bound
 *   parameters, and a connection used for a month can match hundreds of rows. That is why tokens
 *   repeat their connection's `user` and `client`.
 * - Exchanging a code or refresh token is atomic without transactions (D1 has none across
 *   statements): see {@link claim}.
 */

type ID = number | string

export type OAuthClient = {
  authorizedAt?: null | string
  clientId: string
  clientName: string
  createdAt: string
  id: ID
  redirectUris: unknown
}

export type OAuthConnection = {
  client: ID | OAuthClient
  clientName: string
  expiresAt: string
  id: ID
  lastUsedAt?: null | string
  redirectUri: string
  resource: string
  user: ID | User
}

type Kind = 'access' | 'code' | 'refresh'

type OAuthToken = {
  client: ID | OAuthClient
  codeChallenge?: null | string
  connection: ID | OAuthConnection
  expiresAt: string
  hash: string
  id: ID
  kind: 'used' | Kind
  user: ID | User
}

/** A code or token with its connection, user and client populated. */
export type StoredToken = {
  client: OAuthClient
  connection: OAuthConnection
  user: User
} & Omit<OAuthToken, 'client' | 'connection' | 'user'>

const SYSTEM = { overrideAccess: true } as const
const slug = (s: string) => s as CollectionSlug

const idOf = (value: ID | { id: ID }): ID => (typeof value === 'object' ? value.id : value)

const isoIn = (seconds: number): string => new Date(Date.now() + seconds * 1000).toISOString()

export const isExpired = (date: null | string | undefined): boolean =>
  !date || new Date(date).getTime() <= Date.now()

/** One `DELETE … WHERE` on the collection's own columns, without hooks. */
const deleteWhere = (req: PayloadRequest, collection: string, where: Where) =>
  req.payload.db.deleteMany({ collection: slug(collection), req, where })

/**
 * Deletes the connections whose `field` matches `condition` (their id, user or client), with their
 * codes and tokens.
 */
const deleteConnections = async (
  req: PayloadRequest,
  field: 'client' | 'id' | 'user',
  condition: Where[string],
) => {
  // Tokens first: they reference the connections.
  await deleteWhere(req, OAUTH_SLUGS.tokens, { [field === 'id' ? 'connection' : field]: condition })
  await deleteWhere(req, OAUTH_SLUGS.connections, { [field]: condition })
}

/** For the `beforeDelete` hook of a connection (the admin panel's revoke). */
export const deleteConnectionTokens = (req: PayloadRequest, id: ID) =>
  deleteWhere(req, OAUTH_SLUGS.tokens, { connection: { equals: id } })

/** Revokes a connection: deletes it with its codes and tokens. */
export const revokeConnection = (req: PayloadRequest, id: ID) =>
  deleteConnections(req, 'id', { equals: id })

/** Revokes every connection of a user (deleted, or no longer allowed to connect). */
export const revokeUserConnections = (req: PayloadRequest, userId: ID) =>
  deleteConnections(req, 'user', { equals: userId })

/** May this user approve a connection, and may their connections keep working? */
export const mayConnect = async (
  req: PayloadRequest,
  oauth: SanitizedOAuthConfig,
  user: null | User | undefined,
): Promise<boolean> =>
  Boolean(user) &&
  user!.collection === oauth.userCollection &&
  (oauth.canConnect ? await oauth.canConnect({ req, user: user! }) : true)

const PREFIX: Record<Kind, string> = {
  access: ACCESS_TOKEN_PREFIX,
  code: '',
  refresh: REFRESH_TOKEN_PREFIX,
}

/** Creates a code or token for a connection and returns the secret; only its hash is stored. */
const issue = async (
  req: PayloadRequest,
  oauth: SanitizedOAuthConfig,
  connection: Pick<OAuthConnection, 'client' | 'id' | 'user'>,
  kind: Kind,
  extra: Pick<OAuthToken, 'codeChallenge'> = {},
): Promise<string> => {
  const secret = randomSecret(PREFIX[kind])
  await req.payload.create({
    collection: slug(OAUTH_SLUGS.tokens),
    data: {
      client: idOf(connection.client),
      connection: connection.id,
      expiresAt: isoIn(oauth.ttl[kind]),
      hash: await hashSecret(secret),
      kind,
      user: idOf(connection.user),
      ...extra,
    },
    depth: 0,
    req,
    ...SYSTEM,
  })
  return secret
}

export const findClient = async (
  req: PayloadRequest,
  clientId: string,
): Promise<null | OAuthClient> => {
  if (!clientId) {
    return null
  }
  const { docs } = await req.payload.find({
    collection: slug(OAUTH_SLUGS.clients),
    depth: 0,
    limit: 1,
    pagination: false,
    req,
    where: { clientId: { equals: clientId } },
    ...SYSTEM,
  })
  return (docs[0] as unknown as OAuthClient) ?? null
}

export const registerClient = async (
  req: PayloadRequest,
  data: Pick<OAuthClient, 'clientName' | 'redirectUris'>,
): Promise<OAuthClient> =>
  (await req.payload.create({
    collection: slug(OAUTH_SLUGS.clients),
    data: { ...data, clientId: randomSecret().slice(0, 32) },
    depth: 0,
    req,
    ...SYSTEM,
  })) as unknown as OAuthClient

/** Registered clients that haven't completed an authorization (`maxPendingClients`). */
export const countPendingClients = async (req: PayloadRequest): Promise<number> =>
  (
    await req.payload.count({
      collection: slug(OAUTH_SLUGS.clients),
      req,
      where: { authorizedAt: { exists: false } },
      ...SYSTEM,
    })
  ).totalDocs

/**
 * The user approved: records the connection and returns its authorization code. The connection
 * expires shortly after the code unless the code is exchanged.
 */
export const approve = async (
  req: PayloadRequest,
  oauth: SanitizedOAuthConfig,
  {
    client,
    codeChallenge,
    redirectUri,
    resource,
    user,
  }: {
    client: OAuthClient
    codeChallenge: string
    redirectUri: string
    resource: string
    user: User
  },
): Promise<string> => {
  const connection = (await req.payload.create({
    collection: slug(OAUTH_SLUGS.connections),
    data: {
      client: client.id,
      clientName: client.clientName,
      // After the code's own expiry, so the clean-up never deletes a connection before its code.
      expiresAt: isoIn(oauth.ttl.code + 60),
      redirectUri,
      resource,
      user: user.id,
    },
    depth: 0,
    req,
    ...SYSTEM,
  })) as unknown as OAuthConnection
  return issue(req, oauth, connection, 'code', { codeChallenge })
}

const findByHash = async (req: PayloadRequest, hash: string, where: Where = {}, depth = 0) => {
  const { docs } = await req.payload.find({
    collection: slug(OAUTH_SLUGS.tokens),
    depth,
    limit: 1,
    pagination: false,
    req,
    where: { hash: { equals: hash }, ...where },
    ...SYSTEM,
  })
  return (docs[0] as unknown as OAuthToken) ?? null
}

/** The marker of an exchanged code or refresh token (a hash has no `.`, so no collision). */
const usedHash = (hash: string) => `used.${hash}`

const populated = (token: null | OAuthToken, oauth: SanitizedOAuthConfig): null | StoredToken => {
  // A connection, user or client deleted in between leaves nothing to act on.
  if (
    !token ||
    typeof token.connection !== 'object' ||
    typeof token.user !== 'object' ||
    typeof token.client !== 'object' ||
    !token.connection ||
    !token.user ||
    !token.client
  ) {
    return null
  }
  return {
    ...token,
    user: { ...token.user, collection: oauth.userCollection },
  } as StoredToken
}

/** Finds a code or token by its secret, with the connection, user and client populated. */
export const findToken = async (
  req: PayloadRequest,
  oauth: SanitizedOAuthConfig,
  secret: string,
  kind: Kind,
): Promise<null | StoredToken> =>
  populated(await findByHash(req, await hashSecret(secret), { kind: { equals: kind } }, 1), oauth)

/**
 * A code or refresh token presented to the token endpoint: the live one, or the connection it
 * belonged to when it was already exchanged (a reuse, which revokes the connection).
 */
export const findPresented = async (
  req: PayloadRequest,
  oauth: SanitizedOAuthConfig,
  secret: string,
  kind: 'code' | 'refresh',
): Promise<{ reusedConnection: ID } | { token: StoredToken } | null> => {
  const hash = await hashSecret(secret)
  const token = await findByHash(req, hash, { kind: { equals: kind } }, 1)
  if (token) {
    const stored = populated(token, oauth)
    return stored ? { token: stored } : null
  }
  const used = await findByHash(req, usedHash(hash))
  return used ? { reusedConnection: idOf(used.connection) } : null
}

/**
 * Exchanges a code or refresh token, atomically: of two concurrent requests with the same secret
 * only one gets `true`. Payload's `update` reads, then writes, and D1 has no transactions, so the
 * claim is an insert instead: a `used` row whose unique `hash` is derived from the token's. The
 * second insert fails on the unique index. The token itself is then deleted; the `used` row
 * remains until the token would have expired, so presenting it again is recognised as a reuse.
 */
export const claim = async (req: PayloadRequest, token: StoredToken): Promise<boolean> => {
  const hash = usedHash(token.hash)
  try {
    await req.payload.create({
      collection: slug(OAUTH_SLUGS.tokens),
      data: {
        client: token.client.id,
        connection: token.connection.id,
        expiresAt: token.expiresAt,
        hash,
        kind: 'used',
        user: token.user.id,
      },
      depth: 0,
      req,
      ...SYSTEM,
    })
  } catch (error) {
    // Lost the race, or a real failure: only the first one is a `false`.
    if (await findByHash(req, hash)) {
      return false
    }
    throw error
  }
  await deleteWhere(req, OAUTH_SLUGS.tokens, { id: { equals: token.id } })
  return true
}

/**
 * Issues an access token and a refresh token for a connection that was just authorized or
 * refreshed, and extends the connection to the new refresh token's expiry.
 */
export const issueTokens = async (
  req: PayloadRequest,
  oauth: SanitizedOAuthConfig,
  connection: OAuthConnection,
) => {
  const accessToken = await issue(req, oauth, connection, 'access')
  const refreshToken = await issue(req, oauth, connection, 'refresh')
  // The connection's expired codes and tokens are of no use any more.
  await deleteWhere(req, OAUTH_SLUGS.tokens, {
    connection: { equals: connection.id },
    expiresAt: { less_than: new Date().toISOString() },
  })
  await req.payload.update({
    id: connection.id,
    collection: slug(OAUTH_SLUGS.connections),
    data: { expiresAt: isoIn(oauth.ttl.refresh), lastUsedAt: new Date().toISOString() },
    depth: 0,
    req,
    ...SYSTEM,
  })
  return {
    access_token: accessToken,
    expires_in: oauth.ttl.access,
    refresh_token: refreshToken,
    token_type: 'Bearer',
  }
}

/** Marks a registered client as used, which exempts it from the clean-up. */
export const markClientAuthorized = async (req: PayloadRequest, client: OAuthClient) => {
  if (client.authorizedAt) {
    return
  }
  await req.payload.update({
    id: client.id,
    collection: slug(OAUTH_SLUGS.clients),
    data: { authorizedAt: new Date().toISOString() },
    depth: 0,
    req,
    ...SYSTEM,
  })
}

/** `lastUsedAt` of a connection is refreshed at most this often by MCP requests (one write). */
const LAST_USED_RESOLUTION_MS = 5 * 60 * 1000

/**
 * The user an access token acts as, or null if the token is unknown or expired, is bound to
 * another audience, or its connection or user no longer qualifies. Checked on every request, so
 * revoking a connection, or deleting a user or taking away their right to connect, takes effect at
 * once.
 */
export const authenticateAccessToken = async (
  req: PayloadRequest,
  oauth: SanitizedOAuthConfig,
  secret: string,
  resource: string,
): Promise<null | User> => {
  const token = await findToken(req, oauth, secret, 'access')
  if (!token || isExpired(token.expiresAt)) {
    return null
  }
  const { connection, user } = token
  if (connection.resource !== resource || isExpired(connection.expiresAt)) {
    return null
  }
  if (!(await mayConnect(req, oauth, user))) {
    return null
  }

  const lastUsed = connection.lastUsedAt ? new Date(connection.lastUsedAt).getTime() : 0
  if (Date.now() - lastUsed > LAST_USED_RESOLUTION_MS) {
    await req.payload.update({
      id: connection.id,
      collection: slug(OAUTH_SLUGS.connections),
      data: { lastUsedAt: new Date().toISOString() },
      depth: 0,
      req,
      ...SYSTEM,
    })
  }
  return user
}

/** Most stale clients removed per clean-up: keeps every `IN (…)` list far below D1's 100. */
const STALE_CLIENTS_PER_SWEEP = 50

/**
 * Clean-up, run on registration and on code exchange: expired codes, tokens and `used` rows,
 * expired connections (never exchanged, or unused for the refresh token lifetime), and registered
 * clients that never completed an authorization within `ttl.unusedClient`.
 */
export const sweep = async (req: PayloadRequest, oauth: SanitizedOAuthConfig): Promise<void> => {
  const now = new Date().toISOString()
  // A connection outlives each of its tokens (see `approve` and `issueTokens`), so this order
  // leaves no token pointing at a deleted connection.
  await deleteWhere(req, OAUTH_SLUGS.tokens, { expiresAt: { less_than: now } })
  await deleteWhere(req, OAUTH_SLUGS.connections, { expiresAt: { less_than: now } })

  const { docs } = await req.payload.find({
    collection: slug(OAUTH_SLUGS.clients),
    depth: 0,
    limit: STALE_CLIENTS_PER_SWEEP,
    pagination: false,
    req,
    select: {},
    where: {
      authorizedAt: { exists: false },
      createdAt: { less_than: isoIn(-oauth.ttl.unusedClient) },
    },
    ...SYSTEM,
  })
  const ids = docs.map((doc) => doc.id)
  if (ids.length) {
    await deleteConnections(req, 'client', { in: ids })
    await deleteWhere(req, OAUTH_SLUGS.clients, { id: { in: ids } })
  }
}
