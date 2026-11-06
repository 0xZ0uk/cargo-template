const MEASUREMENT_ID = /^G-[A-Z0-9]+$/

/**
 * The GA4 measurement ID a view may load, or null. Null for an unset or malformed id
 * (`GA_MEASUREMENT_ID`, validated as `G-…` in `.env.schema`) and for every draft: live preview,
 * on-page editing and preview links never load Google Analytics. The admin doesn't use this
 * path at all (its routes aren't the frontend's).
 */
export const gaMeasurementIdFor = (id: string | undefined, draft: boolean): string | null =>
  !draft && id && MEASUREMENT_ID.test(id) ? id : null

/**
 * The GA4 tag for a public page's `<head>`: gtag.js (async) and an inline snippet that defines
 * `gtag` and queues `js`. The `config` call is made by `GoogleAnalyticsConfig` once the page's
 * experiment dimensions are set. The id only goes into the script URL; the inline snippet is
 * static. Nothing without an id.
 */
export const gtagScripts = (measurementId?: string | null) =>
  measurementId && MEASUREMENT_ID.test(measurementId)
    ? [
        {
          async: true,
          src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`,
        },
        {
          children:
            'window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}' +
            "gtag('js',new Date());",
        },
      ]
    : []
