import { useEffect } from 'react'

type Gtag = (command: string, ...args: unknown[]) => void

let configured = false

/**
 * Sends the GA4 `config` command (and so the first page view) for a full page load, after the
 * sibling `<ExperimentTracker>` has set its custom dimensions: gtag runs its queue in order, so
 * the page view carries the experiment, bucket and visitor id. The head's inline snippet
 * (`gtagScripts` in `@/utilities/googleAnalytics`) only defines `gtag` and queues `js`; the config
 * lives here for that ordering. Client-side navigation after it is left to GA4's own
 * history-change page views (Enhanced measurement), so it runs once per page load.
 *
 * Mounted only when `GA_MEASUREMENT_ID` is set and the page isn't a draft.
 */
export function GoogleAnalyticsConfig({ measurementId }: { measurementId: string }) {
  useEffect(() => {
    const gtag = (window as Window & { gtag?: Gtag }).gtag
    if (configured || typeof gtag !== 'function') return
    configured = true
    gtag('config', measurementId)
  }, [measurementId])

  return null
}
