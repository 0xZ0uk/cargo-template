import type { LoadPageResult } from '@/app/_frontend/pages.functions'

import { pagePath } from './pagePath'
import { siteName } from './siteName'

/**
 * Builds the document title and SEO/Open Graph tags from a page's `meta` fields, plus a
 * robots `noindex` tag when the editor ticked "Hide from search engines" (`noindex`, a
 * field the SEO analyzer plugin adds; it also leaves the page out of the sitemaps and llms.txt).
 */
export const pageHead = (data?: LoadPageResult) => {
  const page = data?.page

  if (!data || !page) {
    return { meta: [{ title: siteName }] }
  }

  const title = page.meta?.title || (page.title ? `${page.title} | ${siteName}` : siteName)
  const description = page.meta?.description
  const image = page.meta?.image
  const imageURL =
    image && typeof image === 'object' && image.url ? `${data.origin}${image.url}` : undefined

  return {
    meta: [
      { title },
      ...(description ? [{ name: 'description', content: description }] : []),
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: siteName },
      { property: 'og:title', content: title },
      { property: 'og:url', content: `${data.origin}${pagePath(page.slug ?? 'home')}` },
      ...(description ? [{ property: 'og:description', content: description }] : []),
      ...(imageURL ? [{ property: 'og:image', content: imageURL }] : []),
      { name: 'twitter:card', content: 'summary_large_image' },
      ...(page.noindex ? [{ name: 'robots', content: 'noindex' }] : []),
    ],
    scripts: data.jsonLd.map((children) => ({ children, type: 'application/ld+json' })),
  }
}
