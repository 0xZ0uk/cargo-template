import { createFileRoute, notFound, redirect } from '@tanstack/react-router'

import { NotFound } from '@/components/NotFound'
import { PageTemplate } from '@/components/PageTemplate'
import { pageHead } from '@/utilities/pageHead'
import { validateDraftSearch } from '@/utilities/validateDraftSearch'

import { loadPage } from './pages.functions'
import { resolveRedirect } from './redirects.functions'

export const Route = createFileRoute('/_frontend/$slug')({
  validateSearch: validateDraftSearch,
  // The home page lives at `/`; don't serve it twice.
  beforeLoad: ({ params, search }) => {
    if (params.slug === 'home') {
      throw redirect({ search, statusCode: 301, to: '/' })
    }
  },
  loaderDeps: ({ search }) => ({ draft: search.draft }),
  loader: async ({ deps, location, params }) => {
    const data = await loadPage({ data: { draft: deps.draft, slug: params.slug } })

    if (!data.page) {
      // Only a miss pays for the redirect lookup, so existing pages never touch it.
      const target = await resolveRedirect({
        data: { pathname: location.pathname, search: location.searchStr },
      })

      if (target) {
        throw redirect({ href: target.href, statusCode: target.statusCode })
      }

      throw notFound()
    }

    return data
  },
  head: ({ loaderData }) => pageHead(loaderData),
  component: SlugPage,
  // Rendered inside the frontend layout, so the header and footer stay.
  notFoundComponent: NotFound,
})

function SlugPage() {
  const { livePreview, page } = Route.useLoaderData()

  return page ? <PageTemplate livePreview={livePreview} page={page} /> : null
}
