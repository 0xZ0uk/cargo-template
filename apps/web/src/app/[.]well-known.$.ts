import { oauthWellKnownTarget } from '@shipment/payload-plugin-mcp/well-known'
import { createFileRoute } from '@tanstack/react-router'

/**
 * OAuth discovery for MCP clients (ChatGPT, claude.ai): `/.well-known/oauth-authorization-server`
 * and `/.well-known/oauth-protected-resource[/api/mcp]`. The MCP plugin serves them under
 * `/api/oauth/well-known/*`; clients look for them at the site root. Anything else is a 404.
 */
const serve = async (request: Request): Promise<Response> => {
  const config = await (await import('@payload-config')).default
  const url = new URL(request.url)
  const target = oauthWellKnownTarget(url.pathname, config.routes.api)
  if (!target) {
    return new Response('Not Found', { status: 404 })
  }
  // In-process, like servePluginFile: a Worker's subrequests to its own zone are unreliable.
  const { payloadApiHandlers } = await import('@payloadcms/tanstack-start/routes')
  const handlers = payloadApiHandlers({ getConfig: async () => config })
  url.pathname = target
  url.search = ''
  const forwarded = new Request(url, { headers: request.headers, method: request.method })
  return request.method === 'OPTIONS'
    ? handlers.OPTIONS({ request: forwarded })
    : handlers.GET({ request: forwarded })
}

export const Route = createFileRoute('/.well-known/$')({
  server: {
    handlers: {
      GET: ({ request }) => serve(request),
      OPTIONS: ({ request }) => serve(request),
    },
  },
})
