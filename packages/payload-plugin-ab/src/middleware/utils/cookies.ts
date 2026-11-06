import type { AbCookie } from "../types";

/** Parses a `Cookie` request header. The first occurrence of a name wins, as in browsers. */
export function parseCookieHeader(header: string | null | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;

    const name = part.slice(0, eq).trim();
    if (!name || cookies.has(name)) continue;

    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }

  return cookies;
}

/** Serializes a cookie for a `Set-Cookie` header. The value is URI-encoded; the name is used as is. */
export function serializeAbCookie(cookie: AbCookie): string {
  const { httpOnly, maxAge, path, sameSite } = cookie.options;
  const expires = new Date(Date.now() + maxAge * 1000).toUTCString();

  return `${cookie.name}=${encodeURIComponent(cookie.value)}; Path=${path}; Max-Age=${maxAge}; Expires=${expires}; SameSite=${sameSite === "lax" ? "Lax" : sameSite}${httpOnly ? "; HttpOnly" : ""}`;
}
