import type { RequiredDataFromCollectionSlug } from 'payload'

import { createServerFn } from '@tanstack/react-start'

import { homeStatic } from '@/collections/Pages/homeStatic'

type LoadPageInput = {
  draft?: boolean
  slug: string
}

export type LoadPageResult = {
  /** True when the draft is shown (live preview, on-page editing or a preview link). */
  draft: boolean
  /** Structured data nodes, serialized and safe to embed in `<script type="application/ld+json">`. */
  jsonLd: string[]
  /** The request origin, used to build absolute URLs for Open Graph tags. */
  origin: string
  page: RequiredDataFromCollectionSlug<'pages'> | null
}

// Lexical's recursive node types defeat TanStack's serializability check, so it's turned off
// for the output. Payload documents are plain JSON, which serializes fine.
export const loadPage = createServerFn({ method: 'GET', strict: { output: false } })
  .validator((data: LoadPageInput): LoadPageInput => data)
  .handler(async ({ data }): Promise<LoadPageResult> => {
    const { getPayload } = await import('payload')
    const { getRequestHeaders, getRequestUrl } = await import('@tanstack/react-start/server')
    // Loaded after the Payload config: `tanstackSession()` in the config hands the session
    // helpers the secret they verify cookies with.
    const payload = await getPayload({ config: (await import('@payload-config')).default })
    const { isDraftEnabled, isSharedPreview, onpageContext } =
      await import('@cargo/onpage-tanstack-start/session')

    // Drafts show for a logged-in user who asked with `?draft=true` (live preview) or turned
    // on on-page editing, and for whoever opened a preview link to this page. Anyone else gets
    // the published version.
    const onpageDraft = await isDraftEnabled()
    const user =
      data.draft || onpageDraft
        ? (await payload.auth({ headers: new Headers(getRequestHeaders()) })).user
        : null
    // A preview link carries no Payload user: its sealed grant (checked against this request's
    // path) stands in for read access, for this one page.
    const sharedPreview = !user && onpageDraft && (await isSharedPreview())
    const draft = Boolean(user) || sharedPreview

    const result = await payload.find({
      collection: 'pages',
      depth: 2,
      draft,
      limit: 1,
      overrideAccess: sharedPreview,
      pagination: false,
      user,
      where: {
        slug: {
          equals: data.slug,
        },
      },
      // In edit mode, strings come back with invisible markers that map them to their fields.
      ...(await onpageContext()),
    })

    let page: LoadPageResult['page'] = result.docs[0] ?? null

    // Remove this once your `home` page exists.
    if (!page && data.slug === 'home') {
      page = homeStatic
    }

    const origin = getRequestUrl().origin
    let jsonLd: string[] = []

    if (page) {
      const { buildPageJsonLd } = await import('@/utilities/pageJsonLd')
      const { cloudflareEnv } = await import('#cloudflare-runtime')

      // The configured public origin wins; the request origin is the fallback (dev, previews).
      jsonLd = await buildPageJsonLd(page, process.env.SITE_URL || cloudflareEnv.SITE_URL || origin)
    }

    return { draft, jsonLd, origin, page }
  })
