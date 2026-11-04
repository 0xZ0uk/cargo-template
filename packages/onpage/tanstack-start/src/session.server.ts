/**
 * TanStack Start session adapter and helpers (server-only file: TanStack
 * Start never bundles `*.server.ts` for the browser).
 *
 * Editors: an `onpage` cookie saying which mode, sealed with the plugin
 * secret and bound to a hash of their auth cookie, so it can't be forged and
 * signing out (or in as someone else) ends it.
 *
 * Preview links: the browser gets only a sealed grant (`onpage_preview`) for
 * one path until it expires. Reads unseal it with the plugin secret and check
 * the request path, so the grant works on the shared page only. No middleware
 * or proxy is involved: Start request middleware cannot rewrite the request,
 * and draft state here is decided per read rather than by a framework draft
 * mode, so direct sealed reads give the same guarantees with fewer parts.
 *
 * All helpers fail closed outside a request (build, scripts, the browser):
 * they return null/false/{} instead of throwing.
 */
import {
  CONTEXT_KEY,
  COOKIE,
  createModeCookie,
  isLivePreviewGrant,
  readModeCookie,
  samePath,
  SEAL_PURPOSE,
  unseal,
  type OnPageMode,
  type SealSecret,
  type SessionAdapter,
} from '@cargo/onpage-core'
import {
  deleteCookie,
  getCookie,
  getRequestUrl,
  setCookie,
  setResponseHeader,
} from '@tanstack/react-start/server'
import { HINT_COOKIE } from './hint.ts'

export interface TanStackSessionOptions {
  /**
   * Same secret as the plugin (Payload's `secret`, i.e. PAYLOAD_SECRET, unless
   * the plugin's `secret` option is set). Required: reads verify the editor's
   * mode cookie and preview-link grants with it, so without it nobody sees
   * drafts (editors included). While rotating it, pass the plugin's same
   * `[new, old]` keyring.
   */
  secret?: SealSecret | undefined
  /** How long an editor's edit/preview mode lasts, in seconds. Default 12 hours. */
  maxAge?: number | undefined
}

type CookieOptions = NonNullable<Parameters<typeof setCookie>[2]>

/** Our credential cookies: server-only, same-site, whole site. */
const cookieBase = (secure: boolean): CookieOptions =>
  ({ httpOnly: true, sameSite: 'lax', secure, path: '/' }) satisfies CookieOptions

/** The hint beside them: readable by the mount, trusted by nothing. */
const hintBase = (secure: boolean): CookieOptions =>
  ({ httpOnly: false, sameSite: 'lax', secure, path: '/' }) satisfies CookieOptions

/**
 * The secret `tanstackSession({ secret })` was configured with, for unsealing
 * preview grants in reads. Module state is safe here: reads run in the same
 * server process that imports the Payload config.
 */
let previewSecret: SealSecret | undefined

/**
 * The sealed grant's `draft` field. It must be non-empty for the grant to be
 * well-formed, but Start redeems nothing from it: unlike Next there is no
 * framework draft cookie to inject, so verification is unseal + path + expiry.
 * A constant marker keeps grants debuggable; the seal is what makes them
 * unforgeable.
 */
const DRAFT_MARKER = 'tanstack-start'

/**
 * The mode the cookie grants in this request, or null: forged or unsealed,
 * expired, or the bound session is gone. Without a configured secret nothing
 * verifies, so nothing is granted.
 */
async function readMode(raw: string | undefined): Promise<OnPageMode | null> {
  if (!previewSecret) return null
  return (await readModeCookie(raw, getCookie, previewSecret))?.mode ?? null
}

