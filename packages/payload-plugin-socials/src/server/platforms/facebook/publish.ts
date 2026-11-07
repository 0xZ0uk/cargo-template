import type { Payload, PayloadRequest } from 'payload'

import type {
  NormalizedPluginOptions,
  PublishedRef,
  PublishResult,
  ReconcileVerdict,
  SocialSourceContext,
} from '../../../types/index.js'

import { resolvePlatformImageUrl } from '../../assets/resolvePlatformImage.js'
import { resolveConfiguredText } from '../../copy/resolveConfiguredCopy.js'
import {
  classifyRequestFailure,
  PlatformApiError,
  type PlatformRequestEffect,
  ValidationError,
} from '../../utilities/errors.js'
import { sha256Hex } from '../../utilities/hash.js'
import { createPluginLogger } from '../../utilities/logger.js'
import { makeMetaRequest, readMetaJson } from '../_meta/api.js'
import { buildDefaultFacebookMessage } from './copy.js'
import { getPageAccessToken } from './pages.js'

/**
 * Facebook Page publish path.
 *
 * Three formats supported in v1:
 *   - LINK    : `POST /{page-id}/feed` with `message` + `link`
 *   - PHOTO   : `POST /{page-id}/photos` with `url` (single) OR multi-photo
 *               assembly via `published=false` children + `attached_media`
 *   - VIDEO   : `POST /{page-id}/videos` with `file_url` (Meta fetches it).
 *               This matches the plugin's URL-based source media contract and
 *               avoids proxying large video files through the Payload host.
 *
 * The publish path uses the **Page-scoped access token** (not the user
 * token), derived on demand via `/{page-id}?fields=access_token`. The
 * `_meta/api` client passes whatever token is in the Authorization header
 * verbatim, so we override it inline for these calls.
 *
 * Returns the post and the audit fields; the publication ledger owns the
 * `social-posts` row and the idempotency key (`buildPublicationIdentity`).
 *
 * Image conversion (assets.autoConvert) happens ONLY when constructing the
 * outbound Facebook API request body. The converted URL never touches the
 * audit record or the sourceHash, which use the ORIGINAL input URL.
 */

export const FACEBOOK_FORMATS = ['LINK', 'PHOTO', 'PHOTO_MULTI', 'VIDEO'] as const
export type FacebookFormat = (typeof FACEBOOK_FORMATS)[number]

export type FacebookPublishInput = {
  /** PHOTO: optional alt text. */
  altText?: string
  /** Format. Default `LINK`. */
  format?: FacebookFormat
  /** Exact legacy SHA-256 identity used when adopting an existing audit row. */
  idempotencyKeyOverride?: string
  /** PHOTO: single photo URL. */
  imageUrl?: string
  /** PHOTO_MULTI: array of public URLs (2-10). */
  imageUrls?: string[]
  /** LINK: link URL (defaults to ctx.link). */
  link?: string
  /** Message override (falls back to transformations → copyOverrides → default builder). */
  message?: string
  /** Page id to publish to. Required. */
  pageId: string
  /** Optional location tag (FB Page id of a place). */
  place?: string
  /** Caller-defined logical publication identity for intentional repeat campaigns. */
  publicationKey?: string
  publishedByUserId?: number | string
  /**
   * Schedule the post. 10-minute min, 75-day max from now for /feed.
   * For videos the max is 6 months. ISO-8601 string.
   */
  scheduledPublishTime?: string
  /** VIDEO: optional title. */
  videoTitle?: string
  /** VIDEO: public video URL Meta fetches. */
  videoUrl?: string
}

type FeedResponse = { id: string; post_id?: string }
type PhotoResponse = { id: string; post_id?: string }
type VideoResponse = { id: string; post_id?: string }

const SCHEDULE_MIN_OFFSET_MS = 10 * 60 * 1000
const SCHEDULE_FEED_MAX_OFFSET_MS = 75 * 24 * 60 * 60 * 1000
const SCHEDULE_VIDEO_MAX_OFFSET_MS = 6 * 30 * 24 * 60 * 60 * 1000

const resolveMessage = (
  ctx: SocialSourceContext,
  input: FacebookPublishInput,
  options: NormalizedPluginOptions,
): string => {
  const resolved = resolveConfiguredText(
    'facebookMessage',
    ctx,
    options,
    buildDefaultFacebookMessage,
  )
  return input.message?.trim() || resolved
}

