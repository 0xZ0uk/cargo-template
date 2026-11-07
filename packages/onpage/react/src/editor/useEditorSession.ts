'use client'

import { EditorSession, type DataSource, type DocRef } from '@shipment/onpage-core'
import { useEffect, useState } from 'react'
import { useEvent } from '../useEvent.ts'

/**
 * One editor session per data source and locale, disposed (after flushing its
 * saves) when they change or on unmount. It lives in state, so StrictMode's
 * mount/unmount/mount gets a fresh one each time.
 */
export function useEditorSession(opts: {
  dataSource: DataSource
  locale: string | undefined
  autosaveDelay: number | undefined
  onSaved: (ref: DocRef, seq: number) => void
}): EditorSession | null {
  const { dataSource, locale, autosaveDelay } = opts
  const onSaved = useEvent(opts.onSaved)
  const [session, setSession] = useState<EditorSession | null>(null)
  useEffect(() => {
    const s = new EditorSession({
      dataSource,
      locale,
      autosaveDelay,
      onSaved: (ref, seq) => onSaved(ref, seq),
    })
    // The session is an external resource with a lifecycle (see above).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(s)
    return () => {
      void s.flush().finally(() => s.dispose())
    }
  }, [dataSource, locale, autosaveDelay, onSaved])
  return session
}
