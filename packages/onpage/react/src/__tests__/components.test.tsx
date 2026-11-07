// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  ChoiceField,
  DataSource,
  DateField,
  DocumentSchema,
  NumberField,
  ScalarField,
  SchemaField,
} from '@shipment/onpage-core'
import { createTranslate, defaultMessages, relativeTime } from '../messages.ts'
import { shortcut } from '../dom.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { PreviewToolbar } from '../ui/PreviewToolbar.tsx'
import { SelectEditor } from '../editors/SelectEditor.tsx'
import { NumberEditor } from '../editors/NumberEditor.tsx'
import { ColorEditor } from '../editors/ColorEditor.tsx'
import { DateEditor } from '../editors/DateEditor.tsx'
import { CheckboxEditor } from '../editors/CheckboxEditor.tsx'
import type { FieldEditorProps } from '../types.ts'

const t = createTranslate()

/** Props for an editor under test: `field` as the editor's kind, `value` already normalized. */
function editorProps<F extends SchemaField = SchemaField, V = unknown>(
  field: Partial<F> & { type: F['type'] },
  value: V = null as V,
) {
  const commit = vi.fn()
  const close = vi.fn()
  const preview = vi.fn()
  const anchor = document.createElement('span')
  document.body.appendChild(anchor)
  const props: FieldEditorProps<F, V> = {
    docKey: 'c:pages:1',
    path: 'x',
    field: { name: 'x', label: 'X', ...field } as F,
    element: () => anchor,
    value,
    commit,
    preview,
    close,
    ghost: vi.fn(),
    live: true,
    t,
  }
  return { props, commit, close, preview }
}

describe('messages', () => {
  it('fills placeholders, accepts overrides, and types keys and variables', () => {
    expect(t('dock.documents', { count: 3 })).toBe('3 documents')
    // @ts-expect-error unknown keys don't compile (at runtime they fall back to the key)
    expect(t('Plain text')).toBe('Plain text')
    // @ts-expect-error a message with placeholders needs its variables
    t('dock.documents')
    // @ts-expect-error and only those variables
    t('dock.documents', { total: 3 })
    // @ts-expect-error a message without placeholders takes none
    t('dock.publish', { x: 1 })
    expect(createTranslate({ 'dock.publish': 'Publicar' })('dock.publish')).toBe('Publicar')
    expect(Object.keys(defaultMessages).length).toBeGreaterThan(50)
  })
  it('picks plural forms by the UI locale, and exposes it', () => {
    const en = createTranslate()
    expect(en('dock.documents', { count: 1 })).toBe('1 document')
    expect(en('dock.documents', { count: 3 })).toBe('3 documents')
    expect(en.locale).toBe('en')
    // Polish: one / few / many, each from its own override.
    const pl = createTranslate(
      {
        'dock.documents': '{count} dokumentów',
        'dock.documents.one': '{count} dokument',
        'dock.documents.few': '{count} dokumenty',
      },
      'pl',
    )
    expect([1, 3, 5].map((count) => pl('dock.documents', { count }))).toEqual([
      '1 dokument',
      '3 dokumenty',
      '5 dokumentów',
    ])
    expect(pl.locale).toBe('pl')
  })
  it('writes shortcuts the way the platform does', () => {
    const platform = vi.spyOn(navigator, 'platform', 'get')
    platform.mockReturnValue('MacIntel')
    expect(shortcut('Z', { shift: true })).toBe('⇧⌘Z')
    platform.mockReturnValue('Win32')
    expect(shortcut('Z')).toBe('Ctrl+Z')
    expect(shortcut('Z', { shift: true })).toBe('Ctrl+Shift+Z')
    platform.mockRestore()
  })
  it('formats relative time', () => {
    expect(relativeTime(Date.now() - 5000, Date.now(), 'en')).toMatch(/5 seconds ago|now/)
    expect(relativeTime(Date.now() - 120_000, Date.now(), 'en')).toBe('2 minutes ago')
  })
})

describe('Dialog', () => {
  it('is labelled, focuses inside, traps Tab and closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <Dialog title="Settings" onClose={onClose} t={t}>
        <input aria-label="first" />
        <button type="button">last</button>
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    screen.getByText('last').focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
  it('keeps its document listeners across re-renders with a new onClose, and calls the latest one', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const first = vi.fn()
    const latest = vi.fn()
    const { rerender } = render(
      <Dialog title="x" onClose={first} t={t}>
        <input aria-label="a" />
      </Dialog>,
    )
    const bound = add.mock.calls.filter(([type]) => type === 'keydown').length
    rerender(
      <Dialog title="x" onClose={latest} t={t}>
        <input aria-label="a" />
      </Dialog>,
    )
    expect(add.mock.calls.filter(([type]) => type === 'keydown').length).toBe(bound)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(latest).toHaveBeenCalled()
    expect(first).not.toHaveBeenCalled()
    add.mockRestore()
  })
  it('restores focus to where it was', () => {
    const before = document.createElement('button')
    document.body.appendChild(before)
    before.focus()
    const { unmount } = render(
      <Dialog title="x" onClose={() => {}} t={t}>
        x
      </Dialog>,
    )
    unmount()
    expect(document.activeElement).toBe(before)
  })
})

