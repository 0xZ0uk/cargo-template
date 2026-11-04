// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ui = vi.hoisted(
  (): {
    id: number | undefined
    canSave: boolean | undefined
    toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }
  } => ({
    id: 5,
    canSave: true,
    toast: { success: vi.fn(), error: vi.fn() },
  }),
)
vi.mock('@payloadcms/ui', () => ({
  Button: ({
    children,
    onClick,
    extraButtonProps,
  }: {
    children: React.ReactNode
    onClick?: () => void
    extraButtonProps?: Record<string, unknown>
  }) => (
    <button
      type="button"
      onClick={onClick}
      data-testid={extraButtonProps?.['data-testid'] as string}
    >
      {children}
    </button>
  ),
  toast: ui.toast,
  useConfig: () => ({ config: { serverURL: '', routes: { api: '/api' } } }),
  useDocumentInfo: () => ({ id: ui.id, hasSavePermission: ui.canSave }),
  useLocale: () => ({ code: 'en' }),
  useTranslation: () => ({
    t: (k: string, v?: Record<string, string>) => `${k}${v ? JSON.stringify(v) : ''}`,
  }),
}))

const { OnPageAdminControls } = await import('../admin/OnPageAdminControls.tsx')

beforeEach(() => {
  ui.id = 5
  ui.canSave = true
  vi.restoreAllMocks()
})

describe('OnPageAdminControls', () => {
  it('is hidden for unsaved documents and users without update permission', () => {
    ui.id = undefined
    const { container, rerender } = render(
      <OnPageAdminControls kind="collection" slug="pages" prefix="/onpage" />,
    )
    expect(container.innerHTML).toBe('')
    ui.id = 5
    ui.canSave = false
    rerender(<OnPageAdminControls kind="collection" slug="pages" prefix="/onpage" />)
    expect(container.innerHTML).toBe('')
  })
  it('"Edit on page" submits a same-origin POST in a new tab', () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (
      this: HTMLFormElement,
    ) {
      expect(this.method).toBe('post')
      expect(this.target).toBe('_blank')
      expect(this.rel).toBe('noopener')
      expect(this.action).toContain(
        '/api/onpage/enter?kind=collection&slug=pages&mode=edit&id=5&locale=en',
      )
    })
    render(<OnPageAdminControls kind="collection" slug="pages" prefix="/onpage" />)
    fireEvent.click(screen.getByTestId('onpage-edit-on-page'))
    expect(submit).toHaveBeenCalled()
  })
  it('copies a preview link created through the DataSource', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              url: 'https://x/preview?token=t',
              expiresAt: '2030-01-01T00:00:00.000Z',
            }),
            { status: 200 },
          ),
      ),
    )
    const write = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: write },
      configurable: true,
    })
    render(<OnPageAdminControls kind="collection" slug="pages" prefix="/onpage" />)
    fireEvent.click(screen.getByTestId('onpage-copy-preview-link'))
    await waitFor(() => expect(write).toHaveBeenCalledWith('https://x/preview?token=t'))
    expect(ui.toast.success).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
