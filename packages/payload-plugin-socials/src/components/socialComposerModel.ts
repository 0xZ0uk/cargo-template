import type { PlatformId } from '../constants.js'
import type { PreviewResult, SocialDraft, SocialDraftMedia } from '../types/index.js'
import type { ComposerState, MediaType } from './platforms/index.js'

import { getPlatformDescriptor } from './platforms/index.js'

export type { ComposerState, MediaType } from './platforms/index.js'

type DraftEnvelope = { draft: SocialDraft; preview: PreviewResult }

/**
 * Prune selected media URLs whose asset type is no longer accepted for the
 * current format. Returns the pruned list and any removed URLs.
 */
export const pruneSelectedMedia = (
  selectedMedia: string[],
  draftMedia: SocialDraftMedia[],
  platform: PlatformId,
  format: string,
): { pruned: string[]; removed: string[] } => {
  const accepted = getPlatformDescriptor(platform).acceptedMedia(format)
  const pruned: string[] = []
  const removed: string[] = []
  for (const url of selectedMedia) {
    const asset = draftMedia.find((m) => m.url === url)
    if (asset && accepted.includes(asset.type)) {
      pruned.push(url)
    } else {
      removed.push(url)
    }
  }
  return { pruned, removed }
}

/**
 * Remove a leading title line from copy so the separate "Title (first line)"
 * field and the message body stay complementary. The server's default copy
 * builders already put the source title on the first line of the body; without
 * this strip, the compile-time title prepend would duplicate it.
 */
export const stripLeadingTitle = (copy: string, title: string): string => {
  const trimmedTitle = title.trim()
  if (!trimmedTitle) {
    return copy
  }
  const trimmedCopy = copy.trimStart()
  if (!trimmedCopy.startsWith(trimmedTitle)) {
    return copy
  }
  return trimmedCopy.slice(trimmedTitle.length).replace(/^\s+/, '')
}

export const buildInitialComposerState = (
  platform: PlatformId,
  envelope: DraftEnvelope,
): ComposerState => {
  const image = envelope.draft.media.find((asset) => asset.type === 'image')
  const video = envelope.draft.media.find((asset) => asset.type === 'video')
  const descriptor = getPlatformDescriptor(platform)
  const format = descriptor.initialFormat(envelope.draft.media)
  const initialTitle = envelope.preview.title ?? envelope.draft.content.title
  const initialBody = envelope.preview.body ?? envelope.draft.content.body
  // Instagram/Facebook compose the final caption as title + body, so the body
  // field must not itself begin with the title (the default builders put it
  // there). Pinterest keeps its own dedicated title field and full description.
  const copy = descriptor.titleLeadsCopy
    ? stripLeadingTitle(initialBody, initialTitle)
    : initialBody
  return {
    alertType: '',
    altText: envelope.preview.altText ?? image?.altText ?? '',
    callToAction: '',
    callToActionUrl: envelope.preview.link ?? envelope.draft.content.link,
    copy,
    destinationId: '',
    eventEnd: '',
    eventStart: '',
    eventTitle: envelope.draft.content.title,
    format,
    languageCode: '',
    link: envelope.preview.link ?? envelope.draft.content.link,
    offerCode: '',
    offerTerms: '',
    selectedMedia: [format === 'VIDEO' ? video?.url : image?.url].filter((url): url is string =>
      Boolean(url),
    ),
    shareToFeed: true,
    title: initialTitle,
    videoTitle: envelope.draft.content.title,
  }
}

export const getSelectedAssets = (state: ComposerState, draft: SocialDraft): SocialDraftMedia[] =>
  state.selectedMedia.flatMap((url) => {
    const asset = draft.media.find((candidate) => candidate.url === url)
    return asset ? [asset] : []
  })

/**
 * Format a Date into the `YYYY-MM-DDTHH:MM` string that
 * `<input type="datetime-local">` expects as its `min` attribute.
 *
 * `new Date().toISOString().slice(0, 16)` returns UTC wall-clock time.
 * A `datetime-local` input interprets the `min` value in the browser's LOCAL
 * timezone, so UTC-offset machines see the wrong boundary. This helper reads
 * the local date-time components from the Date object directly to produce a
 * string that matches the browser's interpretation of `min`.
 *
 * Passing a fixed Date in tests makes the output fully deterministic.
 */
