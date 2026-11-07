/**
 * Turns the session's state changes into `OnPageEvent`s for `onEvent`: a save
 * landed or failed, a conflict, a document that couldn't load.
 */
import type { EditorSession, RefKey } from '@shipment/onpage-core'
import { useEffect } from 'react'
import type { OnPageEvent } from '../types.ts'

interface Seen {
  save: string
  seq: number
  status: string
}

export function useSessionEvents(
  session: EditorSession | null,
  report: (event: OnPageEvent) => void,
) {
  useEffect(() => {
    if (!session) return
    const seen = new Map<RefKey, Seen>()
    const check = () => {
      for (const d of Object.values(session.getSnapshot().docs)) {
        const before = seen.get(d.key)
        const now = { save: d.save.status, seq: d.save.seq, status: d.status }
        seen.set(d.key, now)
        if (!before) {
          if (now.status === 'error')
            report({ type: 'loadFailed', ref: d.ref, message: d.error ?? '' })
          continue
        }
        if (now.seq > before.seq) report({ type: 'saved', ref: d.ref })
        if (now.save !== before.save && now.save === 'error')
          report({ type: 'saveFailed', ref: d.ref, message: d.save.message ?? '' })
        if (now.save !== before.save && now.save === 'conflict')
          report({ type: 'conflict', ref: d.ref })
        if (now.status !== before.status && now.status === 'error')
          report({ type: 'loadFailed', ref: d.ref, message: d.error ?? '' })
      }
    }
    check()
    return session.subscribe(check)
  }, [session, report])
}
