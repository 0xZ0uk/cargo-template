import { useEffect } from 'react'

/** The plugin's conversion endpoint (`POST {routes.api}/_ab/convert`). */
const CONVERT_URL = '/api/_ab/convert'

/**
 * Reports a click on a link inside a `[data-ab-goal]` element (the CTA block's buttons) as a
 * conversion for the page's experiment. Mounted only on pages in an experiment, so other
 * visitors run none of it.
 *
 * The body names only the experiment and the goal: the endpoint reads the bucket and visitor
 * id from the visitor's own cookies. `sendBeacon` survives the navigation the click starts;
 * where it's missing or refuses, a `keepalive` fetch does the same.
 */
export function AbConversionTracker({ experiment }: { experiment: string }) {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      const goal = link?.closest('[data-ab-goal]')?.getAttribute('data-ab-goal')
      if (!goal) return

      const body = JSON.stringify({ experiment, goal })
      if (navigator.sendBeacon?.(CONVERT_URL, body)) return
      void fetch(CONVERT_URL, {
        body,
        credentials: 'same-origin',
        keepalive: true,
        method: 'POST',
      }).catch(() => {})
    }

    // Capture phase: the router's link handler can't get in the way.
    document.addEventListener('click', onClick, { capture: true })
    return () => document.removeEventListener('click', onClick, { capture: true })
  }, [experiment])

  return null
}
