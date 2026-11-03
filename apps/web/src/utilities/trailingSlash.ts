/**
 * Path prefixes owned by Payload (admin panel and REST/GraphQL API, the defaults in
 * `payload.config.ts`). Their URL handling is left to Payload and TanStack.
 */
const PAYLOAD_PREFIXES = ['/admin', '/api'] as const

const isUnder = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`)

/**
 * Where a frontend URL with a trailing slash should permanently redirect: the same path
 * without it, query string kept. Returns null when there is nothing to do (no trailing
 * slash, the root, or a Payload path).
 *
 * TanStack's SSR canonicalises `/foo/` to `/foo` with a hard-coded 307, a temporary
 * redirect search engines don't consolidate. This lets the app answer with a 308 first.
 */
export const trailingSlashTarget = (url: URL): string | null => {
  const { pathname, search } = url

  if (pathname === '/' || !pathname.endsWith('/')) return null
  if (PAYLOAD_PREFIXES.some((prefix) => isUnder(pathname, prefix))) return null

  const stripped = pathname.replace(/\/+$/, '')

  // `//` and other all-slash paths: leave them to TanStack's own normalisation.
  if (stripped === '' || stripped.startsWith('//')) return null

  return `${stripped}${search}`
}
