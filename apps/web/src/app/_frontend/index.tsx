import { createFileRoute } from '@tanstack/react-router'

import { PageTemplate } from '@/components/PageTemplate'
import { pageHead } from '@/utilities/pageHead'
import { validateDraftSearch } from '@/utilities/validateDraftSearch'

import { loadPage } from './pages.functions'

export const Route = createFileRoute('/_frontend/')({
  validateSearch: validateDraftSearch,
  loaderDeps: ({ search }) => ({ draft: search.draft }),
  loader: ({ deps }) => loadPage({ data: { draft: deps.draft, slug: 'home' } }),
  head: ({ loaderData }) => pageHead(loaderData),
  component: HomePage,
})

function HomePage() {
  const { draft, page } = Route.useLoaderData()

  // `loadPage` falls back to a static page for `home`, so this only guards the type.
  return page ? <PageTemplate draft={draft} page={page} /> : null
}
