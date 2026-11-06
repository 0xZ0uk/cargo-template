import type { PublishedRef } from '../../types/index.js'

import { PLUGIN_SLUG, RETRYABLE_STATUS_CODES } from '../../constants.js'

/**
 * Custom error classes the endpoint handlers throw. Each carries a
 * `statusCode` property the response helper turns into an HTTP status.
 *
 * The `statusCode` convention (not the Web standard `status`) matches
 * Payload's own custom-error classes.
 */

export class PluginError extends Error {
  readonly statusCode: number
  constructor(message: string, statusCode = 500) {
    super(`${PLUGIN_SLUG}: ${message}`)
    this.name = 'PluginError'
    this.statusCode = statusCode
  }
}

export class ValidationError extends PluginError {
  constructor(message: string) {
    super(message, 400)
    this.name = 'ValidationError'
  }
}

export class UnauthorizedError extends PluginError {
  constructor(message = 'unauthenticated') {
    super(message, 401)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends PluginError {
  constructor(message = 'forbidden') {
    super(message, 403)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends PluginError {
  constructor(message = 'not found') {
    super(message, 404)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends PluginError {
  constructor(message: string) {
    super(message, 409)
    this.name = 'ConflictError'
  }
}

export class RateLimitedError extends PluginError {
  /** Seconds the caller should wait before retrying (when known). */
  readonly retryAfterSeconds?: number
  constructor(message = 'rate limited', retryAfterSeconds?: number) {
    super(message, 429)
    this.name = 'RateLimitedError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** One field-level message a provider returned with a rejected request. */
export type PlatformFieldViolation = { field?: string; message: string; reason?: string }

/**
 * Marker for errors that originated upstream from a third-party API. The
 * adapter layer wraps platform-specific errors in this so the publish
 * pipeline can classify them uniformly.
 *
 * - `outcome: 'unknown'`: the platform may have applied the request (a 5xx,
 *   timeout or lost response on a write). The post goes `unknown` and nothing
 *   repeats it until an operator checks the platform.
 * - `retryable`: trying again later can succeed (throttling, a 5xx on a read).
 * - `safeToRepeat`: repeating the whole publish cannot create a second
 *   publication, because the failed request provably created none (see
 *   `classifyRequestFailure`). Defaults to `false`; `isAutoRetrySafe` needs it.
 */
export class PlatformApiError extends PluginError {
  readonly fieldViolations?: PlatformFieldViolation[]
  readonly outcome: 'failed' | 'unknown'
  readonly platform: string
  readonly raw?: unknown
  readonly retryable: boolean
  readonly safeToRepeat: boolean
  readonly upstreamCode?: number | string
  readonly upstreamMessage?: string

  constructor(args: {
    fieldViolations?: PlatformFieldViolation[]
    message: string
    outcome?: 'failed' | 'unknown'
    platform: string
    raw?: unknown
    retryable?: boolean
    safeToRepeat?: boolean
    statusCode?: number
    upstreamCode?: number | string
    upstreamMessage?: string
  }) {
    super(args.message, args.statusCode ?? 502)
    this.name = 'PlatformApiError'
    this.fieldViolations = args.fieldViolations
    this.outcome = args.outcome ?? 'failed'
    this.platform = args.platform
    this.upstreamCode = args.upstreamCode
    this.upstreamMessage = args.upstreamMessage
    this.retryable = args.retryable ?? false
    // An unknown outcome is never safe to repeat, whatever the site claims.
    this.safeToRepeat = this.outcome === 'failed' && (args.safeToRepeat ?? false)
    this.raw = args.raw
  }
}

/**
 * What a platform request does, for classifying its failure:
 *
 * - `idempotent`: reads, status polls and idempotent writes (GET, PUT,
 *   DELETE…). Repeating it cannot create anything.
 * - `prepare`: creates an object that publishes nothing by itself and that the
 *   next attempt replaces (an Instagram container, an unpublished Facebook
 *   photo, a Pinterest media upload). A duplicate is invisible.
 * - `create`: any other write, above all the request that creates the post.
 *   The default for a non-idempotent method.
 */
export type PlatformRequestEffect = 'create' | 'idempotent' | 'prepare'

export type RequestFailureClassification = {
  outcome: 'failed' | 'unknown'
  retryable: boolean
  safeToRepeat: boolean
}

/**
 * The one place that decides what a failed platform request means for the
 * post. A `create` request is `unknown` unless the response proves the
 * platform did not apply it:
 *
 * | Failure on a `create` request                       | outcome   | retryable | safeToRepeat |
 * | --------------------------------------------------- | --------- | --------- | ------------ |
 * | Not sent (`sent: false`)                            | failed    | yes       | yes          |
 * | 429, or a throttle code the platform documents as   | failed    | yes       | yes          |
 * | rejected before processing (`throttled`, on a 4xx)  |           |           |              |
 * | Other 4xx (validation, auth, permission)            | failed    | no        | yes          |
 * | 5xx, 408, 425, no response, timeout, network error, | unknown   | no        | no           |
 * | 2xx the plugin could not read (`status` 2xx)        |           |           |              |
 *
 * `idempotent` and `prepare` requests never create the publication: always
 * `failed` and safe to repeat, retryable on a retryable status, a throttle or a
 * retryable network error.
 */
export const classifyRequestFailure = (args: {
  effect: PlatformRequestEffect
  /** Transport error was retryable (socket reset, timeout…). For `status: undefined`. */
  retryableNetworkError?: boolean
  /** `false` only when the request provably never left the process. */
  sent?: boolean
  /** HTTP status; `undefined` when no response arrived. */
  status?: number
  /** The platform reports a throttle it documents as rejecting the request. */
  throttled?: boolean
}): RequestFailureClassification => {
  const { effect, status } = args
  const sent = args.sent ?? true
  const throttled = args.throttled === true || status === 429
  if (!sent) {
    return { outcome: 'failed', retryable: true, safeToRepeat: true }
  }
  if (effect !== 'create') {
    const retryable =
      status === undefined
        ? args.retryableNetworkError === true
        : throttled || RETRYABLE_STATUS_CODES.has(status)
    return { outcome: 'failed', retryable, safeToRepeat: true }
  }
  if (status === undefined || status < 400 || status >= 500 || status === 408 || status === 425) {
    return { outcome: 'unknown', retryable: false, safeToRepeat: false }
  }
  return { outcome: 'failed', retryable: throttled, safeToRepeat: true }
}

/**
 * Whether Payload's job runner may re-run a publish that threw `error`. The
 * only decision point for automatic publish retries: the platform did not
 * accept the request (`outcome: 'failed'`), trying again can succeed
 * (`retryable`), and the attempt provably created no publication
 * (`safeToRepeat`, set only through `classifyRequestFailure` or an explicit
 * pre-creation site). Any other error, including errors from outside the
 * platform clients, fails the job without a retry.
 */
export const isAutoRetrySafe = (error: unknown): boolean =>
  error instanceof PlatformApiError &&
  error.outcome === 'failed' &&
  error.retryable &&
  error.safeToRepeat

export class PublicationPersistenceError extends PluginError {
  readonly cause: unknown
  readonly outcome = 'unknown'
  readonly publishedRef: PublishedRef

  constructor(publishedRef: PublishedRef, cause: unknown) {
    super(
      'The provider accepted the publication, but its local audit record could not be finalized.',
      500,
    )
    this.name = 'PublicationPersistenceError'
    this.cause = cause
    this.publishedRef = publishedRef
  }
}

export const hasUnknownPublicationOutcome = (error: unknown): boolean =>
  error instanceof PublicationPersistenceError ||
  (error instanceof PlatformApiError && error.outcome === 'unknown')

export const getUnknownPublicationRef = (error: unknown): PublishedRef | undefined =>
  error instanceof PublicationPersistenceError ? error.publishedRef : undefined
