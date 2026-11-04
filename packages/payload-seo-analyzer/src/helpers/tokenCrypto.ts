/**
 * Token-at-rest encryption for OAuth refresh tokens (GSC integration).
 *
 * WebCrypto only (`crypto.subtle`), so it runs unchanged on Node, Cloudflare Workers and
 * any other runtime with the standard API. AES-256-GCM (authenticated: tampering or a wrong
 * key makes decryption throw) with a random 12-byte IV and a random 16-byte HKDF salt per
 * encryption. Serialized as `v2:<salt b64>:<iv b64>:<ciphertext+tag b64>`.
 *
 * Key material (in order):
 *   1. `SEO_GSC_ENCRYPTION_KEY` env: 32 raw bytes as hex(64) or base64(44). RECOMMENDED.
 *   2. Otherwise the provided `secret` (typically Payload's `secret`, a high-entropy server
 *      secret). Rotating Payload's secret then invalidates stored tokens (the user must
 *      reconnect GSC).
 * The material goes through HKDF-SHA-256 (no iteration count, so none of the Workers
 * PBKDF2 / CPU limits apply) to get the AES key.
 *
 * Legacy `v1:<iv>:<tag>:<ciphertext>` tokens (AES-256-GCM through `node:crypto`, key from
 * scrypt of the secret) still decrypt, but only where `node:crypto` is available. That path
 * is loaded lazily and is not used for new tokens. When it fails, the error says so.
 *
 * SECURITY: never log the plaintext token, the key material or the encrypted payload.
 */

const FORMAT_V1 = 'v1'
const FORMAT_V2 = 'v2'
const HKDF_INFO = 'seo-analyzer:gsc:v2'
const LEGACY_SCRYPT_SALT = 'seo-analyzer:gsc:v1'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** Throws on input that is not valid base64. */
function fromBase64(value: string): Uint8Array {
  const bin = atob(value)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function fromHex(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** The explicit key from `SEO_GSC_ENCRYPTION_KEY`, or null when unset. Throws when malformed. */
function explicitKey(): Uint8Array | null {
  const raw = typeof process !== 'undefined' ? process.env?.SEO_GSC_ENCRYPTION_KEY : undefined
  if (!raw) return null
  const invalid = new Error('SEO_GSC_ENCRYPTION_KEY must decode to exactly 32 bytes (hex64 or base64).')
  let bytes: Uint8Array
  try {
    bytes = raw.length === 64 && /^[0-9a-f]+$/i.test(raw) ? fromHex(raw) : fromBase64(raw)
  } catch {
    throw invalid
  }
  if (bytes.length !== 32) throw invalid
  return bytes
}

function keyMaterial(secret: string): Uint8Array {
  const explicit = explicitKey()
  if (explicit) return explicit
  if (!secret) {
    throw new Error('No encryption secret available (set SEO_GSC_ENCRYPTION_KEY or Payload secret).')
  }
  return textEncoder.encode(secret)
}

async function deriveV2Key(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', keyMaterial(secret) as BufferSource, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: textEncoder.encode(HKDF_INFO) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptToken(plaintext: string, secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveV2Key(secret, salt)
  const enc = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, textEncoder.encode(plaintext)),
  )
  return [FORMAT_V2, toBase64(salt), toBase64(iv), toBase64(enc)].join(':')
}

async function decryptV2(parts: string[], secret: string): Promise<string> {
  let salt: Uint8Array
  let iv: Uint8Array
  let enc: Uint8Array
  try {
    salt = fromBase64(parts[1])
    iv = fromBase64(parts[2])
    enc = fromBase64(parts[3])
  } catch (cause) {
    throw new Error('Invalid encrypted token format.', { cause })
  }
  const key = await deriveV2Key(secret, salt)
  try {
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc as BufferSource)
    return textDecoder.decode(dec)
  } catch (cause) {
    // WebCrypto's own error carries no message; say what it means.
    throw new Error('Token decryption failed: wrong key (SEO_GSC_ENCRYPTION_KEY / Payload secret changed?) or corrupted data.', {
      cause,
    })
  }
}

/** Legacy format: AES-256-GCM via `node:crypto`; the key is explicit or scrypt(secret). */
async function decryptV1(parts: string[], secret: string): Promise<string> {
  let nodeCrypto: typeof import('node:crypto')
  try {
    nodeCrypto = await import('node:crypto')
  } catch (cause) {
    throw new Error(
      'Token uses the legacy v1 format, which needs node:crypto, and it is not available in this runtime. Disconnect and reconnect Google Search Console.',
      { cause },
    )
  }
  try {
    const explicit = explicitKey()
    if (!explicit && !secret) {
      throw new Error('No encryption secret available (set SEO_GSC_ENCRYPTION_KEY or Payload secret).')
    }
    const key = explicit ? Buffer.from(explicit) : nodeCrypto.scryptSync(secret, LEGACY_SCRYPT_SALT, 32)
    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'))
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8')
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`Legacy v1 token decryption failed: ${reason}`, { cause })
  }
}

/** Throws (never returns an empty string) on a malformed payload, a wrong key or tampering. */
export async function decryptToken(payload: string, secret: string): Promise<string> {
  const parts = payload.split(':')
  if (parts.length !== 4 || (parts[0] !== FORMAT_V2 && parts[0] !== FORMAT_V1)) {
    throw new Error('Invalid encrypted token format.')
  }
  return parts[0] === FORMAT_V2 ? decryptV2(parts, secret) : decryptV1(parts, secret)
}

/** True if a string looks like our encrypted payload (does not validate decryptability). */
export function isEncryptedToken(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parts = value.split(':')
  return parts.length === 4 && (parts[0] === FORMAT_V2 || parts[0] === FORMAT_V1)
}

/** Constant-time string comparison (for OAuth state / CSRF checks and shared-secret headers). */
export function safeEqual(a: string, b: string): boolean {
  const ba = textEncoder.encode(a)
  const bb = textEncoder.encode(b)
  if (ba.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i]
  return diff === 0
}
