/**
 * Authenticated encryption for small payloads (AES-256-GCM, key derived with
 * HKDF-SHA256 from a secret and a purpose). Uses WebCrypto only, so the same
 * code runs in Node, the browser and edge runtimes (Next.js proxy).
 *
 * Used for preview-link tokens, the preview cookie and the editor's mode
 * cookie: tamper-proof, opaque to the holder, and bound to one purpose (a
 * token can't be replayed as a cookie).
 */
import { isOnPageMode, type OnPageMode } from './ports.ts'

const enc = new TextEncoder()
const dec = new TextDecoder()
const keys = new Map<string, Promise<CryptoKey>>()

export const SEAL_PURPOSE = {
  previewLink: 'payload-onpage:preview-link:v1',
  previewCookie: 'payload-onpage:preview-cookie:v1',
  modeCookie: 'payload-onpage:mode-cookie:v1',
} as const

function key(secret: string, purpose: string): Promise<CryptoKey> {
  const id = `${purpose}\u0000${secret}`
  let k = keys.get(id)
  if (!k) {
    k = (async () => {
      const ikm = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, [
        'deriveKey',
      ])
      return crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: enc.encode('payload-onpage'),
          info: enc.encode(purpose),
        },
        ikm,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      )
    })()
    keys.set(id, k)
  }
  return k
}

const toB64url = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64url = (s: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

/**
 * One secret, or a keyring for rotating it: `[current, ...previous]`. The first
 * seals; any of them unseals, so links and cookies sealed before a rotation
 * keep working until they expire.
 */
export type SealSecret = string | readonly string[]

const secretsOf = (secret: SealSecret): readonly string[] =>
  (typeof secret === 'string' ? [secret] : secret).filter(Boolean)

/** Encrypt and authenticate `data` (JSON) for `purpose`, with the current secret. */
export async function seal(
  data: unknown,
  secretOrRing: SealSecret,
  purpose: string,
): Promise<string> {
  const secret = secretsOf(secretOrRing)[0]
  if (!secret) throw new Error('payload-onpage: a secret is required to seal data')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await key(secret, purpose),
      enc.encode(JSON.stringify(data)),
    ),
  )
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return toB64url(out)
}

/** Decrypt a sealed value; null if it was tampered with, sealed for another purpose or secret, or malformed. */
export async function unseal<T>(
  token: string | null | undefined,
  secret: SealSecret,
  purpose: string,
): Promise<T | null> {
  if (!token || token.length > 8192) return null
  const bytes = fromB64url(token)
  if (!bytes || bytes.length < 13 + 16) return null
  for (const s of secretsOf(secret)) {
    try {
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes.slice(0, 12) },
        await key(s, purpose),
        bytes.slice(12),
      )
      return JSON.parse(dec.decode(pt)) as T
    } catch {
      // Not this secret: try the next one.
    }
  }
  return null
}

/** SHA-256 hex digest (WebCrypto). */
export async function sha256(input: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(input)))
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The sealed `onpage_preview` cookie a share link sets: which page it opens
 * and until when. Written by the plugin, read by the framework adapter.
 */
export interface PreviewGrant {
  /** The page's pathname. */
  path: string
  /** The document's ref key. */
  ref: string
  /** Expiry, seconds since the epoch. */
  exp: number
  /** The draft credential for that page (adapter-specific: Next's draft-mode secret on Next.js, a constant marker where reads verify the grant directly). */
  draft: string
  /** The preview link's id (its `jti`), for per-link limits. */
  id?: string
}

/** A well-formed grant that hasn't expired. Anything else, including a missing `exp`, is refused. */
export function isLivePreviewGrant(value: unknown, now = Date.now()): value is PreviewGrant {
  if (!value || typeof value !== 'object') return false
  const g = value as Partial<Record<keyof PreviewGrant, unknown>>
  return (
    typeof g.path === 'string' &&
    typeof g.ref === 'string' &&
    typeof g.draft === 'string' &&
    !!g.draft &&
    typeof g.exp === 'number' &&
    Number.isFinite(g.exp) &&
    g.exp * 1000 > now
  )
}

/** Seals a mode cookie's plain part until `expiresAt` (the plugin binds its secret). */
export type SealMode = (plain: string, expiresAt: Date) => Promise<string>

/** What a mode cookie's seal holds: its plain part, and an expiry in seconds since the epoch. */
interface ModeSeal {
  v: string
  exp: number
}

/** A `SealMode` for `secret`: what the plugin hands session adapters, and the proxy uses for viewers. */
export const modeSealer =
  (secret: SealSecret): SealMode =>
  (plain, expiresAt) =>
    seal(
      { v: plain, exp: Math.floor(expiresAt.getTime() / 1000) } satisfies ModeSeal,
      secret,
      SEAL_PURPOSE.modeCookie,
    )

const HASH_LENGTH = 32
const fingerprint = async (token: string) => (await sha256(token)).slice(0, HASH_LENGTH)

/**
 * The editor's `onpage` mode cookie: `<plain>.<seal>`, where `<plain>` is
 * `<mode>`, or `<mode>:<authCookie>:<hash of its value>` when bound to a
 * session. The plain part lets readers without the secret (Next server
 * components, behind the proxy) see the mode; the seal makes it unforgeable
 * for readers with it (the proxy, TanStack Start reads).
 */
export async function createModeCookie(
  mode: OnPageMode,
  opts: {
    sealMode: SealMode
    expiresAt: Date
    /** The auth cookie to bind to, and its current value. */
    bindTo?: string | undefined
    token?: string | undefined
  },
): Promise<string> {
  const plain =
    opts.bindTo && opts.token ? `${mode}:${opts.bindTo}:${await fingerprint(opts.token)}` : mode
  return `${plain}.${await opts.sealMode(plain, opts.expiresAt)}`
}

export interface ModeCookie {
  mode: OnPageMode
  /** True when bound to an auth cookie that is present and matches. */
  bound: boolean
}

/**
 * Parse a mode cookie; null when malformed, unsealed, expired, sealed with
 * another secret, or bound to a session that ended. Pass the secret wherever
 * it's available: without it (`null`) only the shape and the binding are
 * checked, so such readers must sit behind one that verifies (the Next proxy
 * strips cookies that don't).
 */
export async function readModeCookie(
  raw: string | null | undefined,
  cookie: (name: string) => string | undefined,
  secret: SealSecret | null,
  now = Date.now(),
): Promise<ModeCookie | null> {
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot <= 0 || dot === raw.length - 1) return null
  const plain = raw.slice(0, dot)
  if (secret !== null) {
    const sealed = await unseal<Partial<ModeSeal>>(
      raw.slice(dot + 1),
      secret,
      SEAL_PURPOSE.modeCookie,
    )
    if (!sealed || sealed.v !== plain) return null
    if (typeof sealed.exp !== 'number' || !Number.isFinite(sealed.exp) || sealed.exp * 1000 <= now)
      return null
  }
  const [mode, bound, hash, ...rest] = plain.split(':')
  if (!isOnPageMode(mode) || rest.length) return null
  if (bound === undefined) return { mode, bound: false }
  const token = bound ? cookie(bound) : undefined
  if (!token || !hash || (await fingerprint(token)) !== hash) return null
  return { mode, bound: true }
}
