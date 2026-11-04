/**
 * Holds Payload's document lock for each document on the page while editing:
 * taken once it has loaded, refreshed every minute and after each save (a
 * save clears it on the server), and released on unmount. Reports who else
 * holds a lock, so the dock can say so before a save is refused.
 */
import { isReady, type EditorSession, type RefKey } from '@cargo/onpage-core'
import { useEffect, useRef, useState } from 'react'

const REFRESH_MS = 60_000

export function useDocumentLocks(
  session: EditorSession | null,
  docKeys: RefKey[],
): Readonly<Record<RefKey, string>> {
  const [lockedBy, setLockedBy] = useState<Readonly<Record<RefKey, string>>>({})
  const keys = docKeys.join('|')
  const held = useRef(new Set<RefKey>())

  useEffect(() => {
    const ds = session?.dataSource
    if (!session || !ds?.lock) return
    const lock = ds.lock.bind(ds)
    const wanted = new Set(keys ? (keys.split('|') as RefKey[]) : [])
    const seq = new Map<RefKey, number>()
    let live = true

    const take = (key: RefKey) => {
      const state = session.getSnapshot().docs[key]
      if (!isReady(state)) return
      lock(state.ref, 'take').then(
        ({ lockedBy: who }) => {
          if (!live) return
          if (who) held.current.delete(key)
          else held.current.add(key)
          setLockedBy((prev) => {
            if ((prev[key] ?? null) === who) return prev
            const next = { ...prev }
            if (who) next[key] = who
            else delete next[key]
            return next
          })
        },
        () => undefined, // locking is best effort: saves still check it on the server
      )
    }
    const check = () => {
      for (const key of wanted) {
        const state = session.getSnapshot().docs[key]
        if (!isReady(state)) continue
        const before = seq.get(key)
        if (before === undefined || state.save.seq > before) {
          seq.set(key, state.save.seq)
          take(key)
        }
      }
    }
    check()
    const off = session.subscribe(check)
    const timer = setInterval(() => wanted.forEach(take), REFRESH_MS)
    const heldNow = held.current
    return () => {
      live = false
      off()
      clearInterval(timer)
      for (const key of [...heldNow]) {
        const state = session.getSnapshot().docs[key]
        heldNow.delete(key)
        if (state) void lock(state.ref, 'release').catch(() => undefined)
      }
    }
  }, [session, keys])

  return lockedBy
}