export const formatLocalDateTimeMin = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

/**
 * Compile the composer state into a platform-specific publish input.
 *
 * Media selection rules (strict, no silent fallback):
 * - Only assets whose type matches the platform descriptor's `acceptedMedia(format)` are used.
 * - If the user has selected accepted assets, use those only.
 * - If no assets are selected and the draft has exactly one accepted asset,
 *   auto-use that one for convenience.
 * - Otherwise no media is populated; validation will report it missing.
 *
 * Title prepend: when `state.title` is set and the platform is instagram or
 * facebook, it becomes the first line of the caption/message.
 */
/**
 * The assets a publish would actually use: the explicit selection filtered to
 * the format's accepted types, falling back to the draft's single accepted
 * asset when nothing is selected. The preview pane renders from this same
 * derivation so what is shown always matches what would be published.
 */
export const getEffectiveAssets = (
  platform: PlatformId,
  state: ComposerState,
  draft: SocialDraft,
): SocialDraftMedia[] => {
  const accepted = getPlatformDescriptor(platform).acceptedMedia(state.format)
  const selectedAssets = getSelectedAssets(state, draft).filter((a) => accepted.includes(a.type))
  const draftAccepted = draft.media.filter((a) => accepted.includes(a.type))
  return selectedAssets.length > 0
    ? selectedAssets
    : draftAccepted.length === 1
      ? draftAccepted
      : []
}

export const compileComposerInput = (
  platform: PlatformId,
  state: ComposerState,
  draft: SocialDraft,
): Record<string, unknown> =>
  getPlatformDescriptor(platform).buildInput(state, getEffectiveAssets(platform, state, draft))

// ---------------------------------------------------------------------------
// Media-library upload normalization
// ---------------------------------------------------------------------------

/** The subset of a Payload upload REST document the composer reads. */
export type UploadDocLike = {
  alt?: unknown
  filename?: unknown
  height?: unknown
  mimeType?: unknown
  /** Generic nested poster shape (`{ url }`) some hosts attach to video docs. */
  poster?: unknown
  /** Generic flat poster/thumbnail URL some hosts attach to video docs. */
  posterUrl?: unknown
  sizes?: unknown
  url?: unknown
  width?: unknown
}

export type UploadUrlContext = {
  apiRoute: string
  collectionSlug: string
  origin: string
}

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * Resolve a fetchable, absolute file URL from a Payload upload document.
 *
 * Payload local-storage documents may carry a relative `url`, while some
 * storage adapters expose only `filename`. Resolution order:
 *   1. `url` present  -> pass through (absolute) or prefix `origin` (relative).
 *   2. else `filename` -> construct `{origin}{apiRoute}/{collection}/file/{name}`.
 *   3. else            -> '' (caller surfaces "could not load media").
 */
export const resolveUploadFileUrl = (doc: UploadDocLike, ctx: UploadUrlContext): string => {
  const absolutize = (value: string): string =>
    value.startsWith('/') ? `${ctx.origin}${value}` : value
  const rawUrl = asString(doc.url)
  if (rawUrl) {
    return absolutize(rawUrl)
  }
  const filename = asString(doc.filename)
  if (filename) {
    const base = ctx.apiRoute.replace(/\/$/, '')
    return `${ctx.origin}${base}/${ctx.collectionSlug}/file/${encodeURIComponent(filename)}`
  }
  return ''
}

/** Media type from mimeType (video/* -> video), defaulting to image. */
export const mediaTypeFromMime = (mimeType: string | undefined): MediaType =>
  mimeType && mimeType.startsWith('video/') ? 'video' : 'image'

/** Short format token from a mimeType, e.g. `video/mp4;codecs=..` -> `mp4`. */
export const formatFromMime = (mimeType: string | undefined): string | undefined => {
  if (!mimeType) {
    return undefined
  }
  const sub = mimeType.split('/')[1]
  return sub ? sub.split(';')[0] : undefined
}

