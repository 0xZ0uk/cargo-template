/**
 * Makes a string safe inside a cookie name. A name must be an RFC 6265 token: ASCII, and no
 * separators. `encodeURIComponent` leaves only `( ) ! ' * ~` raw, and of those `(` and `)` are
 * separators. Browsers drop a `Set-Cookie` with an invalid name, so a slug like `à-propos`
 * would never stick.
 */
export function encodeCookieNamePart(value: string): string {
  return encodeURIComponent(value).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
