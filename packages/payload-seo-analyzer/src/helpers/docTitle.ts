/**
 * Display name of a document, for breadcrumbs and schema.org names.
 *
 * `meta.title` is what goes in `<title>`, so hosts usually generate it as
 * "Page title | Site name" (`@payloadcms/plugin-seo`'s `generateTitle`). That suffix
 * belongs in the search result, not in a breadcrumb item or an `Article` headline.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const SEPARATOR = '[|\\-\\u2013\\u2014\\u00b7\\u2022:]'

/**
 * Remove `siteName` from the end ("Title | Site") or the start ("Site | Title") of a title.
 * Only a name set off by a separator is removed, and a title that is nothing but the site
 * name is returned as is.
 */
export function stripSiteName(title: string, siteName?: string): string {
  const trimmed = title.trim()
  const name = siteName?.trim()
  if (!name) return trimmed
  const escaped = escapeRegExp(name)
  const stripped = trimmed
    .replace(new RegExp(`\\s*${SEPARATOR}\\s*${escaped}$`, 'i'), '')
    .replace(new RegExp(`^${escaped}\\s*${SEPARATOR}\\s*`, 'i'), '')
    .trim()
  return stripped || trimmed
}

/**
 * The document's own `title`; without one, `meta.title` with the site name stripped;
 * `''` when it has neither.
 */
export function resolveDocTitle(doc: Record<string, unknown>, siteName?: string): string {
  const title = typeof doc.title === 'string' ? doc.title.trim() : ''
  if (title) return title
  const meta = doc.meta
  const metaTitle =
    meta && typeof meta === 'object' && typeof (meta as Record<string, unknown>).title === 'string'
      ? ((meta as Record<string, unknown>).title as string).trim()
      : ''
  return metaTitle ? stripSiteName(metaTitle, siteName) : ''
}
