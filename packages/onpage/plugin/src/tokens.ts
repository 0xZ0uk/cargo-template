/**
 * Preview-link tokens: sealed (AES-GCM) and expiring, bound to one document
 * and path. Opaque to the holder, so the link reveals nothing about the draft.
 */
import { SEAL_PURPOSE, seal, unseal, type SealSecret } from '@shipment/onpage-core'

export interface PreviewTokenPayload {
  /** refKey of the shared document */
  ref: string
  /** Site path the link opens. */
  path: string
  locale?: string
  /** Issued at / expires at, seconds since epoch. */
  iat: number
  exp: number
  /** Unique id, for audit logs and revocation lists. */
  jti: string
}

export async function createPreviewToken(
  payload: Pick<PreviewTokenPayload, 'ref' | 'path' | 'locale'>,
  secret: SealSecret,
  ttlSeconds: number,
  now = Date.now(),
): Promise<{ token: string; payload: PreviewTokenPayload }> {
  const iat = Math.floor(now / 1000)
  const full: PreviewTokenPayload = {
    ...payload,
    iat,
    exp: iat + ttlSeconds,
    jti: crypto.randomUUID(),
  }
  return { token: await seal(full, secret, SEAL_PURPOSE.previewLink), payload: full }
}

export async function verifyPreviewToken(
  token: string,
  secret: SealSecret,
  now = Date.now(),
): Promise<PreviewTokenPayload | null> {
  const p = await unseal<PreviewTokenPayload>(token, secret, SEAL_PURPOSE.previewLink)
  if (!p || typeof p.exp !== 'number' || p.exp * 1000 <= now) return null
  if (typeof p.path !== 'string' || typeof p.ref !== 'string' || typeof p.jti !== 'string')
    return null
  return p
}
