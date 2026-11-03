/** `endpointBasePath` of the SEO analyzer plugin (its default; `payload.config.ts` doesn't override it). */
const SEO_PLUGIN_BASE_PATH = '/seo-plugin'

/** Used when the plugin's response carries no `Cache-Control` of its own (robots.txt, llms.txt). */
const DEFAULT_CACHE_CONTROL = 'public, max-age=3600, s-maxage=3600'

/**
 * Serves one of the SEO analyzer's public endpoints (`/api/seo-plugin/<file>`) at the site root.
 *
 * The request is handed to Payload's own endpoint router in-process, with the URL rewritten.
 * It never goes over the network: a Worker's subrequests to its own zone are unreliable.
 * Imports are dynamic so this file stays out of the client bundle.
 */
export const servePluginFile = async (request: Request, file: string): Promise<Response> => {
  const { payloadApiHandlers } = await import('@payloadcms/tanstack-start/routes')
  const config = (await import('@payload-config')).default
  const resolved = await config

  const url = new URL(request.url)
  url.pathname = `${resolved.routes.api}${SEO_PLUGIN_BASE_PATH}/${file}`
  url.search = ''

  const { GET } = payloadApiHandlers({ getConfig: async () => resolved })
  const response = await GET({ request: new Request(url, { headers: request.headers, method: 'GET' }) })

  if (response.status !== 200 || response.headers.has('Cache-Control')) {
    return response
  }

  // Responses from the endpoint router can have immutable headers.
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', DEFAULT_CACHE_CONTROL)

  return new Response(response.body, { headers, status: response.status, statusText: response.statusText })
}
