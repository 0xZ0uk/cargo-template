import type { LoadPageResult } from '@/app/_frontend/pages.functions'

import { gtagScripts } from './googleAnalytics'
import { pagePath } from './pagePath'
import { siteName } from './siteName'

/**
 * Builds the document title and SEO/Open Graph tags from a page's `meta` fields, plus a
 * robots `noindex` tag when the editor ticked "Hide from search engines" (`noindex`, a
 * field the SEO analyzer plugin adds; it also leaves the page out of the sitemaps and llms.txt).
 *
 * The canonical link and `og:url` come from `canonicalSlug`, not `page.slug`: an A/B variant
 * served at the original's URL (or opened by an editor at its own) points at the original.
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
  const url = `${data.siteUrl}${pagePath(data.canonicalSlug)}`

  return {
    meta: [
      { title },
      ...(description ? [{ name: 'description', content: description }] : []),
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: siteName },
      { property: 'og:title', content: title },
      { property: 'og:url', content: url },
      ...(description ? [{ property: 'og:description', content: description }] : []),
      ...(imageURL ? [{ property: 'og:image', content: imageURL }] : []),
      { name: 'twitter:card', content: 'summary_large_image' },
      ...(page.noindex ? [{ name: 'robots', content: 'noindex' }] : []),
    ],
    links: [{ rel: 'canonical', href: url }],
    scripts: [
      ...data.jsonLd.map((children) => ({ children, type: 'application/ld+json' })),
      ...gtagScripts(data.gaMeasurementId),
    ],
  }
}
