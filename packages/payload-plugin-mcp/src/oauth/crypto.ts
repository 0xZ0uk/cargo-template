/**
 * The OAuth server's cryptography, on Web Crypto only (`crypto.getRandomValues`,
 * `crypto.subtle`): the same API in Node and on Workers, so nothing here depends on `node:crypto`.
 * The algorithms are SHA-256 and HMAC-SHA-256, which Workers supports without limits (unlike
 * PBKDF2).
 */

const encoder = new TextEncoder()

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (value: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

/** A random, URL-safe secret: 32 bytes (256 bits) of entropy, base64url. */
export const randomSecret = (prefix = ''): string =>
  prefix + toBase64Url(crypto.getRandomValues(new Uint8Array(32)))

/** SHA-256 of a string, base64url. */
const sha256 = async (value: string): Promise<string> =>
  toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))

/**
 * What is stored for a code or token: its SHA-256. The secrets are 256-bit random values, so a
 * plain hash (no salt, no slow KDF) can't be reversed, and the lookup stays one indexed query.
 */
export const hashSecret = sha256

/** PKCE `S256` (RFC 7636 §4.6): BASE64URL(SHA256(code_verifier)) must equal the challenge. */
export const pkceChallenge = sha256

const hmacKey = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])

/** HMAC-SHA-256 of `message` with `secret`, base64url. */
export const sign = async (secret: string, message: string): Promise<string> =>
  toBase64Url(
    new Uint8Array(
      await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message)),
    ),
  )

/** Checks a signature from {@link sign}; `crypto.subtle.verify` compares in constant time. */
export const verify = async (
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> => {
  const bytes = fromBase64Url(signature)
  if (!bytes || bytes.length !== 32) return false
  return crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    bytes as Uint8Array<ArrayBuffer>,
    encoder.encode(message),
  )
}
