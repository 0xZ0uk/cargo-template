// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DataSource, DocumentSchema, Renderer } from '@cargo/onpage-core'
import { OnPageEditor } from '../editor/OnPageEditor.tsx'
import { clientState, fullReload } from '../renderers.ts'

const schema: DocumentSchema = {
  kind: 'collection',
  slug: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  editable: ['title'],
  drafts: true,
  fields: [{ name: 'title', type: 'text', label: 'Title' }],
}

function setup(ds: Partial<DataSource> = {}) {
  let renderDone!: () => void
  const renderer: Renderer = {
    name: 'test',
    live: false,
    afterSave: vi.fn(() => new Promise<void>((r) => (renderDone = r))),
  }
  const source: DataSource = {
    loadSchema: async () => schema,
    loadDocument: async () => ({ id: 1, title: 'Hello', updatedAt: 'v0', _status: 'draft' }),
    saveDraft: async () => ({ ok: true }),
    publish: async () => ({ ok: true }),
    createPreviewLink: async () => ({
      url: 'https://x/preview?token=1',
      expiresAt: '2030-01-01T00:00:00.000Z',
    }),
    ...ds,
  }
  document.body.innerHTML = `<h1 data-onpage-ref="c:pages:1" data-onpage-field="title" data-onpage-kind="text">Hello</h1>`
  const host = document.createElement('div')
  document.body.appendChild(host)
  render(
    <OnPageEditor
      dataSource={source}
      renderer={renderer}
      links={{ exit: '/exit', admin: () => '/admin/x' }}
      autosaveDelay={0}
    />,
    { container: host },
  )
  return { renderer, finishRender: () => renderDone() }
}

describe('refresh mode', () => {
  it('keeps a ghost of the new text until the server render lands', async () => {
    const { renderer, finishRender } = setup()
    await waitFor(() =>
      expect(screen.getByTestId('onpage-status').textContent).toBe('Editing draft'),
    )
    fireEvent.click(document.querySelector('h1')!)
    const inline = await screen.findByTestId('onpage-inline-text')
    inline.textContent = 'New text'
    fireEvent.keyDown(inline, { key: 'Enter' })
    const ghost = await screen.findByTestId('onpage-ghost')
    expect(ghost.textContent).toBe('New text')
    await waitFor(() => expect(renderer.afterSave).toHaveBeenCalled())
    expect(screen.getByTestId('onpage-status').textContent).toBe('Updating page…')
    finishRender()
    await waitFor(() => expect(screen.queryByTestId('onpage-ghost')).toBeNull(), { timeout: 2000 })
  })
})

describe('dock actions', () => {
  it('share copies a link; discard needs two clicks; publish re-renders', async () => {
    const write = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: write },
      configurable: true,
    })
    const discard = vi.fn(async () => ({ id: 1, title: 'Live', updatedAt: 'v9' }))
    const { renderer, finishRender } = setup({
      loadDocument: async (_r, o) =>
        o.draft ? { id: 1, title: 'Hello', updatedAt: 'v0', _status: 'draft' } : discard(),
    })
    await waitFor(() =>
      expect(screen.getByTestId('onpage-status').textContent).toBe('Editing draft'),
    )
    fireEvent.click(screen.getByTestId('onpage-share'))
    await waitFor(() => expect(write).toHaveBeenCalledWith('https://x/preview?token=1'))
    expect(screen.getByTestId('onpage-status').textContent).toMatch(/Preview link copied/)
    fireEvent.click(screen.getByTestId('onpage-discard'))
    expect(screen.getByTestId('onpage-discard').textContent).toBe('Confirm discard?')
    fireEvent.click(screen.getByTestId('onpage-discard'))
    await waitFor(() => expect(discard).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('onpage-publish'))
    await waitFor(() => expect(renderer.afterSave).toHaveBeenCalled())
    finishRender()
    expect(screen.getByTestId('onpage-open-admin').getAttribute('href')).toBe('/admin/x')
  })

  it('a conflict offers "Reload latest"', async () => {
    setup({ saveDraft: async () => ({ ok: false, status: 409, message: 'stale' }) })
    await waitFor(() =>
      expect(screen.getByTestId('onpage-status').textContent).toBe('Editing draft'),
    )
    fireEvent.click(document.querySelector('h1')!)
    const inline = await screen.findByTestId('onpage-inline-text')
    inline.textContent = 'Mine'
    fireEvent.keyDown(inline, { key: 'Enter' })
    await screen.findByTestId('onpage-reload')
    expect(screen.getByTestId('onpage-status').textContent).toMatch(/changed by someone else/)
    expect(screen.getByTestId<HTMLButtonElement>('onpage-publish').disabled).toBe(true)
  })
})

describe('renderers', () => {
  it('clientState is live; fullReload reloads', () => {
    expect(clientState().live).toBe(true)
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      configurable: true,
    })
    void fullReload().afterSave({ refs: [] })
    expect(reload).toHaveBeenCalled()
  })
})
