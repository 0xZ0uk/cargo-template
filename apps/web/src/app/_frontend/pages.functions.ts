import type { Payload, RequiredDataFromCollectionSlug, Where } from 'payload'

import { createServerFn } from '@tanstack/react-start'

import { homeStatic } from '@/collections/Pages/homeStatic'
import { pagePath } from '@/utilities/pagePath'

type LoadPageInput = {
  draft?: boolean
  slug: string
}

export type LoadPageResult = {
  /**
   * The slug the page's canonical URL, `og:url` and JSON-LD are built from: the slug that was
   * requested, never that of an A/B variant served in its place, and the original's slug when
   * an editor opens a variant at its own URL.
   */
  canonicalSlug: string
  /** True when the draft is shown (live preview, on-page editing or a preview link). */
  draft: boolean
  /** True for the admin's live preview (`?draft=true` from a signed-in user): it turns on the listener that reloads on save. */
  livePreview: boolean
  /** Structured data nodes, serialized and safe to embed in `<script type="application/ld+json">`. */
  jsonLd: string[]
  /** The request origin, used to build absolute URLs for Open Graph images. */
  origin: string
  page: RequiredDataFromCollectionSlug<'pages'> | null
  /**
   * Set when a visitor asked for a published A/B variant by its own slug: the original page's
   * path, which the route answers with a temporary redirect. `page` is null then.
   */
  redirectTo?: string
  /** The public origin (`SITE_URL`, else the request origin) for canonical URLs. */
  siteUrl: string
}

// Lexical's recursive node types defeat TanStack's serializability check, so it's turned off
// for the output. Payload documents are plain JSON, which serializes fine.
export const loadPage = createServerFn({ method: 'GET', strict: { output: false } })
  .validator((data: LoadPageInput): LoadPageInput => data)
  .handler(async ({ data }): Promise<LoadPageResult> => {
    const { getPayload } = await import('payload')
    const {
      appendResponseHeader,
      getRequestHeader,
      getRequestHeaders,
      getRequestUrl,
      setResponseHeader,
    } = await import('@tanstack/react-start/server')
    // Loaded after the Payload config: `tanstackSession()` in the config hands the session
    // helpers the secret they verify cookies with.
    const payload = await getPayload({ config: (await import('@payload-config')).default })
    const { isDraftEnabled, onpageContext, previewGrantFor } =
      await import('@cargo/onpage-tanstack-start/session')

    // Drafts show for a logged-in user who asked with `?draft=true` (live preview) or turned
    // on on-page editing, and for whoever opened a preview link to this page. Anyone else gets
    // the published version.
    const onpageDraft = await isDraftEnabled()
    const user =
      data.draft || onpageDraft
        ? (await payload.auth({ headers: new Headers(getRequestHeaders()) })).user
        : null
    // A preview link carries no Payload user. Its sealed grant names one document and the path
    // it was shared at; when that path is this page's, the grant stands in for read access to
    // that document only. It's checked against the path of the slug being rendered, not the
    // request URL, so it still holds when this loader re-runs as a server-function call
    // (hydration, invalidation, client-side navigation). The document is read by id, so a page
    // that later takes over the slug isn't covered.
    const grant = user ? null : await previewGrantFor(pagePath(data.slug))
    const shared = grant?.kind === 'collection' && grant.slug === 'pages' ? grant : null
    const draft = Boolean(user) || Boolean(shared)

    // A/B testing (packages/payload-plugin-ab): a visitor seeing the published page is
    // assigned a bucket for it (sticky, by cookie) and may be served a variant, a page of its
    // own under the slug `<slug>--<hash>`. Drafts (live preview, on-page editing, preview
    // links) always show the page that was asked for. The manifest key is the requested
    // page's path, never the variant's.
    let variantSlug: string | undefined
    if (!draft) {
      const { routeAb } = await import('@/plugins/abTesting')
      const { varies, ab } = await routeAb(getRequestHeader('cookie'), pagePath(data.slug), payload)
      for (const header of ab?.setCookieHeaders ?? []) appendResponseHeader('Set-Cookie', header)
      // The page depends on the bucket cookie, so no shared cache may store it: keyed by URL
      // alone, it would serve one visitor's bucket to everyone. This includes visitors already
      // in the original bucket, for whom the resolver returns null. Pages without an
      // experiment keep their normal caching.
      if (varies) setResponseHeader('Cache-Control', 'private, no-store')
      // With the default variant data, the bucket is the variant's slug.
      variantSlug = ab?.variant?.bucket
    }

    // In edit mode, strings come back with invisible markers that map them to their fields.
    const markers = await onpageContext()
    const findPage = (where: Where) =>
      payload.find({
        collection: 'pages',
        depth: 2,
        draft,
        limit: 1,
        overrideAccess: Boolean(shared),
        pagination: false,
        user,
        where,
        ...markers,
      })

    let result = await findPage(
      shared ? { id: { equals: shared.id } } : { slug: { equals: variantSlug ?? data.slug } },
    )
    // True when the visitor's bucket is being served in place of the requested page.
    let servingBucket = Boolean(variantSlug) && result.docs.length > 0
    // The variant was unpublished or deleted after the manifest (or its cache) was read:
    // serve the original rather than a 404.
    if (variantSlug && result.docs.length === 0) {
      result = await findPage({ slug: { equals: data.slug } })
      servingBucket = false
    }

    let page: LoadPageResult['page'] = result.docs[0] ?? null
    let canonicalSlug = data.slug

    const origin = getRequestUrl().origin
    const { cloudflareEnv } = await import('#cloudflare-runtime')
    // The configured public origin wins; the request origin is the fallback (dev, previews).
    const siteUrl = (process.env.SITE_URL || cloudflareEnv.SITE_URL || origin).replace(/\/+$/, '')

    // A variant asked for by its own slug (`/<slug>--<hash>`): visitors reach variants only
    // through the original's URL, so they're sent there (302: an experiment URL is temporary,
    // and nothing should cache a permanent redirect for it). Editors (drafts, preview links)
    // can still open it, with the original's canonical URL.
    if (page && !servingBucket && page._abVariantOf != null) {
      const original = await originalSlugOf(page._abVariantOf, payload)
      if (original) {
        if (!draft) {
          return {
            canonicalSlug: original,
            draft,
            jsonLd: [],
            livePreview: false,
            origin,
            page: null,
            redirectTo: pagePath(original),
            siteUrl,
          }
        }
        canonicalSlug = original
      }
    }

    // Remove this once your `home` page exists.
    if (!page && data.slug === 'home') {
      page = homeStatic
    }

    let jsonLd: string[] = []

    if (page) {
      const { buildPageJsonLd } = await import('@/utilities/pageJsonLd')
      jsonLd = await buildPageJsonLd(page, siteUrl, { slug: canonicalSlug })
    }

    return {
      canonicalSlug,
      draft,
      jsonLd,
      livePreview: Boolean(user) && Boolean(data.draft),
      origin,
      page,
      siteUrl,
    }
  })

/**
 * The published slug of the page a variant was made from (`_abVariantOf`, populated or an id),
 * read without markers or access checks: it only builds a URL. Null when the original is gone.
 */
async function originalSlugOf(
  ref: NonNullable<RequiredDataFromCollectionSlug<'pages'>['_abVariantOf']>,
  payload: Payload,
): Promise<string | null> {
  const id = typeof ref === 'object' ? ref.id : ref
  const original = await payload
    .findByID({ collection: 'pages', depth: 0, disableErrors: true, id, select: { slug: true } })
    .catch(() => null)
  return original?.slug || null
}