export function tanstackSession(opts: TanStackSessionOptions = {}): SessionAdapter {
  if (opts.secret !== undefined) previewSecret = opts.secret
  const maxAge = opts.maxAge ?? 12 * 3600
  return {
    async enable(mode, { secure, bindTo, sealMode }) {
      if (!previewSecret)
        console.warn(
          'payload-onpage: tanstackSession() has no secret, so edit mode cannot be verified on the page. Pass tanstackSession({ secret: process.env.PAYLOAD_SECRET }).',
        )
      const value = await createModeCookie(mode, {
        sealMode,
        expiresAt: new Date(Date.now() + maxAge * 1000),
        bindTo,
        token: bindTo ? getCookie(bindTo) : undefined,
      })
      setCookie(COOKIE.mode, value, { ...cookieBase(secure), maxAge })
      deleteCookie(COOKIE.preview, { path: '/' })
      setCookie(HINT_COOKIE, '1', { ...hintBase(secure), maxAge })
    },
    async enableLink({ secure, path: _path, expiresAt, seal }) {
      // The plugin's `seal` embeds the path, ref and expiry; the browser only
      // gets the sealed grant, never anything it could redeem elsewhere.
      setCookie(COOKIE.preview, await seal(DRAFT_MARKER), {
        ...cookieBase(secure),
        expires: expiresAt,
      })
      deleteCookie(COOKIE.mode, { path: '/' })
      setCookie(HINT_COOKIE, '1', { ...hintBase(secure), expires: expiresAt })
    },
    disable() {
      deleteCookie(COOKIE.mode, { path: '/' })
      deleteCookie(COOKIE.preview, { path: '/' })
      deleteCookie(HINT_COOKIE, { path: '/' })
      return Promise.resolve()
    },
    getMode: getOnPageMode,
  }
}

/** "edit", "view" or null for this request. Safe to call anywhere (null outside a request). */
export async function getOnPageMode(): Promise<OnPageMode | null> {
  try {
    return await readMode(getCookie(COOKIE.mode))
  } catch {
    return null
  }
}

/** A live sealed grant for `pathname`. Grants without a configured secret never validate. */
async function liveGrantFor(pathname: string): Promise<boolean> {
  if (!previewSecret) return false
  const grant = await unseal(getCookie(COOKIE.preview), previewSecret, SEAL_PURPOSE.previewCookie)
  if (!isLivePreviewGrant(grant)) return false
  return samePath(pathname, grant.path)
}

/** A live sealed grant for this request's path. Grants without a configured secret never validate. */
async function liveGrant(): Promise<boolean> {
  return liveGrantFor(getRequestUrl().pathname)
}

/** Is this request a preview-link view of the shared page? Safe to call anywhere (false outside a request). */
export async function isSharedPreview(): Promise<boolean> {
  try {
    return await liveGrant()
  } catch {
    return false
  }
}

/**
 * Is there a live sealed grant for `pathname`? The mount calls this through a
 * server function with its own path: inside a browser-invoked server function
 * the request URL is the RPC endpoint, not the page. The answer only gates UI
 * chrome — page content stays gated by request-URL checks — so a
 * client-supplied path cannot leak drafts.
 */
export async function isSharedPreviewFor(pathname: string): Promise<boolean> {
  try {
    return await liveGrantFor(pathname)
  } catch {
    return false
  }
}

/**
 * Should this request render drafts? Editors with a live bound session see
 * drafts site-wide; preview-link viewers see the shared page's draft only.
 * When it says yes, the response is marked `Cache-Control: private, no-store`
 * so no CDN or shared cache keeps the draft. Safe to call anywhere (false
 * outside a request).
 */
export async function isDraftEnabled(): Promise<boolean> {
  try {
    const draft = (await readMode(getCookie(COOKIE.mode))) !== null || (await liveGrant())
    // Start has no framework draft mode keeping drafts out of shared caches: mark it here.
    if (draft) setResponseHeader('Cache-Control', 'private, no-store')
    return draft
  } catch {
    return false
  }
}

/** What `onpageContext()` adds to a Payload read in edit mode. */
export type OnPageReadContext = { context?: { [CONTEXT_KEY]: true } }

/**
 * Spread into Payload reads that feed the page: in edit mode it turns on
 * auto-mapping markers, otherwise it is empty.
 *
 *   payload.find({ collection: 'pages', where, draft, ...(await onpageContext()) })
 */
export async function onpageContext(): Promise<OnPageReadContext> {
  return (await getOnPageMode()) === 'edit' ? { context: { [CONTEXT_KEY]: true } } : {}
}
