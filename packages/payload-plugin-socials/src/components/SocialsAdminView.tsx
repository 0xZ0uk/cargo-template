import type { AdminViewServerProps } from 'payload'

import { DefaultTemplate } from '@payloadcms/ui/rsc'
import React from 'react'

import type { AuthorizeFn } from '../types/index.js'

import { evaluateAuthorize } from '../server/utilities/access.js'
import { SocialsAdminViewClient } from './SocialsAdminViewClientRef.js'
import { DisabledNotice, ViewBody, ViewHeader } from './ui/index.js'

/**
 * Server-rendered shell for the `/admin/socials` route. The header bits use
 * Payload's `DefaultTemplate` and list-header markup so the page feels native;
 * the content is a client island with two tabs: Compose and Connections.
 *
 * Gated server-side: a user the host `authorize` rejects for the `publisher`
 * scope is redirected to `/admin` before anything renders, so the route is
 * unreachable rather than an error page.
 */
export const SocialsAdminView: React.FC<{ title?: string } & AdminViewServerProps> = async ({
  initPageResult,
  params,
  searchParams,
  server,
  title = 'Socials',
  user,
}) => {
  const socialsConfig = (initPageResult?.req?.payload?.config?.custom as Record<string, unknown>)
    ?.socials as { authorize?: AuthorizeFn; disabled?: boolean; enabledPlatforms?: string[] } | undefined

  const authorize = socialsConfig?.authorize
  const allowed = authorize
    ? await evaluateAuthorize(initPageResult.req, authorize, 'publisher')
    : false
  if (!allowed) {
    // Payload 4: redirect through the adapter-agnostic `server` helper, not next/navigation.
    server.redirect(`${initPageResult.req.payload.config.routes?.admin ?? '/admin'}`)
  }

  const enabledPlatforms = socialsConfig?.enabledPlatforms ?? []

  return (
    <DefaultTemplate
      i18n={initPageResult.req.i18n}
      locale={initPageResult.locale}
      params={params}
      payload={initPageResult.req.payload}
      permissions={initPageResult.permissions}
      req={initPageResult.req}
      searchParams={searchParams}
      user={user ?? initPageResult.req.user!}
      visibleEntities={{
        // Copied: React 19 throws "Cannot assign to read only property" when
        // initPageResult.visibleEntities is handed down as-is.
        collections: initPageResult.visibleEntities?.collections,
        globals: initPageResult.visibleEntities?.globals,
      }}
    >
      <ViewHeader
        description="Multi-platform organic publishing. Compose posts or manage connections."
        title={title}
      />
      <ViewBody>
        {socialsConfig?.disabled === true ? (
          <DisabledNotice />
        ) : (
          <SocialsAdminViewClient enabledPlatforms={enabledPlatforms} />
        )}
      </ViewBody>
    </DefaultTemplate>
  )
}
