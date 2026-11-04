/** The lazily loaded part of the TanStack Start adapter: the editor and the preview toolbar, wired to Start and Payload. */
import { useEffect, useMemo } from 'react'
import { useLocation, useRouter } from '@tanstack/react-router'
import { DEFAULTS, ROUTES, type DocRef } from '@cargo/onpage-core'
import { payloadRest, payloadUploads } from '@cargo/onpage-core/payload'
import { OnPageEditor, PreviewToolbar, inPreviewFrame, type Links } from '@cargo/onpage-react'
import { lexicalEditors } from '@cargo/onpage-lexical'
import type { OnPageMountProps } from './client.tsx'
import { useTanstackRefresh } from './refresh.ts'

function useHere(): string {
  const { pathname, searchStr } = useLocation()
  return `${pathname}${searchStr}`
}

/** Routes resolved once, with the defaults applied. */
const routesOf = (props: OnPageMountProps) => {
  const api = props.apiRoute ?? DEFAULTS.apiRoute
  const prefix = props.prefix ?? DEFAULTS.routePrefix
  return { api, prefix, base: `${api}${prefix}`, admin: props.adminRoute ?? DEFAULTS.adminRoute }
}

function useLinks(props: OnPageMountProps): Links {
  const here = useHere()
  const { base, admin } = routesOf(props)
  return useMemo<Links>(
    () => ({
      exit: `${base}${ROUTES.exit}?path=${encodeURIComponent(here)}`,
      mode: (mode) => `${base}${ROUTES.mode}?mode=${mode}&path=${encodeURIComponent(here)}`,
      admin: (ref: DocRef) =>
        ref.kind === 'global'
          ? `${admin}/globals/${ref.slug}`
          : `${admin}/collections/${ref.slug}/${ref.id}`,
    }),
    [base, admin, here],
  )
}

const htmlLang = () =>
  (typeof document !== 'undefined' && document.documentElement.lang) || undefined

export function TanstackEditor(props: OnPageMountProps) {
  const locale = props.locale ?? htmlLang()
  const links = useLinks(props)
  const renderer = useTanstackRefresh()
  const { api, prefix } = routesOf(props)
  const dataSource = useMemo(
    () => props.dataSource ?? payloadRest({ apiBase: api, prefix }),
    [props.dataSource, api, prefix],
  )
  const media = useMemo(() => props.media ?? payloadUploads({ apiBase: api }), [props.media, api])
  const editors = useMemo(() => ({ ...lexicalEditors, ...props.editors }), [props.editors])
  if (inPreviewFrame()) return null
  return (
    <OnPageEditor
      dataSource={dataSource}
      media={media}
      locator={props.locator}
      renderer={renderer}
      editors={editors}
      links={links}
      locale={locale}
      messages={props.messages}
      uiLocale={props.uiLocale}
      onEvent={props.onEvent}
      assist={props.assist}
    />
  )
}

/**
 * A preview link covers one page, checked against the request URL. After
 * hydration, loaders run as server functions whose request URL isn't the page,
 * so a client-side navigation would load published content under a "Shared
 * preview" bar. Shared viewers get full page loads instead: each page is
 * rendered by the server for its own path, and the mount re-checks the grant.
 */
function useFullPageNavigation(enabled: boolean) {
  const router = useRouter()
  useEffect(() => {
    if (!enabled) return
    return router.subscribe('onBeforeNavigate', ({ pathChanged, toLocation }) => {
      if (pathChanged) window.location.assign(toLocation.href)
    })
  }, [enabled, router])
}

export function TanstackPreview(props: OnPageMountProps) {
  const links = useLinks(props)
  useFullPageNavigation(!!props.shared)
  return (
    <PreviewToolbar
      exitHref={links.exit}
      editHref={props.shared ? undefined : links.mode?.('edit')}
      shared={props.shared}
      messages={props.messages}
      uiLocale={props.uiLocale}
      commentsHref={props.shared ? `${routesOf(props).base}${ROUTES.comments}` : undefined}
    />
  )
}
