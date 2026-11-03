// SEO nav group injected by the plugin into the Payload admin sidebar (afterNavLinks).
// Uses Payload's own NavGroup and nav link markup so it is indistinguishable from the
// built-in Collections / Globals groups, and lists only the views whose feature is on.
'use client'

import React from 'react'
import { Link, NavGroup, useConfig, usePathname } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import type { SeoFeatures } from '../types.js'
import { useDashboardT, useSeoFeature } from '../hooks/useSeoLocale.js'
import { withSeoErrorBoundary } from './withSeoErrorBoundary.js'

interface NavItem {
  /** Path under the admin route, matching the view paths registered in plugin.ts. */
  path: string
  label: string
  /** Feature that registers the view. The item is hidden when the flag is off. */
  feature: keyof SeoFeatures
}

/** Hides an item only when the flag is explicitly off (unknown → shown, as before). */
function useEnabled(feature: keyof SeoFeatures): boolean {
  return useSeoFeature(feature) !== false
}

function SeoNavLinkInner() {
  const pathname = usePathname() ?? ''
  const t = useDashboardT()
  const {
    config: {
      routes: { admin: adminRoute },
    },
  } = useConfig()

  const enabled: Record<string, boolean> = {
    dashboard: useEnabled('dashboard'),
    sitemapAudit: useEnabled('sitemapAudit'),
    redirects: useEnabled('redirects'),
    cannibalization: useEnabled('cannibalization'),
    performance: useEnabled('performance'),
    keywords: useEnabled('keywords'),
    schemaBuilder: useEnabled('schemaBuilder'),
    linkGraph: useEnabled('linkGraph'),
    settings: useEnabled('settings'),
  }

  const items: NavItem[] = [
    { path: '/seo', label: t.nav.dashboard, feature: 'dashboard' },
    { path: '/sitemap-audit', label: t.nav.sitemapAudit, feature: 'sitemapAudit' },
    { path: '/redirects', label: t.nav.redirects, feature: 'redirects' },
    { path: '/cannibalization', label: t.nav.cannibalization, feature: 'cannibalization' },
    { path: '/performance', label: t.nav.performance, feature: 'performance' },
    { path: '/keyword-research', label: t.nav.keywords, feature: 'keywords' },
    { path: '/schema-builder', label: t.nav.schemaOrg, feature: 'schemaBuilder' },
    { path: '/link-graph', label: t.nav.linkGraph, feature: 'linkGraph' },
    { path: '/seo-config', label: t.nav.settings, feature: 'settings' },
  ].filter((item) => enabled[item.feature]) as NavItem[]

  if (items.length === 0) return null

  return (
    <NavGroup label={t.nav.seo}>
      {items.map((item) => {
        const href = formatAdminURL({ adminRoute, path: item.path as `/${string}` })
        const isActive =
          pathname.startsWith(href) && ['/', undefined].includes(pathname[href.length])
        return (
          <div className="nav__link-wrapper" key={item.path}>
            <Link
              aria-current={isActive ? (pathname === href ? 'page' : 'location') : undefined}
              className={`nav__link${isActive ? ' nav__link--selected' : ''}`}
              href={href}
              prefetch={false}
            >
              <span className="nav__link-label">{item.label}</span>
            </Link>
          </div>
        )
      })}
    </NavGroup>
  )
}

/**
 * Payload mounts this from the import map on EVERY admin page (afterNavLinks),
 * so a render error here would unmount the whole admin shell everywhere. The
 * boundary has to live inside this module: the plugin never owns the parent.
 *
 * `fallback: null` — the nav link disappears rather than putting a permanent
 * error panel across the sidebar of every screen.
 */
const SeoNavLink = withSeoErrorBoundary(SeoNavLinkInner, {
  viewName: 'SeoNavLink',
  fallback: null,
})

export default SeoNavLink
