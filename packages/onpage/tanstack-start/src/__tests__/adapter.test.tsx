// @vitest-environment happy-dom
import { act, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({
  invalidate: vi.fn(async () => {}),
  listeners: [] as Array<{ event: string; fn: (e: unknown) => void }>,
  pathname: '/about',
  searchStr: '?x=1',
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    invalidate: nav.invalidate,
    subscribe: (event: string, fn: (e: unknown) => void) => {
      const l = { event, fn }
      nav.listeners.push(l)
      return () => nav.listeners.splice(nav.listeners.indexOf(l), 1)
    },
  }),
  useLocation: () => ({ pathname: nav.pathname, searchStr: nav.searchStr }),
}))
const getOnPageState = vi.fn()
vi.mock('../state.functions.ts', () => ({ getOnPageState }))

const { useTanstackRefresh } = await import('../refresh.ts')
const { OnPage } = await import('../index.tsx')
const { TanstackPreview } = await import('../editor.tsx')

beforeEach(() => {
  nav.invalidate.mockReset()
  getOnPageState.mockReset()
  document.cookie = 'onpage_hint=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

describe('useTanstackRefresh', () => {
  it('debounces saves into one router.invalidate and resolves when it settles', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useTanstackRefresh())
    expect(result.current.live).toBe(false)
    const a = result.current.afterSave({ refs: [] })
    const b = result.current.afterSave({ refs: [] })
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(nav.invalidate).toHaveBeenCalledTimes(1)
    await expect(Promise.all([a, b])).resolves.toBeDefined()
    vi.useRealTimers()
  })

  it('never hangs the editor when invalidation never settles', async () => {
    vi.useFakeTimers()
    nav.invalidate.mockImplementation(() => new Promise<void>(() => {}))
    const { result } = renderHook(() => useTanstackRefresh())
    const a = result.current.afterSave({ refs: [] })
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    await expect(a).resolves.toBeUndefined()
    vi.useRealTimers()
  })
})

describe('<OnPage>', () => {
  it('renders nothing for visitors and issues no requests', () => {
    render(<OnPage />)
    expect(document.body.textContent).toBe('')
    expect(getOnPageState).not.toHaveBeenCalled()
  })

  it('with the hint cookie, resolves state and mounts with mode and shared flag', async () => {
    document.cookie = 'onpage_hint=1'
    getOnPageState.mockResolvedValue({ mode: 'view', shared: true })
    const Mount = vi.fn(() => null)
    render(<OnPage mount={Mount} apiRoute="/api" />)
    await act(async () => {})
    expect(getOnPageState).toHaveBeenCalledTimes(1)
    expect(getOnPageState).toHaveBeenCalledWith({ data: { pathname: '/' } })
    expect(Mount).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'view', shared: true, apiRoute: '/api' }),
      undefined,
    )
  })

  it('a failed lookup renders nothing', async () => {
    document.cookie = 'onpage_hint=1'
    getOnPageState.mockRejectedValue(new Error('down'))
    const Mount = vi.fn(() => null)
    render(<OnPage mount={Mount} />)
    await act(async () => {})
    expect(Mount).not.toHaveBeenCalled()
  })
})

describe('TanstackPreview', () => {
  it('posts to the plugin endpoints with the current path', () => {
    render(<TanstackPreview mode="view" apiRoute="/cms-api" prefix="/op" />)
    const exit = screen.getByTestId('onpage-exit-preview').closest('form')!
    expect(exit.getAttribute('action')).toBe(
      `/cms-api/op/exit?path=${encodeURIComponent('/about?x=1')}`,
    )
    expect(screen.getByTestId('onpage-edit').closest('form')!.getAttribute('action')).toContain(
      '/cms-api/op/mode?mode=edit',
    )
  })
  it('link viewers get no Edit button', () => {
    render(<TanstackPreview mode="view" shared />)
    expect(screen.queryByTestId('onpage-edit')).toBeNull()
  })
  it('link viewers navigate with full page loads, so the server checks each page', () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    try {
      const { unmount } = render(<TanstackPreview mode="view" shared />)
      const navigate = (e: unknown) =>
        nav.listeners.filter((l) => l.event === 'onBeforeNavigate').forEach((l) => l.fn(e))
      navigate({ pathChanged: false, toLocation: { href: '/about?tab=2' } })
      expect(assign).not.toHaveBeenCalled()
      navigate({ pathChanged: true, toLocation: { href: '/pricing' } })
      expect(assign).toHaveBeenCalledWith('/pricing')
      unmount()
      expect(nav.listeners).toHaveLength(0)
      // Editors keep client-side navigation.
      render(<TanstackPreview mode="view" />)
      expect(nav.listeners).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
