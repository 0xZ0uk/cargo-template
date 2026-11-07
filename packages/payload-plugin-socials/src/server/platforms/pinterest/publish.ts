import type { Payload, PayloadRequest } from 'payload'

import type {
  NormalizedPluginOptions,
  PublishedRef,
  PublishResult,
  SocialSourceContext,
} from '../../../types/index.js'

import {
  PINTEREST_ALT_TEXT_MAX,
  PINTEREST_DESCRIPTION_MAX,
  PINTEREST_TITLE_MAX,
} from '../../../constants.js'
import { resolvePlatformImageUrl } from '../../assets/resolvePlatformImage.js'
import {
  resolveConfiguredHashtags,
  resolveConfiguredText,
} from '../../copy/resolveConfiguredCopy.js'
import {
  classifyRequestFailure,
  PlatformApiError,
  ValidationError,
} from '../../utilities/errors.js'
import { sha256Hex } from '../../utilities/hash.js'
import { pinterestJson } from './api.js'
import {
  buildDefaultPinterestAltText,
  buildDefaultPinterestDescription,
  buildDefaultPinterestHashtags,
  buildDefaultPinterestTitle,
} from './copy.js'
import { uploadPinterestVideoFromUrl } from './videoUpload.js'

/**
 * Pinterest image and video publication path. Calls Pinterest and returns the
 * Pin and the audit fields; the publication ledger owns the `social-posts` row
 * and the idempotency key (`buildPublicationIdentity`).
 *
 * Image conversion (assets.autoConvert) happens ONLY when constructing the
 * outbound Pinterest API request body. The converted URL never touches the
 * audit record or the sourceHash, which use the ORIGINAL input URL.
 */

export type PinterestPublishInput = {
  altText?: string
  boardId: string
  boardName?: string
  coverImageUrl?: string
  description?: string
  /** Exact legacy SHA-256 identity used when adopting an existing audit row. */
  idempotencyKeyOverride?: string
  imageUrl?: string
  link?: string
  mediaId?: string
  mediaType?: 'IMAGE' | 'VIDEO'
  /** Caller-defined logical publication identity for intentional repeat campaigns. */
  publicationKey?: string
  publishedByUserId?: number | string
  title?: string
  videoUrl?: string
}

type PinResponse = {
  board_id?: string
  id?: string
  link?: string
}

const buildSourceHash = (snapshot: {
  altText: string
  assetUrl: string
  boardId: string
  description: string
  link: string
  mediaType: 'IMAGE' | 'VIDEO'
  title: string
}): string =>
  sha256Hex(
    JSON.stringify({
      altText: snapshot.altText,
      assetUrl: snapshot.assetUrl,
      boardId: snapshot.boardId,
      description: snapshot.description,
      link: snapshot.link,
      mediaType: snapshot.mediaType,
      title: snapshot.title,
    }),
  )

const resolveDefaults = (
  ctx: SocialSourceContext,
  options: NormalizedPluginOptions,
): { altText: string; description: string; title: string } => {
  return {
    altText: resolveConfiguredText('pinterestAltText', ctx, options, buildDefaultPinterestAltText),
    description: resolveConfiguredText(
      'pinterestDescription',
      ctx,
      options,
      buildDefaultPinterestDescription,
    ),
    title: resolveConfiguredText('pinterestTitle', ctx, options, buildDefaultPinterestTitle),
  }
}

export type PinterestPreview = {
  altText: string
  availableImages: SocialSourceContext['images']
  defaultImageUrl: string
  description: string
  hashtags: string[]
  link: string
  source: {
    id: string
    kind: string
    modelLabel?: null | string
    title: string
  }
  title: string
}

export const buildPinterestPreview = (
  ctx: SocialSourceContext,
  options: NormalizedPluginOptions,
): PinterestPreview => {
  const defaults = resolveDefaults(ctx, options)
  const defaultImage = ctx.images.find((img) => img.role === 'main') ?? ctx.images[0]
  return {
    altText: defaults.altText,
    availableImages: ctx.images,
    defaultImageUrl: defaultImage?.url ?? '',
    description: defaults.description,
    hashtags: resolveConfiguredHashtags(ctx, options, buildDefaultPinterestHashtags),
    link: ctx.link,
    source: {
      id: ctx.sourceId,
      kind: ctx.sourceKind,
      modelLabel: ctx.modelLabel,
      title: ctx.baseTitle,
    },
    title: defaults.title,
  }
}

