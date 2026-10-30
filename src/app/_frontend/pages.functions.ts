import type { RequiredDataFromCollectionSlug } from 'payload'

import { createServerFn } from '@tanstack/react-start'

import { homeStatic } from '@/collections/Pages/homeStatic'

type LoadPageInput = {
  draft?: boolean
  slug: string
}

export type LoadPageResult = {
  /** True when a logged-in user asked for the draft, which turns on live preview. */
  draft: boolean
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

    const payload = await getPayload({ config: (await import('@payload-config')).default })

    // Only authenticated users can see drafts. Anyone else gets the published version, even
    // with `?draft=true`.
    const user = data.draft
      ? (await payload.auth({ headers: new Headers(getRequestHeaders()) })).user
      : null
    const draft = Boolean(user)

    const result = await payload.find({
      collection: 'pages',
      depth: 2,
      draft,
      limit: 1,
      overrideAccess: false,
      pagination: false,
      user,
      where: {
        slug: {
          equals: data.slug,
        },
      },
    })

    let page: LoadPageResult['page'] = result.docs[0] ?? null

    // Remove this once your `home` page exists.
    if (!page && data.slug === 'home') {
      page = homeStatic
    }

    return { draft, origin: getRequestUrl().origin, page }
  })