describe('field editors', () => {
  it('select: picks one and closes; hasMany toggles', () => {
    const one = editorProps<ChoiceField, string[]>(
      {
        type: 'select',
        options: [
          { label: 'A', value: 'a' },
          { label: 'B', value: 'b' },
        ],
      },
      ['a'],
    )
    render(<SelectEditor {...one.props} />)
    fireEvent.click(screen.getByTestId('onpage-option-b'))
    expect(one.commit).toHaveBeenCalledWith('b')
    expect(one.close).toHaveBeenCalled()
  })
  it('select hasMany keeps option order and stays open', () => {
    const many = editorProps<ChoiceField, string[]>(
      {
        type: 'select',
        hasMany: true,
        options: [
          { label: 'A', value: 'a' },
          { label: 'B', value: 'b' },
        ],
      },
      ['b'],
    )
    render(<SelectEditor {...many.props} />)
    fireEvent.click(screen.getByTestId('onpage-option-a'))
    expect(many.commit).toHaveBeenCalledWith(['a', 'b'])
    expect(many.close).not.toHaveBeenCalled()
  })
  it('number: previews live, commits a number on Apply', () => {
    const n = editorProps<NumberField, number | null>({ type: 'number', min: 0, max: 10 }, 2)
    render(<NumberEditor {...n.props} />)
    fireEvent.change(screen.getByTestId('onpage-number-input'), { target: { value: '7' } })
    expect(n.preview).toHaveBeenCalledWith(7)
    expect(screen.getByTestId('onpage-number-slider')).toBeTruthy()
    fireEvent.click(screen.getByTestId('onpage-apply'))
    expect(n.commit).toHaveBeenCalledWith(7)
  })
  it('color: rejects an invalid hex', () => {
    const c = editorProps<ScalarField, string | null>({ type: 'text', editor: 'color' }, '#fff')
    render(<ColorEditor {...c.props} />)
    fireEvent.change(screen.getByTestId('onpage-color-input'), { target: { value: 'nope' } })
    fireEvent.click(screen.getByTestId('onpage-apply'))
    expect(c.commit).not.toHaveBeenCalled()
    expect(c.close).toHaveBeenCalled()
  })
  it('date: stores a date at local noon as ISO', () => {
    const d = editorProps<DateField, string | null>({ type: 'date' }, null)
    render(<DateEditor {...d.props} />)
    fireEvent.change(screen.getByTestId('onpage-date-input'), { target: { value: '2026-12-25' } })
    fireEvent.click(screen.getByTestId('onpage-apply'))
    expect(new Date(d.commit.mock.calls[0]![0] as string).getHours()).toBe(12)
  })
  it('checkbox: toggles and closes', () => {
    const c = editorProps<ScalarField, boolean>({ type: 'checkbox' }, false)
    render(<CheckboxEditor {...c.props} />)
    fireEvent.click(screen.getByTestId('onpage-checkbox-input'))
    expect(c.commit).toHaveBeenCalledWith(true)
  })
})

