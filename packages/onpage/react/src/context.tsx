'use client'

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { EditorSession, SessionSnapshot } from '@shipment/onpage-core'
import { hub } from './hub.ts'
import type { OnPageApi, OnPageContextValue, OnPageState } from './types.ts'

const ApiContext = createContext<OnPageApi | null>(null)
const StateContext = createContext<OnPageState | null>(null)

/** Provides the editor to everything it renders (two contexts: the stable API and the changing state). */
export function OnPageProvider({
  api,
  state,
  children,
}: {
  api: OnPageApi
  state: OnPageState
  children: ReactNode
}) {
  return (
    <ApiContext.Provider value={api}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ApiContext.Provider>
  )
}

/** The editor, for code rendered inside it (field editors, panels): its API and state. */
export function useOnPage(): OnPageContextValue {
  const api = useContext(ApiContext)
  const state = useContext(StateContext)
  if (!api || !state) throw new Error('useOnPage must be used inside <OnPageEditor>')
  return { ...api, ...state }
}

/** Only the editor's API (session, actions): re-renders when the editor is reconfigured, not on every edit. */
export function useOnPageApi(): OnPageApi {
  const api = useContext(ApiContext)
  if (!api) throw new Error('useOnPageApi must be used inside <OnPageEditor>')
  return api
}

const getNull = () => null

/**
 * The editor's API from inside it or anywhere on the page; null when no editor
 * is mounted (public pages). Read documents with `useSessionSnapshot(api?.session)`.
 */
export function useOnPageOptional(): OnPageApi | null {
  const inside = useContext(ApiContext)
  const outside = useSyncExternalStore(hub.subscribe, hub.get, getNull)
  return inside ?? outside
}

const EMPTY: SessionSnapshot = { docs: {}, canUndo: false, canRedo: false, busy: false }
const noopSubscribe = () => () => {}
const getEmpty = () => EMPTY

/** A session's documents, re-rendering when they change (an empty snapshot without a session). */
export function useSessionSnapshot(session: EditorSession | null | undefined): SessionSnapshot {
  return useSyncExternalStore(
    session?.subscribe ?? noopSubscribe,
    session?.getSnapshot ?? getEmpty,
    getEmpty,
  )
}
