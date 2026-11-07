import { definePlugin } from 'payload'

import type { AuthorizedMCP, MCPPluginConfig, SanitizedMCPPluginConfig } from './types.js'

import { mcpEndpoint } from './endpoint/index.js'
import { sanitizeMCPConfig } from './mcp/sanitizeMCPConfig.js'
import { withOAuth } from './oauth/plugin.js'

declare module 'payload' {
  export interface PayloadRequestAPI {
    MCP: true
  }
  interface RegisteredPlugins {
    /** After the plugin's `plugin` callback runs, `options` holds the sanitized config. */
    '@payloadcms/plugin-mcp': MCPPluginConfig
  }
}

export type { AuthorizedMCP, MCPPluginConfig, SanitizedMCPPluginConfig }
export type { MCPOAuthConfig, OAuthTTL, SanitizedOAuthConfig } from './oauth/config.js'
export { OAUTH_SLUGS } from './oauth/config.js'
export { ACCESS_TOKEN_PREFIX, OAUTH_STRATEGY } from './oauth/metadata.js'
export { revokeConnection, revokeUserConnections } from './oauth/store.js'

export { defineCollectionTool, defineGlobalTool, definePrompt, defineTool } from './defineTool.js'

export const mcpPlugin = definePlugin<MCPPluginConfig>({
  slug: '@payloadcms/plugin-mcp',
  order: 10,
  plugin: ({ config, options, plugins }) => {
    const pluginConfig = sanitizeMCPConfig({ config, pluginConfig: options })

    // Stash the sanitized config on plugin options so `getPluginConfig()` reads it.
    const registered = plugins['@payloadcms/plugin-mcp']
    if (registered) {
      // @ts-expect-error
      registered.sanitizedOptions = pluginConfig
    }

    // Fork: the OAuth collections are added even when disabled, so the schema doesn't change.
    const withOAuthConfig = withOAuth({ config, enabled: !pluginConfig.disabled, pluginConfig })

    if (pluginConfig.disabled) {
      return withOAuthConfig
    }

    return {
      ...withOAuthConfig,
      endpoints: [
        ...(withOAuthConfig.endpoints ?? []),
        // Payload prefixes /api, so the full path is /api/mcp.
        { handler: mcpEndpoint, method: 'post', path: '/mcp' },
        // Streamable HTTP's optional server=>client GET stream. We don't offer
        // one, so answer 405 per spec-— clients then skip it cleanly
        {
          handler: () => new Response(null, { headers: { Allow: 'POST' }, status: 405 }),
          method: 'get',
          path: '/mcp',
        },
      ],
    }
  },
})
