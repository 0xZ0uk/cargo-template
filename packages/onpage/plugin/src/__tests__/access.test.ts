import { describe, expect, it } from 'vitest'
import { isUpdateDenied } from '../access.ts'

describe('isUpdateDenied', () => {
  it('allows only the positive shapes; Payload deletes denied operations', () => {
    // Granted.
    expect(isUpdateDenied({ update: true } as never)).toBe(false)
    // Row-level rule awaiting a document (kept with its where clause).
    expect(isUpdateDenied({ update: { permission: true, where: {} } } as never)).toBe(false)
    // Denied: the sanitizer deletes the key, so it arrives missing…
    expect(isUpdateDenied({} as never)).toBe(true)
    // …or as an explicit false in either shape…
    expect(isUpdateDenied({ update: false } as never)).toBe(true)
    expect(isUpdateDenied({ update: { permission: false } } as never)).toBe(true)
    // …and unknown shapes or a thrown access check fail closed.
    expect(isUpdateDenied({ update: { allowed: true } } as never)).toBe(true)
    expect(isUpdateDenied(null)).toBe(true)
  })
})
