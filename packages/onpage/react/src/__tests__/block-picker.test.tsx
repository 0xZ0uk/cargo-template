// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DataSource, DocumentSchema, Renderer, SchemaBlock } from '@shipment/onpage-core'
import { hub } from '../hub.ts'
import { groupBlocks } from '../ui/lazy/BlockPicker.tsx'

const KEY = 'c:pages:1' as const

const hero: SchemaBlock = {
  slug: 'hero',
  labels: { singular: 'Hero', plural: 'Heroes' },
  fields: [{ name: 'heading', type: 'text', label: 'Heading', defaultValue: 'New hero' }],
  thumbnail: { url: '/blocks/hero.png', alt: 'Big heading over an image' },
  example: { heading: 'Your headline here' },
}
const content: SchemaBlock = {
  slug: 'content',
  labels: { singular: 'Content', plural: 'Content' },
  fields: [{ name: 'body', type: 'textarea', label: 'Body' }],
  group: 'Text',
}

const schema: DocumentSchema = {
  kind: 'collection',
  slug: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  editable: ['title', 'layout'],
  drafts: true,
  fields: [
    { name: 'title', type: 'text', label: 'Title' },
    {
      name: 'layout',
      type: 'blocks',
      label: 'Layout',
      labels: { singular: 'Section', plural: 'Sections' },
      blocks: [hero, content],
    },
  ],
}

function fakeSource() {
  const saves: Array<Record<string, unknown>> = []
  const ds: DataSource = {
    loadSchema: async () => schema,
    loadDocument: async () => ({
      id: 1,
      updatedAt: 'v0',
      title: 'Hello',
      layout: [{ id: 's1', blockType: 'content', body: 'First' }],
    }),
    saveDraft: async (_ref, data) => {
      saves.push(data)
      return { ok: true, updatedAt: `v${saves.length}` }
    },
    publish: async () => ({ ok: true }),
  }
  return { ds, saves }
}

const refresh: Renderer = { name: 'test-refresh', live: false, afterSave: () => {} }

async function mount(ds: DataSource, renderer?: Renderer) {
  const { OnPageEditor } = await import('../editor/OnPageEditor.tsx')
  document.body.innerHTML = `
    <main>
      <h1 data-onpage-ref="${KEY}" data-onpage-field="title" data-onpage-kind="text">Hello</h1>
      <div data-onpage-ref="${KEY}" data-onpage-list="layout">
        <section data-onpage-ref="${KEY}" data-onpage-row="layout.0">First</section>
      </div>
    </main>`
  const container = document.createElement('div')
  document.body.appendChild(container)
  render(
    <OnPageEditor
      dataSource={ds}
      links={{ exit: '/exit' }}
      autosaveDelay={0}
      {...(renderer ? { renderer } : {})}
    />,
    { container },
  )
  await waitFor(() => expect(screen.getByTestId('onpage-status').textContent).toBe('Editing draft'))
  const api = hub.get()
  if (!api) throw new Error('editor not mounted')
  act(() => api.setPanel({ kind: 'blocks', key: KEY, listPath: 'layout', index: 1 }))
  await screen.findByTestId('onpage-block-picker')
  const layout = () =>
    (api.session.getSnapshot().docs[KEY]?.doc?.layout ?? []) as Array<Record<string, unknown>>
  return { api, layout }
}

const settle = () => new Promise((r) => setTimeout(r, 200))

describe('groupBlocks', () => {
  it('keeps config order, ungrouped last (as in Payload)', () => {
    const a = { ...content, slug: 'a', group: 'G' }
    const b = { ...hero, slug: 'b' }
    const c = { ...content, slug: 'c', group: 'G' }
    expect(groupBlocks([a, b, c]).map((g) => [g.group, g.items.map((i) => i.slug)])).toEqual([
      ['G', ['a', 'c']],
      [undefined, ['b']],
    ])
  })
})

