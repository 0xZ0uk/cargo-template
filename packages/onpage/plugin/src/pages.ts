/**
 * New pages from the page: a copy of the current one, or a blank one, as a
 * draft with a unique slug. Payload checks create access (the request's user).
 */
import type { CollectionConfig, PayloadRequest } from 'payload'

/** "Über uns & Team!" → "uber-uns-team". */
export const slugify = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'page'

/** Does the collection have a top-level `slug` text field (the usual page address)? */
export const hasSlugField = (cfg: CollectionConfig): boolean =>
  cfg.fields.some((f) => 'name' in f && f.name === 'slug' && f.type === 'text')

/** `base`, or `base-2`, `base-3`… whichever no document (draft or published) uses yet. */
export async function uniqueSlug(
  req: PayloadRequest,
  collection: string,
  base: string,
): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`
    const { totalDocs } = await req.payload.count({
      collection,
      where: { slug: { equals: candidate } },
      overrideAccess: true,
      req,
    })
    if (!totalDocs) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}