const validateSchedule = (
  isoTime: string | undefined,
  format: FacebookFormat,
): number | undefined => {
  if (!isoTime) {
    return undefined
  }
  const ms = Date.parse(isoTime)
  if (Number.isNaN(ms)) {
    throw new ValidationError(`scheduledPublishTime is not a valid ISO-8601 string: ${isoTime}`)
  }
  const offsetMs = ms - Date.now()
  if (offsetMs < SCHEDULE_MIN_OFFSET_MS) {
    throw new ValidationError('scheduledPublishTime must be at least 10 minutes in the future')
  }
  const maxOffset = format === 'VIDEO' ? SCHEDULE_VIDEO_MAX_OFFSET_MS : SCHEDULE_FEED_MAX_OFFSET_MS
  if (offsetMs > maxOffset) {
    const cap = format === 'VIDEO' ? '6 months' : '75 days'
    throw new ValidationError(`scheduledPublishTime must be within ${cap}`)
  }
  // Meta expects seconds since epoch.
  return Math.floor(ms / 1000)
}

/**
 * Redirect-safe fallback permalink when the canonical lookup fails. The bare
 * /{post_id} form redirects correctly on both classic and new-experience
 * Pages; the /{page_id}/posts/{post_id} form must never be constructed (the
 * public-URL page id differs from the API page id on new-experience Pages).
 */
const buildFallbackPermalink = (externalId: string, format: FacebookFormat): string => {
  const [page, post] = externalId.split('_')
  if (page && post) {
    return `https://www.facebook.com/${post}`
  }
  return format === 'VIDEO'
    ? `https://www.facebook.com/watch/?v=${externalId}`
    : `https://www.facebook.com/${externalId}`
}

/**
 * Best-effort fetch of the canonical `permalink_url` for a just-published post.
 * Returns `undefined` on any failure; the caller falls back to
 * `buildFallbackPermalink`.
 */
const fetchFacebookPermalinkUrl = async (
  payload: Payload,
  options: NormalizedPluginOptions,
  pageAccessToken: string,
  externalId: string,
): Promise<string | undefined> => {
  try {
    const response = await makeMetaRequest(
      payload,
      options,
      'facebook',
      `/${encodeURIComponent(externalId)}?fields=permalink_url`,
      { accessToken: pageAccessToken },
    )
    if (!response.ok) {
      return undefined
    }
    const result = (await response.json()) as { permalink_url?: string }
    return result.permalink_url?.trim() || undefined
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Per-format publish helpers (use Page access token explicitly)
// ---------------------------------------------------------------------------

/**
 * POST with the Page token, read through `readMetaJson` so the failure is classified
 * like every other Meta write (`classifyRequestFailure`): a 5xx, timeout or
 * unreadable 2xx on a request that creates the post is `outcome: 'unknown'`
 * and never repeated automatically. `effect: 'prepare'` is for uploads that
 * publish nothing by themselves (unpublished photos for a multi-photo post).
 */
const postWithPageToken = async <T>(
  payload: Payload,
  options: NormalizedPluginOptions,
  path: string,
  body: Record<string, unknown>,
  pageAccessToken: string,
  effect: PlatformRequestEffect = 'create',
): Promise<T> => {
  // Page publishing requires the derived Page token, not the parent user or
  // system token used for discovery.
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) {
      continue
    }
    if (typeof v === 'object') {
      params.set(k, JSON.stringify(v))
    } else if (typeof v === 'string') {
      params.set(k, v)
    } else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
      params.set(k, String(v))
    }
  }

  // Reuse the Meta client so Page-scoped calls retain retries, quota tracking,
  // appsecret_proof computed from the Page token, and failure classification.
  const response = await makeMetaRequest(payload, options, 'facebook', path, {
    accessToken: pageAccessToken,
    effect,
    init: {
      body: params.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    },
  })
  return readMetaJson<T>(response, { effect, path, platform: 'facebook' })
}

const publishLinkPost = async (
  payload: Payload,
  options: NormalizedPluginOptions,
  input: FacebookPublishInput,
  message: string,
  pageAccessToken: string,
  scheduledSeconds?: number,
): Promise<FeedResponse> => {
  const body: Record<string, unknown> = { message }
  if (input.link) {
    body.link = input.link
  }
  if (input.place) {
    body.place = input.place
  }
  if (scheduledSeconds) {
    body.scheduled_publish_time = scheduledSeconds
    body.published = false
  }
  return postWithPageToken<FeedResponse>(
    payload,
    options,
    `/${encodeURIComponent(input.pageId)}/feed`,
    body,
    pageAccessToken,
  )
}

