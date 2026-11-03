import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'

import { trailingSlashTarget } from '@/utilities/trailingSlash'

/**
 * `/foo/` → 308 `/foo`. Without it, TanStack's SSR redirects with a hard-coded 307 before any
 * route or `seo-redirects` lookup runs, and search engines treat a 307 as temporary.
 */
const trailingSlashMiddleware = createMiddleware({ type: 'request' }).server(({ next, request }) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return next()

  const target = trailingSlashTarget(new URL(request.url))
  if (!target) return next()

  return new Response(null, { headers: { Location: target }, status: 308 })
})

export const startInstance = createStart(() => ({
  requestMiddleware: [
    // Defining a start instance replaces TanStack's default request middleware, which is
    // exactly this CSRF check on server-function calls. Keep it.
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' }),
    trailingSlashMiddleware,
  ],
}))
