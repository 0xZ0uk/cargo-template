import type {
  SocialImage,
  SocialImageFormat,
  SocialSourceContext,
} from '@shipment/payload-plugin-socials'

import type { Media, Page } from '@/payload-types'

import { pagePath } from './pagePath'

/** The page fields the Socials composer reads. */
type SourcePage = Pick<Page, 'id' | 'layout' | 'meta' | 'slug' | 'title'>

/** Image MIME types the social platforms accept, as the plugin's `format`. SVG has no entry. */
const FORMAT_BY_MIME: Record<string, SocialImageFormat> = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/png': 'png',
  'image/tiff': 'tiff',
  'image/webp': 'webp',
}

/** `format` for the plugin's image preflight, from an upload's `mimeType` (undefined if unknown). */
export const imageFormatFromMime = (
  mimeType: null | string | undefined,
): SocialImageFormat | undefined =>
  mimeType ? FORMAT_BY_MIME[mimeType.split(';')[0]!.trim().toLowerCase()] : undefined

const absoluteUrl = (origin: string, url: string) =>
  /^https?:\/\//i.test(url) ? url : `${origin}${url.startsWith('/') ? '' : '/'}${url}`

const asMedia = (value: unknown): Media | undefined =>
  value && typeof value === 'object' && 'id' in value ? (value as Media) : undefined

/** A populated image upload as a social image, or nothing for a missing, video or SVG upload. */
const toImage = (value: unknown, origin: string, role: string): SocialImage | undefined => {
  const media = asMedia(value)
  if (!media?.url) return undefined
  // Videos and SVGs (`image/svg+xml`) can't be Pins or posts through the image flow.
  if (!media.mimeType?.startsWith('image/') || media.mimeType.startsWith('image/svg'))
    return undefined

  const format = imageFormatFromMime(media.mimeType)
  return {
    role,
    url: absoluteUrl(origin, media.url),
    ...(media.alt ? { alt: media.alt } : {}),
    ...(format ? { format } : {}),
    ...(typeof media.width === 'number' ? { width: media.width } : {}),
    ...(typeof media.height === 'number' ? { height: media.height } : {}),
  }
}

/** Most images offered to the composer (a gallery block holds up to 40). */
const MAX_IMAGES = 20

/** Uploads of the blocks that carry the page's main imagery, in page order. */
const blockMedia = (layout: Page['layout'] | null | undefined): unknown[] => {
  const media: unknown[] = []
  for (const block of layout ?? []) {
    if (block.blockType === 'hero' || block.blockType === 'mediaBlock') {
      media.push(block.media)
    } else if (block.blockType === 'gallery') {
      for (const item of block.items ?? []) media.push(item.media)
    }
  }
  return media
}

/**
 * The Socials composer's context for a page (the plugin's `SocialSourceContext`).
 *
 * - Title and description: the SEO meta, falling back to the page title (and no description).
 * - Link: the page's public URL on `siteUrl`.
 * - Images: the SEO image first, then the hero, media and gallery blocks' images (each once),
 *   with `format` from `mimeType` so the plugin's preflight can run.
 *
 * Needs the page at `depth >= 1` for the uploads; unpopulated or missing ones are skipped.
 *
 * @param siteUrl - absolute origin; a trailing slash is ignored
 */
export const pageSocialContext = (page: SourcePage, siteUrl: string): SocialSourceContext => {
  const origin = siteUrl.replace(/\/+$/, '')
  const seen = new Set<string>()
  const images: SocialImage[] = []

  const candidates = [page.meta?.image, ...blockMedia(page.layout)]
  for (const candidate of candidates) {
    const image = toImage(candidate, origin, images.length === 0 ? 'main' : 'detail')
    if (!image || seen.has(image.url)) continue
    if (images.length >= MAX_IMAGES) break
    seen.add(image.url)
    images.push(image)
  }

  return {
    baseDescription: page.meta?.description?.trim() || '',
    baseTitle: page.meta?.title?.trim() || page.title,
    images,
    link: `${origin}${pagePath(page.slug ?? 'home')}`,
    sourceId: String(page.id),
    sourceKind: 'page',
  }
}
