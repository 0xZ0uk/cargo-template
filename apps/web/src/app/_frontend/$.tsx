import { createFileRoute, notFound, redirect } from '@tanstack/react-router'

import { NotFound } from '@/components/NotFound'

import { resolveRedirect } from './redirects.functions'

// Every path with more than one segment (`/blog/old-post`). Pages are single-segment, so
// nothing here can exist: it's either a managed redirect or a 404.
export const Route = createFileRoute('/_frontend/$')({
  loader: async ({ location }) => {
    const target = await resolveRedirect({
      data: { pathname: location.pathname, search: location.searchStr },
    })

    if (target) {
      throw redirect({ href: target.href, statusCode: target.statusCode })
    }

    throw notFound()
  },
  notFoundComponent: NotFound,
})