describe('BlockPicker', () => {
  it('shows thumbnails, a placeholder without one, and group headings', async () => {
    const { ds } = fakeSource()
    await mount(ds, refresh)
    const img = screen.getByTestId('onpage-block-hero').querySelector('img')
    expect(img?.getAttribute('src')).toBe('/blocks/hero.png')
    expect(img?.getAttribute('alt')).toBe('Big heading over an image')
    expect(screen.getByTestId('onpage-block-content').querySelector('img')).toBeNull()
    expect(screen.getByTestId('onpage-block-content').textContent).toContain('Content')
    expect(screen.getByRole('heading', { name: 'Text' })).toBeTruthy()
  })

  it('refresh mode: a modal, and hovering previews nothing', async () => {
    const { ds, saves } = fakeSource()
    const { layout } = await mount(ds, refresh)
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
    fireEvent.pointerEnter(screen.getByTestId('onpage-block-hero'))
    await settle()
    expect(layout()).toHaveLength(1)
    expect(saves).toEqual([])
  })

  it('client mode: hovering previews the example in place without history or saving', async () => {
    const { ds, saves } = fakeSource()
    const { api, layout } = await mount(ds)
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBeNull()
    fireEvent.pointerEnter(screen.getByTestId('onpage-block-hero'))
    await waitFor(() => expect(layout()).toHaveLength(2))
    expect(layout()[1]).toMatchObject({ blockType: 'hero', heading: 'Your headline here' })
    // Another card replaces the preview rather than adding a second row.
    // Keyboard focus previews once a key was pressed in the picker (Tab).
    fireEvent.keyDown(screen.getByTestId('onpage-block-hero'), { key: 'Tab' })
    fireEvent.focus(screen.getByTestId('onpage-block-content'))
    await waitFor(() => expect(layout()[1]?.blockType).toBe('content'))
    expect(layout()).toHaveLength(2)
    await settle()
    expect(saves).toEqual([])
    expect(api.session.getSnapshot().canUndo).toBe(false)
  })

  it('client mode: focus starts on the first card without previewing it', async () => {
    const { ds } = fakeSource()
    const { layout } = await mount(ds)
    // Groups come first: Content ("Text") is the first card.
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('data-testid')).toBe('onpage-block-content'),
    )
    fireEvent.focus(screen.getByTestId('onpage-block-content'))
    await settle()
    expect(layout()).toHaveLength(1)
  })

  it('client mode: the previewed card stays marked after the pointer leaves', async () => {
    const { ds } = fakeSource()
    const { layout } = await mount(ds)
    const card = screen.getByTestId('onpage-block-hero')
    fireEvent.pointerEnter(card)
    await waitFor(() => expect(layout()).toHaveLength(2))
    fireEvent.pointerLeave(card)
    expect(card.classList.contains('is-previewing')).toBe(true)
    expect(screen.getByTestId('onpage-block-content').classList.contains('is-previewing')).toBe(
      false,
    )
  })

  it('insertExample: the chosen block starts from its example', async () => {
    hero.insertExample = true
    try {
      const { ds, saves } = fakeSource()
      const { layout } = await mount(ds, refresh)
      fireEvent.click(screen.getByTestId('onpage-block-hero'))
      await waitFor(() => expect(saves).toHaveLength(1))
      expect(layout()[1]).toMatchObject({ blockType: 'hero', heading: 'Your headline here' })
    } finally {
      delete hero.insertExample
    }
  })

  it('client mode: Escape removes the preview', async () => {
    const { ds, saves } = fakeSource()
    const { layout } = await mount(ds)
    fireEvent.pointerEnter(screen.getByTestId('onpage-block-hero'))
    await waitFor(() => expect(layout()).toHaveLength(2))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('onpage-block-picker')).toBeNull())
    expect(layout()).toHaveLength(1)
    await settle()
    expect(saves).toEqual([])
  })

  it('client mode: choosing inserts the defaults (not the example) as one undoable save', async () => {
    const { ds, saves } = fakeSource()
    const { api, layout } = await mount(ds)
    fireEvent.pointerEnter(screen.getByTestId('onpage-block-hero'))
    await waitFor(() => expect(layout()).toHaveLength(2))
    fireEvent.click(screen.getByTestId('onpage-block-hero'))
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(layout()).toHaveLength(2)
    expect(layout()[1]).toMatchObject({ blockType: 'hero', heading: 'New hero' })
    expect(saves[0]?.layout).toMatchObject([
      { id: 's1' },
      { blockType: 'hero', heading: 'New hero' },
    ])
    act(() => api.session.undo())
    expect(layout()).toHaveLength(1)
  })

  it('client mode: closing keeps an uncommitted edit elsewhere in the document', async () => {
    const { ds } = fakeSource()
    const { api, layout } = await mount(ds)
    // Reopen the picker while a field still has a transient (uncommitted) value.
    act(() => api.setPanel(null))
    act(() => api.session.setValue(KEY, 'title', 'Typing…', { transient: true }))
    act(() => api.setPanel({ kind: 'blocks', key: KEY, listPath: 'layout', index: 1 }))
    await screen.findByTestId('onpage-block-picker')
    fireEvent.pointerEnter(screen.getByTestId('onpage-block-hero'))
    await waitFor(() => expect(layout()).toHaveLength(2))
    act(() => api.setPanel(null))
    expect(layout()).toHaveLength(1)
    expect(api.session.getSnapshot().docs[KEY]?.doc?.title).toBe('Typing…')
  })
})