/**
 * Upload a single photo unpublished, using the given outbound URL (may be
 * a converted rendition). The original URL is used for key derivation only.
 */
const uploadPhotoUnpublished = async (
  payload: Payload,
  options: NormalizedPluginOptions,
  pageId: string,
  outboundImageUrl: string,
  pageAccessToken: string,
  altText?: string,
): Promise<PhotoResponse> => {
  const body: Record<string, unknown> = { published: false, url: outboundImageUrl }
  if (altText) {
    body.alt_text_custom = altText
  }
  return postWithPageToken<PhotoResponse>(
    payload,
    options,
    `/${encodeURIComponent(pageId)}/photos`,
    body,
    pageAccessToken,
    'prepare',
  )
}

/**
 * Publish a single PHOTO using the outbound URL (may be converted).
 * The sourceHash uses the ORIGINAL input.imageUrl.
 */
const publishSinglePhoto = async (
  payload: Payload,
  options: NormalizedPluginOptions,
  input: FacebookPublishInput,
  message: string,
  pageAccessToken: string,
  outboundImageUrl: string,
  scheduledSeconds?: number,
): Promise<PhotoResponse> => {
  if (!outboundImageUrl) {
    throw new ValidationError('imageUrl is required for PHOTO')
  }
  const body: Record<string, unknown> = {
    caption: message,
    url: outboundImageUrl,
  }
  if (input.altText) {
    body.alt_text_custom = input.altText
  }
  if (input.place) {
    body.place = input.place
  }
  if (scheduledSeconds) {
    body.scheduled_publish_time = scheduledSeconds
    body.published = false
  }
  return postWithPageToken<PhotoResponse>(
    payload,
    options,
    `/${encodeURIComponent(input.pageId)}/photos`,
    body,
    pageAccessToken,
  )
}

/**
 * Publish a PHOTO_MULTI post. Each image is resolved to its outbound URL
 * (possibly converted) just before the individual upload. The
 * sourceHash uses the ORIGINAL first URL.
 */
const publishMultiPhoto = async (
  payload: Payload,
  options: NormalizedPluginOptions,
  input: FacebookPublishInput,
  message: string,
  pageAccessToken: string,
  scheduledSeconds?: number,
): Promise<FeedResponse> => {
  if (!input.imageUrls || input.imageUrls.length < 2 || input.imageUrls.length > 10) {
    throw new ValidationError('PHOTO_MULTI requires 2–10 entries in imageUrls')
  }

  // Step 1: resolve each URL to its outbound form, then upload unpublished.
  const uploaded = await Promise.all(
    input.imageUrls.map(async (url) => {
      const resolved = await resolvePlatformImageUrl({
        imageUrl: url,
        options,
        payload,
        platform: 'facebook',
      })
      return uploadPhotoUnpublished(payload, options, input.pageId, resolved.url, pageAccessToken)
    }),
  )
  const mediaIds = uploaded.map((result) => result.id)

  // Step 2: create the parent /feed post with attached_media.
  const body: Record<string, unknown> = {
    attached_media: mediaIds.map((id) => ({ media_fbid: id })),
    message,
  }
  if (input.place) {
    body.place = input.place
  }
  if (scheduledSeconds) {
    body.scheduled_publish_time = scheduledSeconds
    body.published = false
  }
  return postWithPageToken<FeedResponse>(
    payload,
    options,
    `/${encodeURIComponent(input.pageId)}/feed`,
    body,
    pageAccessToken,
  )
}

const publishVideo = async (
  payload: Payload,
  options: NormalizedPluginOptions,
  input: FacebookPublishInput,
  message: string,
  pageAccessToken: string,
  scheduledSeconds?: number,
): Promise<VideoResponse> => {
  if (!input.videoUrl) {
    throw new ValidationError('videoUrl is required for VIDEO')
  }
  const body: Record<string, unknown> = {
    description: message,
    file_url: input.videoUrl,
  }
  if (input.videoTitle) {
    body.title = input.videoTitle
  }
  if (scheduledSeconds) {
    body.scheduled_publish_time = scheduledSeconds
    body.published = false
  }
  return postWithPageToken<VideoResponse>(
    payload,
    options,
    `/${encodeURIComponent(input.pageId)}/videos`,
    body,
    pageAccessToken,
  )
}

