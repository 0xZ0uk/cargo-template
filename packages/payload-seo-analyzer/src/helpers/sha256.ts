/**
 * Lowercase hex SHA-256 of `text` (WebCrypto: Workers and Node).
 *
 * Used to put request- or config-derived values (a URL, a list of collections) into a
 * persisted cache key: those can carry characters outside the store's `[a-z0-9:/._-]`
 * (uppercase hosts, IPv6 literals, query strings, commas), a hash can't.
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
