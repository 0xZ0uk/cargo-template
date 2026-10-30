/// <reference types="vite/client" />

import { createFileRoute, Outlet, useMatches } from '@tanstack/react-router'

import type { LoadPageResult } from './_frontend/pages.functions'

import { NotFound } from '@/components/NotFound'
import { Footer } from '@/Footer/Component'
import { Header } from '@/Header/Component'

import { loadLayout } from './_frontend/layout.functions'
import styles from './_frontend/styles.css?url'

export const Route = createFileRoute('/_frontend')({
  component: FrontendLayout,
  head: () => ({
    links: [{ rel: 'stylesheet', href: styles }],
  }),
  loader: () => loadLayout(),
  // Every full page load fetches the header and footer fresh; client-side navigation reuses
  // them instead of querying D1 again.
  staleTime: Infinity,
  // Unmatched URLs (e.g. `/a/b`) render this inside the layout.
  notFoundComponent: NotFound,
})

function FrontendLayout() {
  const { footer, header } = Route.useLoaderData()

  // A high-impact hero's image sits behind the header, so the header switches to its dark
  // (light-on-dark) theme. Reading it from the page's loader data renders it on the server too.
  const hasHighImpactHero = useMatches({
    select: (matches) =>
      matches.some(
        (match) =>
          (match.loaderData as LoadPageResult | undefined)?.page?.hero?.type === 'highImpact',
      ),
  })

  return (
    <div className="flex min-h-screen flex-col">
      <Header data={header} theme={hasHighImpactHero ? 'dark' : undefined} />
      <Outlet />
      <Footer data={footer} />
    </div>
  )
}