const resolvePrimaryAssetUrl = (input: FacebookPublishInput): string => {
  switch (input.format ?? 'LINK') {
    case 'PHOTO':
      return input.imageUrl ?? ''
    case 'PHOTO_MULTI':
      return input.imageUrls?.[0] ?? ''
    case 'VIDEO':
      return input.videoUrl ?? ''
    case 'LINK':
    default:
      return input.link ?? ''
  }
}

export const publishFacebookPost = async (args: {
  ctx: SocialSourceContext
  input: FacebookPublishInput
  options: NormalizedPluginOptions
  payload: Payload
  req?: PayloadRequest
}): Promise<PublishResult> => {
  const { ctx, input, options, payload } = args
  if (!input.pageId) {
    throw new ValidationError('pageId is required')
  }
  const format: FacebookFormat = input.format ?? 'LINK'

  const message = resolveMessage(ctx, input, options)

  // The sourceHash uses the ORIGINAL input URL, never a converted one.
  const primaryAssetUrl = resolvePrimaryAssetUrl(input)

  if (format === 'LINK' && !input.link && !primaryAssetUrl) {
    // /feed accepts a text-only post if `message` is non-empty.
    if (!message.trim()) {
      throw new ValidationError('Facebook posts need message, link, photo, or video')
    }
  }

  const pageAccessToken = await getPageAccessToken(payload, options, input.pageId)
  const scheduledSeconds = validateSchedule(input.scheduledPublishTime, format)

  let externalId: string
  let raw: unknown
  switch (format) {
    case 'LINK': {
      const linkResult = {
        ...input,
        link: input.link ?? ctx.link,
      }
      const response = await publishLinkPost(
        payload,
        options,
        linkResult,
        message,
        pageAccessToken,
        scheduledSeconds,
      )
      externalId = response.post_id ?? response.id
      raw = response
      break
    }
    case 'PHOTO': {
      // Resolve the outbound image URL here, just before building the API body.
      const resolved = await resolvePlatformImageUrl({
        imageUrl: input.imageUrl ?? '',
        options,
        payload,
        platform: 'facebook',
      })
      const response = await publishSinglePhoto(
        payload,
        options,
        input,
        message,
        pageAccessToken,
        resolved.url,
        scheduledSeconds,
      )
      externalId = response.post_id ?? response.id
      raw = response
      break
    }
    case 'PHOTO_MULTI': {
      // publishMultiPhoto resolves each URL internally.
      const response = await publishMultiPhoto(
        payload,
        options,
        input,
        message,
        pageAccessToken,
        scheduledSeconds,
      )
      externalId = response.post_id ?? response.id
      raw = response
      break
    }
    case 'VIDEO': {
      const response = await publishVideo(
        payload,
        options,
        input,
        message,
        pageAccessToken,
        scheduledSeconds,
      )
      externalId = response.post_id ?? response.id
      raw = response
      break
    }
    default:
      throw new ValidationError(`Unsupported Facebook format: ${String(format)}`)
  }

  if (!externalId) {
    // Meta answered 2xx: the post may exist even though no id came back.
    throw new PlatformApiError({
      message: 'Facebook publish returned no post id',
      ...classifyRequestFailure({ effect: 'create', status: 200 }),
      platform: 'facebook',
      raw,
      statusCode: 502,
    })
  }

  let externalUrl: string | undefined
  if (!scheduledSeconds) {
    externalUrl = await fetchFacebookPermalinkUrl(payload, options, pageAccessToken, externalId)
    if (!externalUrl) {
      // Fall back to the bare /{post_id} form: it redirects to the canonical
      // URL on both classic and new-experience Pages (unlike the
      // /{page_id}/posts/{post_id} form, which 404s on the latter). A working
      // redirect beats an absent link, and immediate posts have no
      // reconciliation pass to backfill the canonical URL later.
      createPluginLogger(payload.logger, {
        externalId,
        op: 'facebook-publish-permalink',
        platform: 'facebook',
      }).warn('Facebook canonical permalink unavailable; storing the bare post URL')
      externalUrl = buildFallbackPermalink(externalId, format)
    }
  }
  // sourceHash uses the ORIGINAL primaryAssetUrl, not any converted URL.
  const sourceHash = sha256Hex(
    JSON.stringify({ format, message, pageId: input.pageId, primaryAssetUrl }),
  )

  return {
    externalId,
    externalUrl,
    meta: {
      format,
      pageId: input.pageId,
      scheduled: Boolean(scheduledSeconds),
      scheduledPublishTime: scheduledSeconds,
    },
    platform: 'facebook',
    record: {
      altText: input.altText,
      body: message,
      destination: { meta: { format, scheduledPublishTime: input.scheduledPublishTime } },
      imageUrl: input.imageUrl ?? input.imageUrls?.[0],
      link: input.link ?? ctx.link,
      meta: { format, pageId: input.pageId, raw, scheduledSeconds },
      sourceHash,
      title: ctx.baseTitle,
    },
    ...(scheduledSeconds
      ? {
          scheduledAt: new Date(scheduledSeconds * 1000).toISOString(),
          state: 'scheduled' as const,
        }
      : {}),
  }
}

