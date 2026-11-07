import type { CollectionBeforeDeleteHook, Config } from 'payload'

import type { SanitizedMCPPluginConfig } from '../types.js'

import { oauthCollections } from './collections.js'
import { oauthEndpoints } from './endpoints.js'
import { CONTINUE_VIEW_PATH } from './config.js'
import { revokeUserConnections } from './store.js'

/** Deleting a user revokes their connections (their tokens would fail anyway, but leave rows). */
const revokeOnUserDelete: CollectionBeforeDeleteHook = async ({ id, req }) => {
  await revokeUserConnections(req, id)
}

/**
 * Fork addition: adds the OAuth server to the config when `oauth` is set. The collections, the
 * user hook and the admin view always (a disabled plugin keeps the same schema and import map);
 * the endpoints only when enabled.
 */
export const withOAuth = ({
  config,
  enabled,
  pluginConfig,
}: {
  config: Config
  enabled: boolean
  pluginConfig: SanitizedMCPPluginConfig
}): Config => {
  const { oauth } = pluginConfig
  if (!oauth) {
    return config
  }
  return {
    ...config,
    admin: {
      ...config.admin,
      components: {
        ...config.admin?.components,
        views: {
          ...config.admin?.components?.views,
          mcpOAuthContinue: {
            Component: '@cargo/payload-plugin-mcp/client#OAuthContinueView',
            path: CONTINUE_VIEW_PATH,
          },
        },
      },
    },
    collections: [
      ...(config.collections ?? []).map((collection) =>
        collection.slug === oauth.userCollection
          ? {
              ...collection,
              hooks: {
                ...collection.hooks,
                beforeDelete: [...(collection.hooks?.beforeDelete ?? []), revokeOnUserDelete],
              },
            }
          : collection,
      ),
      ...oauthCollections(oauth),
    ],
    endpoints: [...(config.endpoints ?? []), ...(enabled ? oauthEndpoints(oauth) : [])],
  }
}