describe('PreviewToolbar', () => {
  it('offers Edit to editors, and only "View published" to link viewers', () => {
    const { unmount } = render(
      <PreviewToolbar exitHref="/api/onpage/exit" editHref="/api/onpage/mode?mode=edit" />,
    )
    expect(screen.getByTestId('onpage-edit')).toBeTruthy()
    expect(screen.getByText('Previewing the draft')).toBeTruthy()
    unmount()
    render(<PreviewToolbar exitHref="/api/onpage/exit" shared />)
    expect(screen.queryByTestId('onpage-edit')).toBeNull()
    expect(screen.getByText('View published')).toBeTruthy()
    expect(screen.getByTestId('onpage-exit-preview').closest('form')?.getAttribute('method')).toBe(
      'post',
    )
  })
  it('link viewers comment when the site allows it, quoting the text they selected', async () => {
    const posts: unknown[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/guest')) return new Response(JSON.stringify({ enabled: true }))
      posts.push(JSON.parse(init?.body as string))
      return new Response(JSON.stringify({ id: 1 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      document.body.insertAdjacentHTML('beforeend', '<p id="quote-me">Big idea</p>')
      render(<PreviewToolbar exitHref="/x" shared commentsHref="/api/onpage/comments" />)
      const open = await screen.findByTestId('onpage-guest-comment-open')
      const range = document.createRange()
      range.selectNodeContents(document.getElementById('quote-me')!)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      fireEvent.click(open)
      const form = await screen.findByTestId('onpage-guest-comment')
      expect(form.textContent).toContain('Big idea')
      fireEvent.change(screen.getByTestId('onpage-guest-name'), { target: { value: 'Sam' } })
      fireEvent.change(screen.getByTestId('onpage-guest-body'), { target: { value: 'Love it' } })
      fireEvent.click(screen.getByTestId('onpage-guest-send'))
      await screen.findByText('Thanks, your comment was sent')
      expect(posts).toEqual([{ name: 'Sam', body: 'Love it', quote: 'Big idea' }])
    } finally {
      vi.unstubAllGlobals()
      document.getElementById('quote-me')?.remove()
    }
  })
  it("no Comment button when the site doesn't allow it", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    )
    try {
      render(<PreviewToolbar exitHref="/x" shared commentsHref="/api/onpage/comments" />)
      await new Promise((r) => setTimeout(r, 20))
      expect(screen.queryByTestId('onpage-guest-comment-open')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

// ── the editor shell, end to end against a fake DataSource ───────────────────
const schema: DocumentSchema = {
  kind: 'collection',
  slug: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  editable: ['title', 'items'],
  drafts: true,
  fields: [
    { name: 'title', type: 'text', label: 'Title' },
    {
      name: 'items',
      type: 'array',
      label: 'Items',
      labels: { singular: 'Item', plural: 'Items' },
      fields: [{ name: 'label', type: 'text', label: 'Label' }],
    },
  ],
}

function fakeSource(overrides: Partial<DataSource> = {}) {
  const saves: unknown[] = []
  const ds: DataSource = {
    loadSchema: async () => schema,
    loadDocument: async () => ({
      id: 1,
      updatedAt: 'v0',
      title: 'Hello',
      items: [
        { id: 'a', label: 'One' },
        { id: 'b', label: 'Two' },
      ],
    }),
    saveDraft: async (_ref, data) => {
      saves.push(data)
      return { ok: true, updatedAt: `v${saves.length}` }
    },
    publish: async () => ({ ok: true }),
    ...overrides,
  }
  return { ds, saves }
}

function page() {
  document.body.innerHTML = `
    <main>
      <h1 data-onpage-ref="c:pages:1" data-onpage-field="title" data-onpage-kind="text">Hello</h1>
      <ul data-onpage-ref="c:pages:1" data-onpage-list="items">
        <li data-onpage-ref="c:pages:1" data-onpage-row="items.0">One</li>
        <li data-onpage-ref="c:pages:1" data-onpage-row="items.1">Two</li>
      </ul>
    </main>`
}

describe('OnPageEditor', () => {
  async function mount(ds: DataSource) {
    const { OnPageEditor } = await import('../editor/OnPageEditor.tsx')
    page()
    const container = document.createElement('div')
    document.body.appendChild(container)
    render(<OnPageEditor dataSource={ds} links={{ exit: '/exit' }} autosaveDelay={0} />, {
      container,
    })
    await waitFor(() =>
      expect(screen.getByTestId('onpage-status').textContent).toBe('Editing draft'),
    )
  }

  it('click a field, type, commit: the change is saved', async () => {
    const { ds, saves } = fakeSource()
    await mount(ds)
    fireEvent.click(document.querySelector('h1')!)
    const inline = await screen.findByTestId('onpage-inline-text')
    inline.textContent = 'Hello world'
    fireEvent.input(inline)
    fireEvent.keyDown(inline, { key: 'Enter' })
    await waitFor(() => expect(saves).toEqual([{ title: 'Hello world' }]))
    expect(screen.queryByTestId('onpage-inline-text')).toBeNull()
  })

  it('keyboard: targets are focusable; ⌥↓ moves the focused row; ⌘Z undoes', async () => {
    const { ds, saves } = fakeSource()
    await mount(ds)
    const first = document.querySelector('li')!
    await waitFor(() => expect(first.getAttribute('tabindex')).toBe('0'))
    act(() => first.focus())
    fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true })
    await waitFor(() =>
      expect(saves.at(-1)).toMatchObject({ items: [{ label: 'Two' }, { label: 'One' }] }),
    )
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true })
    await waitFor(() =>
      expect(saves.at(-1)).toMatchObject({ items: [{ label: 'One' }, { label: 'Two' }] }),
    )
  })

  it('shows a publish failure instead of getting stuck', async () => {
    const { ds } = fakeSource({
      publish: async () => ({ ok: false, status: 400, message: 'Title is required' }),
    })
    await mount(ds)
    fireEvent.click(document.querySelector('h1')!)
    const inline = await screen.findByTestId('onpage-inline-text')
    inline.textContent = ''
    fireEvent.keyDown(inline, { key: 'Enter' })
    fireEvent.click(screen.getByTestId('onpage-publish'))
    await waitFor(() =>
      expect(screen.getByTestId('onpage-status').textContent).toMatch(/Title is required/),
    )
    expect(screen.getByTestId<HTMLButtonElement>('onpage-publish').disabled).toBe(false)
  })

  it('reports a load failure with a retry', async () => {
    let fail = true
    const { ds } = fakeSource({
      loadSchema: async () => (fail ? Promise.reject(new Error('offline')) : schema),
    })
    const { OnPageEditor } = await import('../editor/OnPageEditor.tsx')
    page()
    render(<OnPageEditor dataSource={ds} links={{ exit: '/exit' }} />)
    await waitFor(() => expect(screen.getByTestId('onpage-status').textContent).toMatch(/offline/))
    fail = false
    fireEvent.click(screen.getByTestId('onpage-retry'))
    await waitFor(() =>
      expect(screen.getByTestId('onpage-status').textContent).toBe('Editing draft'),
    )
  })
})