const createPin = async (
  payload: Payload,
  options: NormalizedPluginOptions,
  body: {
    alt_text: string
    board_id: string
    description: string
    link: string
    media_source:
      | { cover_image_url: string; media_id: string; source_type: 'video_id' }
      | { source_type: 'image_url'; url: string }
    title: string
  },
): Promise<PinResponse> => {
  return pinterestJson<PinResponse>(payload, options, '/v5/pins', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
}

export const publishPinterestPin = async (args: {
  ctx: SocialSourceContext
  input: PinterestPublishInput
  options: NormalizedPluginOptions
  payload: Payload
  req?: PayloadRequest
}): Promise<PublishResult> => {
  const { ctx, input, options, payload } = args

  if (!input.boardId) {
    throw new ValidationError('boardId is required')
  }

  const preview = buildPinterestPreview(ctx, options)
  const title = (input.title?.trim() || preview.title).slice(0, PINTEREST_TITLE_MAX)
  const description = (input.description?.trim() || preview.description).slice(
    0,
    PINTEREST_DESCRIPTION_MAX,
  )
  const altText = (input.altText?.trim() || preview.altText).slice(0, PINTEREST_ALT_TEXT_MAX)
  const link = input.link?.trim() || preview.link
  const mediaType = input.mediaType ?? 'IMAGE'

  // The audit record and sourceHash use the ORIGINAL input URL, never a converted one.
  const imageUrl = input.imageUrl?.trim() || preview.defaultImageUrl
  const videoUrl = input.videoUrl?.trim() || ctx.videos?.[0]?.url || ''
  const coverImageUrl = input.coverImageUrl?.trim() || ctx.videos?.[0]?.coverImageUrl || imageUrl
  const primaryAssetUrl = mediaType === 'VIDEO' ? videoUrl || input.mediaId?.trim() || '' : imageUrl

  if (mediaType === 'IMAGE' && !imageUrl) {
    throw new ValidationError('No image available for this source')
  }
  if (mediaType === 'VIDEO' && !videoUrl && !input.mediaId?.trim()) {
    throw new ValidationError('Video Pins require videoUrl or a previously uploaded mediaId')
  }
  if (mediaType === 'VIDEO' && !coverImageUrl) {
    throw new ValidationError('Video Pins require coverImageUrl')
  }
  if (!link) {
    throw new ValidationError('Outbound link is required')
  }
  if (!title) {
    throw new ValidationError('Pin title is required')
  }

  const sourceHash = buildSourceHash({
    altText,
    assetUrl: primaryAssetUrl,
    boardId: input.boardId,
    description,
    link,
    mediaType,
    title,
  })

  const mediaId =
    mediaType === 'VIDEO'
      ? input.mediaId?.trim() ||
        (await uploadPinterestVideoFromUrl({
          options,
          payload,
          videoUrl,
        }))
      : undefined

  // Resolve the outbound image URL for the API request body ONLY.
  // The converted URL must never touch the sourceHash or the audit record.
  let outboundImageUrl = imageUrl
  if (mediaType === 'IMAGE' && imageUrl) {
    const imgMeta = ctx.images.find((img) => img.url === imageUrl)
    const resolved = await resolvePlatformImageUrl({
      declaredFormat: imgMeta?.format,
      imageUrl,
      options,
      payload,
      platform: 'pinterest',
    })
    outboundImageUrl = resolved.url
  }

  const pin = await createPin(payload, options, {
    alt_text: altText,
    board_id: input.boardId,
    description,
    link,
    media_source:
      mediaType === 'VIDEO'
        ? {
            cover_image_url: coverImageUrl,
            media_id: mediaId ?? '',
            source_type: 'video_id',
          }
        : { source_type: 'image_url', url: outboundImageUrl },
    title,
  })

  if (!pin.id?.trim()) {
    // Pinterest answered 2xx: the Pin may exist even though no id came back.
    throw new PlatformApiError({
      message: 'Pinterest create Pin response did not include an id',
      ...classifyRequestFailure({ effect: 'create', status: 200 }),
      platform: 'pinterest',
      statusCode: 502,
    })
  }
  const pinId = pin.id
  const pinUrl = `https://www.pinterest.com/pin/${pinId}/`

  return {
    externalId: pinId,
    externalUrl: pinUrl,
    meta: {
      boardId: input.boardId,
      boardName: input.boardName,
      mediaId,
      mediaType,
    },
    platform: 'pinterest',
    record: {
      altText,
      body: description,
      destination: { label: input.boardName ?? undefined },
      imageUrl: mediaType === 'VIDEO' ? coverImageUrl : imageUrl,
      link,
      meta: {
        boardName: input.boardName,
        mediaId,
        mediaType,
        videoUrl: mediaType === 'VIDEO' ? videoUrl : undefined,
      },
      sourceHash,
      title,
    },
  }
}

/**
 * Soft-delete a pin: deletes on Pinterest's side AND flips the local
 * `social-posts` row to `cancelled`. The row stays in the database — it
 * is both the audit record AND the idempotency anchor for any future
 * republish to the same `(source, board, image)` tuple.
 */
export const deletePinterestPin = async (args: {
  options: NormalizedPluginOptions
  payload: Payload
  publishedRef: PublishedRef
}): Promise<void> => {
  const { options, payload, publishedRef } = args
  if (publishedRef.platform !== 'pinterest') {
    throw new ValidationError(`Cannot delete: publishedRef is for ${publishedRef.platform}`)
  }
  if (!publishedRef.externalId) {
    return
  } // Nothing to do.

  const { makePinterestRequest } = await import('./api.js')
  const response = await makePinterestRequest(
    payload,
    options,
    `/v5/pins/${encodeURIComponent(publishedRef.externalId)}`,
    { init: { method: 'DELETE' } },
  )

  // 204 success or 404 already-gone are both idempotent successes.
  if (!response.ok && response.status !== 404) {
    throw new PlatformApiError({
      message: `Pinterest pin delete failed (${response.status})`,
      platform: 'pinterest',
      raw: await response.text().catch(() => ''),
      retryable: response.status >= 500 || response.status === 429,
      statusCode: response.status,
      upstreamCode: response.status,
    })
  }
}
