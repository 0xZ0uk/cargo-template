'use client'

import { useEffect, useState } from 'react'

/**
 * Fork addition: the admin view at `/admin/mcp-oauth/continue?to=<authorize URL>`. The authorize
 * endpoint sends a signed-out user to the admin login with this view as the `redirect`: the login
 * form navigates there with the admin's client-side router, which can't render an API route
 * (TanStack Start shows a 404), so this view finishes the trip with a full page load. It only ever
 * goes to this site's OAuth authorize endpoint.
 */
export const OAuthContinueView = () => {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const to = new URLSearchParams(window.location.search).get('to') ?? ''
    let target: URL | undefined
    try {
      target = new URL(to, window.location.origin)
    } catch {
      target = undefined
    }
    if (
      target &&
      to.startsWith('/') &&
      !to.startsWith('//') &&
      target.origin === window.location.origin &&
      target.pathname.endsWith('/oauth/authorize')
    ) {
      window.location.replace(target.toString())
    } else {
      setFailed(true)
    }
  }, [])
  return <p style={{ margin: '2rem', textAlign: 'center' }}>{failed ? 'Invalid request.' : '…'}</p>
}
