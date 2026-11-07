'use client'

import { errorText } from '@shipment/onpage-core'
import { useEffect, useState } from 'react'

/** A search the hook runs: it should stop when `signal` aborts. */
export type SearchFn<T> = (
  query: string,
  page: number,
  signal: AbortSignal,
) => Promise<{ items: T[]; hasMore: boolean }>

/**
 * Run `search(query, page, signal)` 250ms after the inputs settle; results
 * accumulate across pages and reset when the query changes. A superseded search
 * is aborted, and its response ignored. Re-runs when `search` changes, so keep
 * it stable (`useCallback`) with its inputs as dependencies.
 */
export function useDebouncedSearch<T>(search: SearchFn<T> | null) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<T[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!search) return
    let live = true
    const aborter = new AbortController()
    const timer = setTimeout(() => {
      setBusy(true)
      search(query, page, aborter.signal)
        .then((res) => {
          if (!live) return
          setItems((prev) => (page === 1 ? res.items : [...prev, ...res.items]))
          setHasMore(res.hasMore)
          setError(null)
        })
        .catch((e: unknown) => live && !aborter.signal.aborted && setError(errorText(e)))
        .finally(() => live && setBusy(false))
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
      aborter.abort()
    }
  }, [search, query, page])

  return {
    query,
    setQuery: (q: string) => {
      setQuery(q)
      setPage(1)
    },
    items,
    hasMore,
    more: () => setPage((p) => p + 1),
    busy,
    error,
  }
}
