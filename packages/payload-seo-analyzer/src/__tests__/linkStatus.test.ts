import { describe, expect, it } from 'vitest'

import { classifyLink, countLinkStates, UNVERIFIED_STATUSES } from '../helpers/linkStatus.js'

describe('classifyLink', () => {
  it('puts every kind of result in exactly one bucket', () => {
    const at = (status: number, ok = false, error?: string) => classifyLink({ status, ok, ...(error && { error }) })
    expect(at(200, true)).toBe('ok')
    expect(at(404)).toBe('broken')
    expect(at(410)).toBe('broken')
    expect(at(500)).toBe('broken')
    expect(at(503)).toBe('broken')
    expect(at(0, false, 'timeout')).toBe('timeout')
    expect(at(0, false, 'blocked-private-ip')).toBe('blocked')
    expect(at(0, false, 'dns')).toBe('error')
    expect(at(0, false, 'ssl')).toBe('error')
    expect(at(0, false, 'connection')).toBe('error')
    expect(at(301, false, 'too-many-redirects')).toBe('error')
    expect(at(0, false, 'something-new')).toBe('error')
  })

  it('treats rate limits and bot walls as unverified, not broken', () => {
    for (const status of [401, 403, 429, 451, 999]) {
      expect(classifyLink({ status, ok: false })).toBe('unverified')
    }
    expect([...UNVERIFIED_STATUSES].sort()).toEqual([401, 403, 429, 451, 999])
  })

  it('keeps 404, 410 and 5xx as broken (the documented set is not wider)', () => {
    for (const status of [400, 404, 405, 410, 500, 502, 503, 520]) {
      expect(classifyLink({ status, ok: false })).toBe('broken')
    }
  })
})

describe('countLinkStates', () => {
  it('adds up to total', () => {
    const stats = countLinkStates([
      { status: 200, ok: true },
      { status: 200, ok: true },
      { status: 404, ok: false },
      { status: 429, ok: false },
      { status: 999, ok: false },
      { status: 0, ok: false, error: 'timeout' },
      { status: 0, ok: false, error: 'dns' },
      { status: 0, ok: false, error: 'blocked-private-ip' },
    ])
    expect(stats).toEqual({ total: 8, ok: 2, broken: 1, timeout: 1, error: 1, blocked: 1, unverified: 2 })
    expect(stats.ok + stats.broken + stats.timeout + stats.error + stats.blocked + stats.unverified).toBe(stats.total)
  })

  it('is all zeros for no results', () => {
    expect(countLinkStates([])).toEqual({ total: 0, ok: 0, broken: 0, timeout: 0, error: 0, blocked: 0, unverified: 0 })
  })
})
