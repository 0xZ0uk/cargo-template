/// <reference types="vite/client" />

import { OnPage } from '@cargo/onpage-tanstack-start'
import { createFileRoute, Outlet } from '@tanstack/react-router'

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

  return (
    <div className="flex min-h-screen flex-col">
      <Header data={header} />
      <Outlet />
      <Footer data={footer} />
      {/* The on-page editor, or the shared-preview bar. Renders nothing and sends no requests
          unless an editor pressed "Edit on page" or opened a preview link. */}
      <OnPage />
    </div>
  )
}
