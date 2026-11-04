import { createCipheriv, randomBytes, scryptSync } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { encryptToken, decryptToken, isEncryptedToken, safeEqual } from '../helpers/tokenCrypto'

const SECRET = 'test-secret-please-ignore-0123456789abcdef'
const HEX_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'

afterEach(() => {
  delete process.env.SEO_GSC_ENCRYPTION_KEY
})

/** The pre-WebCrypto format, built the way the old `encryptToken` did (scrypt + node:crypto). */
function legacyV1(plaintext: string, secret: string, explicitKey?: Buffer): string {
  const key = explicitKey ?? scryptSync(secret, 'seo-analyzer:gsc:v1', 32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':')
}

describe('tokenCrypto (GSC refresh-token at rest)', () => {
  it('round-trips a token (v2) and never stores it in plaintext', async () => {
    const enc = await encryptToken('refresh-abc-123', SECRET)
    expect(enc.startsWith('v2:')).toBe(true)
    expect(enc).not.toContain('refresh-abc-123')
    expect(isEncryptedToken(enc)).toBe(true)
    expect(await decryptToken(enc, SECRET)).toBe('refresh-abc-123')
  })

  it('round-trips non-ASCII and long tokens', async () => {
    const token = `1//0é✓-${'x'.repeat(2000)}`
    expect(await decryptToken(await encryptToken(token, SECRET), SECRET)).toBe(token)
  })

  it('produces a different ciphertext each time (random IV and salt)', async () => {
    expect(await encryptToken('x', SECRET)).not.toBe(await encryptToken('x', SECRET))
  })

  it('fails loudly with the wrong secret', async () => {
    const enc = await encryptToken('secret-token', SECRET)
    await expect(decryptToken(enc, 'a-completely-different-secret')).rejects.toThrow(/wrong key/)
  })

  it('detects tampering via the GCM auth tag', async () => {
    const enc = await encryptToken('secret-token', SECRET)
    const parts = enc.split(':')
    const swapped = parts[3][0] === 'A' ? 'B' : 'A'
    const tampered = [parts[0], parts[1], parts[2], swapped + parts[3].slice(1)].join(':')
    await expect(decryptToken(tampered, SECRET)).rejects.toThrow(/wrong key|corrupted/)
  })

  it('rejects malformed payloads', async () => {
    await expect(decryptToken('not-a-valid-payload', SECRET)).rejects.toThrow('Invalid encrypted token format.')
    await expect(decryptToken('v9:a:b:c', SECRET)).rejects.toThrow('Invalid encrypted token format.')
    await expect(decryptToken('v2:***:***:***', SECRET)).rejects.toThrow('Invalid encrypted token format.')
    expect(isEncryptedToken('nope')).toBe(false)
    expect(isEncryptedToken(42)).toBe(false)
  })

  it('needs a secret or an explicit key', async () => {
    await expect(encryptToken('x', '')).rejects.toThrow(/No encryption secret/)
  })

  describe('SEO_GSC_ENCRYPTION_KEY', () => {
    it('is used instead of the secret (hex)', async () => {
      process.env.SEO_GSC_ENCRYPTION_KEY = HEX_KEY
      const enc = await encryptToken('tok', SECRET)
      // Same explicit key, a different Payload secret: still decrypts.
      expect(await decryptToken(enc, 'rotated-payload-secret')).toBe('tok')
      delete process.env.SEO_GSC_ENCRYPTION_KEY
      await expect(decryptToken(enc, SECRET)).rejects.toThrow(/wrong key/)
    })

    it('accepts base64', async () => {
      process.env.SEO_GSC_ENCRYPTION_KEY = Buffer.from(HEX_KEY, 'hex').toString('base64')
      const enc = await encryptToken('tok', '')
      expect(await decryptToken(enc, '')).toBe('tok')
    })

    it('rejects a key that is not 32 bytes', async () => {
      process.env.SEO_GSC_ENCRYPTION_KEY = 'abcd'
      await expect(encryptToken('x', SECRET)).rejects.toThrow(/exactly 32 bytes/)
      process.env.SEO_GSC_ENCRYPTION_KEY = '!!!not base64!!!'
      await expect(encryptToken('x', SECRET)).rejects.toThrow(/exactly 32 bytes/)
    })
  })

  describe('legacy v1 tokens (node:crypto + scrypt)', () => {
    it('still decrypt with the Payload secret', async () => {
      const old = legacyV1('old-refresh-token', SECRET)
      expect(isEncryptedToken(old)).toBe(true)
      expect(await decryptToken(old, SECRET)).toBe('old-refresh-token')
    })

    it('still decrypt with an explicit key', async () => {
      process.env.SEO_GSC_ENCRYPTION_KEY = HEX_KEY
      const old = legacyV1('old-refresh-token', SECRET, Buffer.from(HEX_KEY, 'hex'))
      expect(await decryptToken(old, 'ignored')).toBe('old-refresh-token')
    })

    it('fail loudly with the wrong secret or a tampered tag', async () => {
      const old = legacyV1('old-refresh-token', SECRET)
      await expect(decryptToken(old, 'wrong-secret')).rejects.toThrow(/Legacy v1 token decryption failed/)
      const parts = old.split(':')
      parts[2] = Buffer.alloc(16).toString('base64')
      await expect(decryptToken(parts.join(':'), SECRET)).rejects.toThrow(/Legacy v1 token decryption failed/)
    })
  })

  it('safeEqual is correct for equal, different, and different-length inputs', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
    expect(safeEqual('é', 'é')).toBe(true)
    expect(safeEqual('é', 'e')).toBe(false)
  })
})
