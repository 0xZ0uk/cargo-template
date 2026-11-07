import type { Access, CollectionBeforeDeleteHook, CollectionConfig, User } from 'payload'

import type { SanitizedOAuthConfig } from './config.js'

import { OAUTH_SLUGS } from './config.js'
import { deleteConnectionTokens } from './store.js'

/**
 * Storage of the OAuth server. Only the plugin writes these collections, with the Local API: REST,
 * GraphQL and the admin panel can't create or edit anything, and the MCP tools never list them.
 * Codes and tokens are stored as SHA-256 hashes only. Users see (and revoke, by deleting) their
 * connections in the admin panel; the clients and tokens are hidden.
 */

const nobody = (): boolean => false

/** Nothing is edited in the admin panel: no versions, no locking, no GraphQL. */
// Relationships are not `required`: Payload's foreign keys are `ON DELETE set null`, which fails on
// a NOT NULL column when a user or client is deleted outside Payload's hooks. The plugin always sets
// them, deletes dependent rows first (hooks, `store.ts`), and ignores a row whose target is gone.
const common = { graphQL: false, lockDocuments: false, versions: false } as const

/** A connection's codes and tokens go with it (the admin panel's revoke). */
const deleteTokens: CollectionBeforeDeleteHook = ({ id, req }) => deleteConnectionTokens(req, id)

export const oauthCollections = (oauth: SanitizedOAuthConfig): CollectionConfig[] => {
  /** Users of `userCollection` see their own connections; `canManageAllConnections` sees all. */
  const ownOrAll: Access = ({ req }) => {
    const user = req.user as null | User
    if (!user || user.collection !== oauth.userCollection) {
      return false
    }
    if (oauth.canManageAllConnections?.({ req, user })) {
      return true
    }
    return { user: { equals: user.id } }
  }

  return [
    /** Clients registered by Dynamic Client Registration (RFC 7591). Public clients: no secret. */
    {
      slug: OAUTH_SLUGS.clients,
      access: { create: nobody, delete: nobody, read: nobody, update: nobody },
      admin: { hidden: true, useAsTitle: 'clientName' },
      ...common,
      fields: [
        { name: 'clientId', type: 'text', index: true, required: true, unique: true },
        // Chosen by whoever registered the client: shown on the consent page next to the redirect host.
        { name: 'clientName', type: 'text', required: true },
        { name: 'redirectUris', type: 'json', required: true },
        // Set by the first completed authorization. Clients without it are deleted after a day.
        { name: 'authorizedAt', type: 'date' },
      ],
    },
    /** A grant: a user allowed a client to act as them. Deleting one revokes it at once. */
    {
      slug: OAUTH_SLUGS.connections,
      access: { create: nobody, delete: ownOrAll, read: ownOrAll, update: nobody },
      admin: {
        defaultColumns: ['clientName', 'user', 'redirectUri', 'createdAt', 'lastUsedAt'],
        description: {
          en: 'AI clients (ChatGPT, Claude…) that read and edit the site content on behalf of a user, over MCP. Delete a connection to revoke its access.',
          pt: 'Clientes de IA (ChatGPT, Claude…) que leem e editam o conteúdo do site em nome de um utilizador, através do MCP. Elimine uma ligação para revogar o acesso.',
        },
        useAsTitle: 'clientName',
      },
      defaultSort: '-createdAt',
      hooks: { beforeDelete: [deleteTokens] },
      labels: {
        plural: { en: 'AI connections', pt: 'Ligações de IA' },
        singular: { en: 'AI connection', pt: 'Ligação de IA' },
      },
      ...common,
      fields: [
        { name: 'clientName', type: 'text', label: { en: 'Client', pt: 'Cliente' }, required: true },
        {
          name: 'user',
          type: 'relationship',
          index: true,
          label: { en: 'User', pt: 'Utilizador' },
          relationTo: oauth.userCollection,
        },
        {
          name: 'client',
          type: 'relationship',
          admin: { hidden: true },
          index: true,
          relationTo: OAUTH_SLUGS.clients,
        },
        {
          name: 'redirectUri',
          type: 'text',
          label: { en: 'Redirects to', pt: 'Redireciona para' },
          required: true,
        },
        // The audience of its tokens: always `<origin><api>/mcp`.
        { name: 'resource', type: 'text', admin: { hidden: true }, required: true },
        { name: 'lastUsedAt', type: 'date', label: { en: 'Last used', pt: 'Último uso' } },
        // When its newest code or refresh token expires; expired connections are deleted.
        {
          name: 'expiresAt',
          type: 'date',
          index: true,
          label: { en: 'Expires', pt: 'Expira' },
          required: true,
        },
      ],
    },
    /**
     * Authorization codes, access and refresh tokens, as hashes, plus a `used` row per code or
     * refresh token exchanged (see `claim` in `store.ts`). `user` and `client` repeat the
     * connection's so that revoking deletes them with one statement.
     */
    {
      slug: OAUTH_SLUGS.tokens,
      access: { create: nobody, delete: nobody, read: nobody, update: nobody },
      admin: { hidden: true },
      ...common,
      fields: [
        { name: 'hash', type: 'text', index: true, required: true, unique: true },
        {
          name: 'kind',
          type: 'select',
          options: ['code', 'access', 'refresh', 'used'],
          required: true,
        },
        {
          name: 'connection',
          type: 'relationship',
          index: true,
          relationTo: OAUTH_SLUGS.connections,
        },
        {
          name: 'user',
          type: 'relationship',
          index: true,
          relationTo: oauth.userCollection,
        },
        {
          name: 'client',
          type: 'relationship',
          index: true,
          relationTo: OAUTH_SLUGS.clients,
        },
        { name: 'expiresAt', type: 'date', index: true, required: true },
        // Codes only: the PKCE S256 challenge.
        { name: 'codeChallenge', type: 'text' },
      ],
    },
  ]
}
