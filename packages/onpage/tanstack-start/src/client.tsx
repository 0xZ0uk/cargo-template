/**
 * Client side of the TanStack Start adapter. `OnPageMount` is tiny: the editor
 * itself is loaded only when someone is editing or previewing.
 */
import { lazy, Suspense } from 'react'
import type { AssistPort, DataSource, Locator, MediaLibrary, OnPageMode } from '@shipment/onpage-core'
import type { FieldEditorDef, Messages, OnPageEvent } from '@shipment/onpage-react'

export interface OnPageMountProps {
  mode: OnPageMode
  /** Opened from a shared preview link (no editing). */
  shared?: boolean | undefined
  /** Payload API route. Default "/api". */
  apiRoute?: string | undefined
  /** Plugin endpoint prefix. Default "/onpage". */
  prefix?: `/${string}` | undefined
  /** Payload admin route. Default "/admin". */
  adminRoute?: string | undefined
  /** Locale to edit. Default: <html lang>. */
  locale?: string | undefined
  editors?: Record<string, FieldEditorDef | null> | undefined
  locator?: Locator | undefined
  media?: MediaLibrary | undefined
  dataSource?: DataSource | undefined
  /** Saves, conflicts, publishes and failures, for logging or error reporting (client-only). */
  onEvent?: ((event: OnPageEvent) => void) | undefined
  /** A writing assistant for text fields (client-only; see the assist guide). */
  assist?: AssistPort | undefined
  /** Override editor UI strings (see `defaultMessages` in @shipment/onpage-react). */
  messages?: Messages | undefined
  /** The language of `messages`, for plurals, dates and times in the editor UI. Default "en". */
  uiLocale?: string | undefined
}

const Editor = lazy(() => import('./editor.tsx').then((m) => ({ default: m.TanstackEditor })))
const Preview = lazy(() => import('./editor.tsx').then((m) => ({ default: m.TanstackPreview })))

export function OnPageMount(props: OnPageMountProps) {
  return (
    <Suspense fallback={null}>
      {props.mode === 'edit' ? <Editor {...props} /> : <Preview {...props} />}
    </Suspense>
  )
}

export { OnPageClient } from '@shipment/onpage-react/client'
export { useTanstackRefresh } from './refresh.ts'