/**
 * For webp/avif image docs, prefer the largest already-generated jpeg size so
 * the picked URL is broadly compatible. Returns the original url when no better
 * jpeg size exists. Pure over the doc's `sizes` map — no network requests.
 */
const pickBestJpegSizeUrl = (doc: UploadDocLike, fallbackUrl: string): string => {
  if (!doc.sizes || typeof doc.sizes !== 'object') {
    return fallbackUrl
  }
  const sizes = doc.sizes as Record<string, Record<string, unknown>>
  let bestWidth = 0
  let bestUrl = fallbackUrl
  for (const sizeData of Object.values(sizes)) {
    const sizeUrl = sizeData?.url
    const sizeMime = sizeData?.mimeType
    const sizeWidth = typeof sizeData?.width === 'number' ? sizeData.width : 0
    if (
      typeof sizeUrl === 'string' &&
      typeof sizeMime === 'string' &&
      sizeMime.includes('jpeg') &&
      sizeWidth > bestWidth
    ) {
      bestWidth = sizeWidth
      bestUrl = sizeUrl
    }
  }
  return bestUrl
}

/**
 * Resolve an optional video poster URL from an upload doc using ONLY generic
 * shapes: a flat `posterUrl` string or a nested `poster.url` string. No
 * host-specific field names are invented. A relative value is made absolute
 * against `ctx.origin`; an absolute value passes through. Returns undefined when
 * neither shape is present.
 */
export const resolveDocPosterUrl = (
  doc: UploadDocLike,
  ctx: UploadUrlContext,
): string | undefined => {
  const flat = asString(doc.posterUrl)
  const nested = asString((doc.poster as { url?: unknown } | undefined)?.url)
  const raw = flat || nested
  if (!raw) {
    return undefined
  }
  return raw.startsWith('/') ? `${ctx.origin}${raw}` : raw
}

/**
 * Normalize a selected Payload upload document into a SocialDraftMedia asset:
 * absolute playable URL, inferred type/format, and image dimensions.
 * Video docs additionally carry an optional `posterUrl` when the doc exposes a
 * generic poster field, so the composer can show a thumbnail with no extra
 * fetch. Returns undefined when no usable URL can be resolved.
 */
export const normalizeSelectedUploadMedia = (
  doc: UploadDocLike,
  ctx: UploadUrlContext,
): SocialDraftMedia | undefined => {
  const mimeType = asString(doc.mimeType) || undefined
  const type = mediaTypeFromMime(mimeType)
  const format = formatFromMime(mimeType)
  let url = resolveUploadFileUrl(doc, ctx)
  if (!url) {
    return undefined
  }
  if (type === 'image' && format && (format === 'avif' || format === 'webp')) {
    const best = pickBestJpegSizeUrl(doc, url)
    url = best.startsWith('/') ? `${ctx.origin}${best}` : best
  }
  return {
    type,
    altText: asString(doc.alt) || undefined,
    format,
    height: typeof doc.height === 'number' ? doc.height : undefined,
    posterUrl: type === 'video' ? resolveDocPosterUrl(doc, ctx) : undefined,
    url,
    width: typeof doc.width === 'number' ? doc.width : undefined,
  }
}

/**
 * Human-readable filename derived from a media URL's last path segment, with
 * query string and fragment stripped and percent-encoding decoded. Used to
 * label a video placeholder tile without any network request. Falls back to the
 * raw url when there is no usable segment or decoding fails.
 */
