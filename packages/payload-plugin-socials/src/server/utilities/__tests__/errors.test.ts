import { describe, expect, it } from 'vitest'

import {
  classifyRequestFailure,
  ConflictError,
  ForbiddenError,
  isAutoRetrySafe,
  NotFoundError,
  PlatformApiError,
  PluginError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
} from '../errors.js'

describe('PluginError taxonomy', () => {
  it('prefixes the message with the plugin slug and defaults to 500', () => {
    const err = new PluginError('something broke')
    expect(err).toBeInstanceOf(Error)
    expect(err.statusCode).toBe(500)
    expect(err.message).toContain('payload-plugin-socials:')
    expect(err.message).toContain('something broke')
  })

  it('honours an explicit status code', () => {
    expect(new PluginError('teapot', 418).statusCode).toBe(418)
  })

  it.each([
    [new ValidationError('bad input'), 400, 'ValidationError'],
    [new UnauthorizedError(), 401, 'UnauthorizedError'],
    [new ForbiddenError(), 403, 'ForbiddenError'],
    [new NotFoundError(), 404, 'NotFoundError'],
    [new ConflictError('dup'), 409, 'ConflictError'],
  ])('%s maps to the right status and name', (err, status, name) => {
    expect(err).toBeInstanceOf(PluginError)
    expect(err.statusCode).toBe(status)
    expect(err.name).toBe(name)
  })

  it('RateLimitedError carries an optional retryAfterSeconds', () => {
    const err = new RateLimitedError('slow down', 30)
    expect(err.statusCode).toBe(429)
    expect(err.retryAfterSeconds).toBe(30)
    expect(new RateLimitedError().retryAfterSeconds).toBeUndefined()
  })
})

describe('PlatformApiError', () => {
  it('defaults statusCode to 502 and retryable to false', () => {
    const err = new PlatformApiError({ message: 'upstream down', platform: 'pinterest' })
    expect(err).toBeInstanceOf(PluginError)
    expect(err.statusCode).toBe(502)
    expect(err.platform).toBe('pinterest')
    expect(err.retryable).toBe(false)
  })

  it('carries upstream metadata and the retryable flag', () => {
    const err = new PlatformApiError({
      message: 'rate limited',
      platform: 'instagram',
      raw: { code: 4 },
      retryable: true,
      statusCode: 429,
      upstreamCode: 4,
      upstreamMessage: 'too many calls',
    })
    expect(err.statusCode).toBe(429)
    expect(err.retryable).toBe(true)
    expect(err.upstreamCode).toBe(4)
    expect(err.upstreamMessage).toBe('too many calls')
    expect(err.raw).toEqual({ code: 4 })
  })
})

describe('classifyRequestFailure / isAutoRetrySafe', () => {
  const unknown = { outcome: 'unknown', retryable: false, safeToRepeat: false }
  it.each([
    ['create, 500', { effect: 'create', status: 500 }, unknown],
    ['create, 501', { effect: 'create', status: 501 }, unknown],
    ['create, 503', { effect: 'create', status: 503 }, unknown],
    ['create, 408', { effect: 'create', status: 408 }, unknown],
    ['create, 425', { effect: 'create', status: 425 }, unknown],
    ['create, no response (timeout)', { effect: 'create', retryableNetworkError: true }, unknown],
    ['create, unreadable 2xx', { effect: 'create', status: 200 }, unknown],
    [
      'create, 429',
      { effect: 'create', status: 429 },
      { outcome: 'failed', retryable: true, safeToRepeat: true },
    ],
    [
      'create, documented throttle on a 400',
      { effect: 'create', status: 400, throttled: true },
      { outcome: 'failed', retryable: true, safeToRepeat: true },
    ],
    [
      'create, 400',
      { effect: 'create', status: 400 },
      { outcome: 'failed', retryable: false, safeToRepeat: true },
    ],
    [
      'create, not sent',
      { effect: 'create', sent: false },
      { outcome: 'failed', retryable: true, safeToRepeat: true },
    ],
    [
      'prepare, 500',
      { effect: 'prepare', status: 500 },
      { outcome: 'failed', retryable: true, safeToRepeat: true },
    ],
    [
      'idempotent, 503',
      { effect: 'idempotent', status: 503 },
      { outcome: 'failed', retryable: true, safeToRepeat: true },
    ],
    [
      'idempotent, 404',
      { effect: 'idempotent', status: 404 },
      { outcome: 'failed', retryable: false, safeToRepeat: true },
    ],
    [
      'idempotent, retryable network error',
      { effect: 'idempotent', retryableNetworkError: true },
      { outcome: 'failed', retryable: true, safeToRepeat: true },
    ],
  ] as const)('%s', (_label, args, expected) => {
    expect(classifyRequestFailure(args)).toEqual(expected)
  })

  it('lets Payload retry only a failed, retryable error that is safe to repeat', () => {
    const make = (over: Record<string, unknown>) =>
      new PlatformApiError({ message: 'x', platform: 'facebook', ...over })
    expect(isAutoRetrySafe(make({ retryable: true, safeToRepeat: true }))).toBe(true)
    expect(isAutoRetrySafe(make({ retryable: true }))).toBe(false)
    expect(isAutoRetrySafe(make({ safeToRepeat: true }))).toBe(false)
    // An unknown outcome is never safe to repeat, whatever the site claims.
    const unknownError = make({ outcome: 'unknown', retryable: true, safeToRepeat: true })
    expect(unknownError.safeToRepeat).toBe(false)
    expect(isAutoRetrySafe(unknownError)).toBe(false)
    expect(isAutoRetrySafe(new Error('boom'))).toBe(false)
  })
})
