/**
 * adminViewShell — shared server shell for every SEO admin view.
 *
 * Payload 4 renders custom root views without a template, so each view wraps its
 * client body in `DefaultTemplate` itself to get the admin nav and header.
 * Redirects go through the framework-agnostic `server` adapter instead of
 * `next/navigation`, so the views work under any Payload 4 adapter (Next.js,
 * TanStack Start, …).
 */

import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/ui/rsc'
import React from 'react'
import { ViewErrorBoundary } from './ErrorBoundaryClient.js'
import { seoViewRedirectTarget } from '../helpers/viewAccess.js'

export function renderSeoAdminView(
  props: AdminViewServerProps,
  viewName: string,
  body: React.ReactNode,
): React.ReactElement {
  const { initPageResult, params, searchParams, server } = props

  // Not just `!!req.user`: a session on any OTHER auth collection (front-office
  // customers, members…) also populates it, and declaring these views takes the route
  // out of Payload's own canAccessAdmin redirect. See helpers/viewAccess.ts.
  const denied = seoViewRedirectTarget(initPageResult)
  if (denied) server.redirect(denied)

  const { req, visibleEntities, permissions, locale } = initPageResult

  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={locale}
      params={params}
      payload={req.payload}
      permissions={permissions}
      req={req}
      searchParams={searchParams}
      user={props.user ?? req.user!}
      visibleEntities={{
        // Copied rather than passed through: React 19 throws "Cannot assign to read
        // only property" when initPageResult.visibleEntities is handed down as-is.
        collections: visibleEntities?.collections,
        globals: visibleEntities?.globals,
      }}
    >
      {/* The client view is the whole page body: a render error there would
          otherwise unmount the admin shell around it. */}
      <ViewErrorBoundary viewName={viewName}>{body}</ViewErrorBoundary>
    </DefaultTemplate>
  )
}
