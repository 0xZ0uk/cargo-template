/**
 * The mount's state lookup. A server function (safe to import anywhere:
 * TanStack Start replaces it with an RPC stub in the browser), so the client
 * mount can resolve the request's mode without ever seeing a credential.
 */
import { createServerFn } from '@tanstack/react-start'
import type { OnPageMode } from '@shipment/onpage-core'

export interface OnPageState {
  mode: OnPageMode | null
  /** Opened from a shared preview link (view-only, even with a mode). */
  shared: boolean
}

export const getOnPageState = createServerFn({ method: 'GET' })
  // The mount passes its own path: in here the request URL is the RPC
  // endpoint, not the page, so request-URL grant checks would always fail.
  // Missing or garbage input checks the site root (fail closed, never throws).
  .validator((data: { pathname?: string } | undefined) => ({
    pathname: typeof data?.pathname === 'string' ? data.pathname : '/',
  }))
  .handler(async ({ data }): Promise<OnPageState> => {
    // Dynamic import: session helpers are server-only (they read cookies).
    const { getOnPageMode, isSharedPreviewFor } = await import('./session.server.ts')
    const [mode, shared] = await Promise.all([getOnPageMode(), isSharedPreviewFor(data.pathname)])
    return { mode, shared }
  })
