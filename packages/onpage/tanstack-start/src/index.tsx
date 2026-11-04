/**
 * @cargo/onpage-tanstack-start — payload-onpage for TanStack Start.
 *
 *   // payload.config.ts (import from /session: it has no client code)
 *   import { tanstackSession } from '@cargo/onpage-tanstack-start/session'
 *   plugins: [onpage({ collections: ['pages'], session: tanstackSession({ secret: process.env.PAYLOAD_SECRET }) })]
 *
 *   // root route — renders nothing for visitors
 *   <OnPage />
 *
 *   // where a loader reads Payload (import from /session)
 *   import { isDraftEnabled, onpageContext } from '@cargo/onpage-tanstack-start/session'
 *   payload.find({ collection: 'pages', draft: await isDraftEnabled(), ...(await onpageContext()) })
 */
import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import type { OnPageMode } from '@cargo/onpage-core'
import { OnPageMount, type OnPageMountProps } from './client.tsx'
import { HINT_COOKIE } from './hint.ts'
import { getOnPageState } from './state.functions.ts'

export interface OnPageProps extends Omit<OnPageMountProps, 'mode' | 'shared'> {
  /**
   * Your own mount, to pass client options (custom field editors, locator,
   * media library…):
   *
   *   export const Mount = (p: OnPageMountProps) => <OnPageMount {...p} editors={{ json: myJsonEditor }} />
   */
  mount?: ComponentType<OnPageMountProps>
}

export type { OnPageMountProps } from './client.tsx'
export type { OnPageState } from './state.functions.ts'

/** The hint cookie is present (editors and preview-link viewers only — never visitors). */
const hasHint = () =>
  typeof document !== 'undefined' &&
  document.cookie.split(';').some((c) => c.trim().startsWith(`${HINT_COOKIE}=`))

/**
 * Mounts the editor (edit mode) or the preview toolbar (preview mode) and
 * renders nothing otherwise. Visitor-safe: without the hint cookie it issues
 * no requests at all; with it, one state lookup whose answer the server
 * derives from credentials the browser can't read.
 */
export function OnPage({ mount: Mount = OnPageMount, ...props }: OnPageProps) {
  const [state, setState] = useState<{ mode: OnPageMode | null; shared: boolean } | null>(null)
  useEffect(() => {
    if (!hasHint()) return
    let live = true
    getOnPageState({ data: { pathname: window.location.pathname } }).then(
      (s) => {
        if (live) setState(s)
      },
      () => {
        if (live) setState(null)
      },
    )
    return () => {
      live = false
    }
  }, [])
  if (!state || (!state.mode && !state.shared)) return null
  return <Mount {...props} mode={state.mode ?? 'view'} shared={state.shared} />
}