/** How long Facebook gets past a scheduled time before the post counts as not published. */
const FACEBOOK_SCHEDULE_GRACE_MS = 24 * 60 * 60 * 1000
/** How often a natively scheduled post is checked once it is due. */
const FACEBOOK_RECHECK_MS = 5 * 60_000

/**
 * Ask Facebook whether a natively scheduled post went live. Read-only: returns
 * the verdict for the publication ledger to record. A post still unpublished
 * 24 hours after its scheduled time is `failed`.
 */
export const reconcileFacebookScheduledPost = async (args: {
  externalId: string
  options: NormalizedPluginOptions
  pageId: string
  payload: Payload
  scheduledPublishTime?: number
}): Promise<ReconcileVerdict> => {
  const pageAccessToken = await getPageAccessToken(args.payload, args.options, args.pageId)
  const response = await makeMetaRequest(
    args.payload,
    args.options,
    'facebook',
    `/${encodeURIComponent(args.externalId)}?fields=id,is_published,permalink_url`,
    { accessToken: pageAccessToken },
  )
  if (!response.ok) {
    throw new PlatformApiError({
      message: `Facebook scheduled post lookup failed: ${response.status}`,
      platform: 'facebook',
      retryable: response.status >= 500 || response.status === 429,
      statusCode: response.status,
      upstreamCode: response.status,
    })
  }
  const result = (await response.json()) as { is_published?: boolean; permalink_url?: string }
  const externalUrl = result.permalink_url
  if (result.is_published === true) {
    return { externalUrl, state: 'published' }
  }
  if (
    args.scheduledPublishTime !== undefined &&
    Date.now() > args.scheduledPublishTime * 1000 + FACEBOOK_SCHEDULE_GRACE_MS
  ) {
    return {
      externalUrl,
      reason: 'Facebook did not publish the scheduled post within 24 hours.',
      state: 'failed',
    }
  }
  return {
    checkAt: new Date(Date.now() + FACEBOOK_RECHECK_MS).toISOString(),
    externalUrl,
    state: 'pending',
  }
}

export const deleteFacebookPost = async (args: {
  options: NormalizedPluginOptions
  payload: Payload
  publishedRef: PublishedRef
}): Promise<void> => {
  const { options, payload, publishedRef } = args
  if (publishedRef.platform !== 'facebook') {
    throw new ValidationError(`Cannot delete: publishedRef is for ${publishedRef.platform}`)
  }
  if (!publishedRef.externalId) {
    return
  }

  const metadataPageId =
    typeof publishedRef.meta?.pageId === 'string' ? publishedRef.meta.pageId.trim() : ''
  const [compoundPageId] = publishedRef.externalId.split('_')
  const pageId = metadataPageId || compoundPageId
  if (!pageId) {
    throw new ValidationError(`Cannot resolve Page id from externalId "${publishedRef.externalId}"`)
  }
  const pageAccessToken = await getPageAccessToken(payload, options, pageId)

  const response = await makeMetaRequest(
    payload,
    options,
    'facebook',
    `/${encodeURIComponent(publishedRef.externalId)}`,
    { accessToken: pageAccessToken, init: { method: 'DELETE' } },
  )
  if (!response.ok && response.status !== 404) {
    const rawBody = await response.text().catch(() => '')
    throw new PlatformApiError({
      message: `Facebook post delete failed (${response.status})`,
      platform: 'facebook',
      raw: rawBody,
      retryable: response.status >= 500 || response.status === 429,
      statusCode: response.status,
      upstreamCode: response.status,
    })
  }
}