export const filenameFromUrl = (url: string): string => {
  const withoutHash = url.split('#')[0]
  const withoutQuery = withoutHash.split('?')[0]
  const segment = withoutQuery.split('/').filter(Boolean).pop() ?? ''
  if (!segment) {
    return url
  }
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** Whether a media asset is a video (drives the placeholder-vs-image render). */
export const isVideoAsset = (asset: Pick<SocialDraftMedia, 'type'>): boolean =>
  asset.type === 'video'

// ---------------------------------------------------------------------------
// Shared media pool across platform tabs
// ---------------------------------------------------------------------------

/**
 * Effective media pool for a platform tab: resolver-provided media first, then
 * user-added `extraMedia` in insertion order, deduped by url. The selection
 * (`selectedMedia`) stays per-platform, but the POOL is shared so an asset
 * added on one tab is selectable on every tab.
 */
export const mergeDraftMedia = (
  resolverMedia: SocialDraftMedia[],
  extraMedia: SocialDraftMedia[],
): SocialDraftMedia[] => {
  const seen = new Set<string>()
  const merged: SocialDraftMedia[] = []
  for (const asset of [...resolverMedia, ...extraMedia]) {
    if (seen.has(asset.url)) {
      continue
    }
    seen.add(asset.url)
    merged.push(asset)
  }
  return merged
}

// ---------------------------------------------------------------------------
// Selected-media ordering
// ---------------------------------------------------------------------------

/**
 * Move the entry at `from` to index `to`, clamping `to` into range. Returns the
 * same reference on a no-op (identity move or out-of-range `from`) so callers
 * can skip redundant state updates. Order of `selectedMedia` is the carousel /
 * multi-photo child order, so this drives the published sequence.
 */
export const reorderSelectedMedia = (selected: string[], from: number, to: number): string[] => {
  if (from < 0 || from >= selected.length) {
    return selected
  }
  const clampedTo = Math.max(0, Math.min(selected.length - 1, to))
  if (clampedTo === from) {
    return selected
  }
  const next = [...selected]
  const [moved] = next.splice(from, 1)
  next.splice(clampedTo, 0, moved)
  return next
}

// ---------------------------------------------------------------------------
// Standalone composer model
// ---------------------------------------------------------------------------

export type StandaloneComposerState = {
  body: string
  channels: PlatformId[]
  destinations: Partial<Record<PlatformId, string>>
  link: string
  media: SocialDraftMedia[]
  title: string
}

export const buildStandaloneInitialState = (
  _enabledPlatforms: PlatformId[],
): StandaloneComposerState => ({
  body: '',
  channels: [],
  destinations: {},
  link: '',
  media: [],
  title: '',
})

/**
 * Compile standalone composer state into the request body for
 * POST {basePath}/compose/publish.
 */
export const compileStandalonePublishBody = (
  state: StandaloneComposerState,
  perChannelFormat: Partial<Record<PlatformId, string>>,
): {
  content: {
    body?: string
    images?: Array<{ format?: string; height?: number; url: string; width?: number }>
    link?: string
    title: string
  }
  targets: Array<{ input: Record<string, unknown>; platform: PlatformId }>
} => {
  const images = state.media
    .filter((m) => m.type === 'image')
    .map((m) => ({ format: m.format, height: m.height, url: m.url, width: m.width }))

  const targets = state.channels.map((platform) => {
    const descriptor = getPlatformDescriptor(platform)
    const format = perChannelFormat[platform] ?? descriptor.defaultFormat
    const accepted = descriptor.acceptedMedia(format)
    const acceptedAssets = state.media.filter((m) => accepted.includes(m.type))
    const input = descriptor.buildStandaloneInput(
      state.destinations[platform] ?? '',
      format,
      acceptedAssets,
    )
    return { input, platform }
  })

  return {
    content: {
      body: state.body || undefined,
      images: images.length > 0 ? images : undefined,
      link: state.link || undefined,
      title: state.title,
    },
    targets,
  }
}

// ---------------------------------------------------------------------------
// Compose response guard
// ---------------------------------------------------------------------------

export type ComposeResult = {
  anyPublished: boolean
  results: Array<{
    error?: string
    ok: boolean
    platform: PlatformId
    publishedRef?: {
      externalId: string
      externalUrl?: string
      meta?: Record<string, unknown>
      platform: PlatformId
    }
  }>
}

/**
 * Parse and validate a response from the standalone compose endpoint.
 *
 * On a non-ok HTTP response OR a body that does not have an array `results`
 * property, returns `{ ok: false, error }` with the server's error message (or
 * a generic fallback). Only when the body looks like a valid ComposeResult is
 * `{ ok: true, data }` returned.
 *
 * Extracting this decision keeps the component thin and the guard fully
 * testable without a DOM/browser environment.
 */
export const parseComposeResponse = (
  httpOk: boolean,
  body: unknown,
): { data: ComposeResult; ok: true } | { error: string; ok: false } => {
  const rec =
    body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : undefined

  if (!httpOk || !rec || !Array.isArray(rec.results)) {
    const errorMsg =
      typeof rec?.error === 'string' && rec.error
        ? rec.error
        : `Publish failed${httpOk ? '' : ' (server error)'}`
    return { error: errorMsg, ok: false }
  }

  return { data: body as ComposeResult, ok: true }
}

// ---------------------------------------------------------------------------
// Envelope cache helper
// ---------------------------------------------------------------------------

/**
 * Return true when the source composer should fetch a fresh preview envelope
 * for the given platform.
 *
 * Cache-first: if an envelope already exists in state (because the user has
 * visited this platform tab before), we do NOT refetch — that would wipe any
 * media the user added via Add URL or the Media library. The initial fetch
 * per platform still happens when no envelope exists.
 */
export const shouldFetchEnvelope = (
  envelopes: Partial<Record<string, unknown>>,
  platform: string,
): boolean => !(platform in envelopes)

// ---------------------------------------------------------------------------
// Kind-scoped template selection
// ---------------------------------------------------------------------------

/** The template fields the composer needs to filter and auto-apply. */
export type ComposerTemplateSummary = {
  appliesTo: PlatformId[]
  id: number | string
  isDefault?: boolean
  sourceKind?: string
}

/**
 * Templates a composer should offer for a given source kind + platform.
 *
 * A template is included when its `sourceKind` matches the composer's kind AND
 * its `appliesTo` either includes the platform or is empty (empty = every
 * platform, the "informational" default). Templates authored for a different
 * collection never appear, so a product-field template can no longer show up
 * on a blog post and render empty.
 */
export const filterTemplatesForContext = <T extends ComposerTemplateSummary>(
  templates: T[],
  kind: string,
  platform: PlatformId,
): T[] =>
  templates.filter(
    (template) =>
      template.sourceKind === kind &&
      (template.appliesTo.length === 0 || template.appliesTo.includes(platform)),
  )

/**
 * The default template to auto-apply from an already context-filtered list, if
 * any. Returns the first template flagged `isDefault`; `undefined` otherwise.
 */
export const pickDefaultTemplate = <T extends { isDefault?: boolean }>(
  templates: T[],
): T | undefined => templates.find((template) => template.isDefault === true)

/**
 * Narrow a shared media pool (which can include a whole catalog of related
 * records) by alt text, role or type. Returns the same array for a blank query.
 */
export const filterMediaBySearch = (
  assets: SocialDraftMedia[],
  query: string,
): SocialDraftMedia[] => {
  const search = query.trim().toLocaleLowerCase()
  if (!search) {
    return assets
  }
  return assets.filter((asset) =>
    [asset.altText, asset.role, asset.type]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
      .includes(search),
  )
}

export const mediaToggleLabel = (
  asset: Pick<SocialDraftMedia, 'altText' | 'type'>,
  selected: boolean,
  accepted: boolean,
): string => {
  if (!accepted) {
    return 'Not available for this format'
  }
  return `${selected ? 'Deselect' : 'Select'} ${asset.altText || `${asset.type} asset`}`
}

export type MediaLibraryOptions = {
  collectionSlugs: string[] | undefined
  filterOptions: Record<string, unknown> | undefined
}

/** Read the optional `admin.mediaLibrary` scope from the serialized plugin config. */
export const resolveMediaLibraryOptions = (
  socials: Record<string, unknown> | undefined,
): MediaLibraryOptions => {
  const library = socials?.mediaLibrary
  if (typeof library !== 'object' || library === null || Array.isArray(library)) {
    return { collectionSlugs: undefined, filterOptions: undefined }
  }
  const { collectionSlugs, filterOptions } = library as Record<string, unknown>
  const slugs = Array.isArray(collectionSlugs)
    ? collectionSlugs.filter((slug): slug is string => typeof slug === 'string')
    : undefined
  return {
    collectionSlugs: slugs && slugs.length > 0 ? slugs : undefined,
    filterOptions:
      typeof filterOptions === 'object' && filterOptions !== null && !Array.isArray(filterOptions)
        ? (filterOptions as Record<string, unknown>)
        : undefined,
  }
}
