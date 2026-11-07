/** Where a document lives on the site. */
import { safePath, type DocRef } from '@shipment/onpage-core'
import type { PayloadRequest, TypedLocale } from 'payload'
import { originOf } from './http.ts'
import type { Entry } from './options.ts'

/** Query parameters that carry a credential: they belong to a preview route, never to a page's address. */
const SECRET_PARAMS = ['previewSecret', 'secret', 'token', 'draftSecret']

const warned = new Set<string>()

/**
 * The site path that shows a document: the entry's `url` option, else the
 * collection's `admin.preview` URL, else `/<slug>`; globals default to "/".
 * Absolute URLs must be same-origin. Returns null when there's no page.
 *
 * A URL with a secret in its query is a preview route, such as the Payload
 * website template's `/next/preview?path=/about&previewSecret=…`. Opening it
 * would refuse share-link viewers and put the secret in links, so the page
 * path it carries (`path`) is used instead, or none.
 */
export async function resolvePath(
  req: PayloadRequest,
  ref: DocRef,
  entry: Entry,
  locale?: TypedLocale,
): Promise<string | null> {
  const read = { draft: true, depth: 0, overrideAccess: true, ...(locale ? { locale } : {}) }
  const doc: Record<string, unknown> | null =
    entry.kind === 'global'
      ? await req.payload.findGlobal({ slug: entry.slug, ...read }).catch(() => null)
      : ref.kind === 'collection'
        ? await req.payload
            .findByID({ collection: entry.slug, id: ref.id, ...read })
            .catch(() => null)
        : null
  if (!doc) return null

  let url: string | null | undefined
  if (entry.options.url) url = await entry.options.url({ doc, locale: locale ?? undefined, req })
  else if (entry.kind === 'collection') {
    const preview = req.payload.collections[entry.slug]?.config.admin?.preview
    if (preview) url = await preview(doc, { locale: locale ?? '', req, token: null })
    if (!url && typeof doc.slug === 'string') url = `/${doc.slug.replace(/^\/+/, '')}`
  } else url = '/'
  if (!url) return null

  const origin = originOf(req)
  try {
    const u = new URL(url, origin)
    if (u.origin !== origin) return null
    if (SECRET_PARAMS.some((p) => u.searchParams.has(p))) {
      if (!warned.has(entry.slug)) {
        warned.add(entry.slug)
        req.payload.logger.warn(
          `payload-onpage: ${entry.kind} "${entry.slug}" resolves to a preview route (${u.pathname}), not a page. Using its \`path\` parameter; set the \`url\` option for this ${entry.kind} to say where its page is.`,
        )
      }
      const page = safePath(u.searchParams.get('path'))
      return page && !SECRET_PARAMS.some((p) => new URL(page, origin).searchParams.has(p))
        ? page
        : null
    }
    return safePath(u.pathname + u.search)
  } catch {
    return null
  }
}
