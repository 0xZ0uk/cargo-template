// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDebouncedSearch } from '../editors/useDebouncedSearch.ts'

describe('useDebouncedSearch', () => {
  it('aborts a superseded search and keeps only the latest results', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const search = vi.fn((query: string, _page: number, signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<{ items: string[]; hasMore: boolean }>((resolve) =>
        setTimeout(() => resolve({ items: [query], hasMore: false }), 1000),
      )
    })
    const { result } = renderHook(() => useDebouncedSearch(search))
    await act(async () => void vi.advanceTimersByTime(300)) // first search starts
    act(() => result.current.setQuery('lamp')) // supersedes it
    expect(signals[0]?.aborted).toBe(true)
    await act(async () => void vi.advanceTimersByTime(300))
    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)))
    expect(result.current.items).toEqual(['lamp'])
    expect(signals.at(-1)?.aborted).toBe(false)
    vi.useRealTimers()
  })
})
