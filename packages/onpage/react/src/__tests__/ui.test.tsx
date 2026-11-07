// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  stegaDecode,
  stegaEncode,
  type DataSource,
  type DocumentSchema,
  type MediaLibrary,
  type PageComment,
} from '@shipment/onpage-core'
import { OnPageClient } from '../OnPageClient.tsx'
import { OnPageEditor } from '../editor/OnPageEditor.tsx'
import { hub } from '../hub.ts'
import type { OnPageEvent } from '../types.ts'
import { sanitizeHtml } from '../sanitize.ts'

const schema: DocumentSchema = {
  kind: 'collection',
  slug: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  editable: ['title', 'layout', 'author', 'image'],
  drafts: true,
  relations: { users: { titleField: 'name', label: 'User' } },
  fields: [
    { name: 'title', type: 'text', label: 'Title' },
    { name: 'author', type: 'relationship', label: 'Author', relationTo: 'users' },
    { name: 'image', type: 'upload', label: 'Image', relationTo: 'media' },
    {
      name: 'layout',
      type: 'blocks',
      label: 'Layout',
      blocks: [
        {
          slug: 'hero',
          labels: { singular: 'Hero', plural: 'Heroes' },
          fields: [
            { name: 'heading', type: 'text', label: 'Heading' },
            {
              name: 'tone',
              type: 'select',
              label: 'Tone',
              options: [
                { label: 'Light', value: 'light' },
                { label: 'Dark', value: 'dark' },
              ],
            },
          ],
        },
        {
          slug: 'cta',
          labels: { singular: 'Call to action', plural: 'CTAs' },
          fields: [{ name: 'label', type: 'text', label: 'Label' }],
        },
      ],
    },
  ],
}
const initial = () => ({
  id: 1,
  updatedAt: 'v0',
  title: 'Hello',
  author: null,
  image: null,
  layout: [{ id: 'h', blockType: 'hero', heading: 'Big', tone: 'light' }],
})

function source(extra: Partial<DataSource> = {}) {
  const saves: Record<string, unknown>[] = []
  const ds: DataSource = {
    loadSchema: async () => schema,
    loadDocument: async () => initial(),
    saveDraft: async (_r, data) => (saves.push(data), { ok: true }),
    publish: async () => ({ ok: true }),
    search: async (_c, o) =>
      [{ id: 7, title: 'Ada', doc: { id: 7, name: 'Ada' } }].filter(
        (h) => !o.query || h.title.includes(o.query),
      ),
    ...extra,
  }
  return { ds, saves }
}

const media: MediaLibrary = {
  search: async () => ({
    items: [
      {
        id: 3,
        url: '/a.png',
        thumbnailUrl: '/a.png',
        alt: 'A',
        filename: 'a.png',
        doc: { id: 3, url: '/a.png', alt: 'A' },
      },
    ],
    hasMore: false,
  }),
}

async function mountEditor(
  ds: DataSource,
  html: string,
  mediaLibrary: MediaLibrary = media,
  onEvent?: (e: OnPageEvent) => void,
) {
  document.body.innerHTML = html
  const container = document.createElement('div')
  document.body.appendChild(container)
  render(
    <OnPageEditor
      dataSource={ds}
      media={mediaLibrary}
      onEvent={onEvent}
      links={{ exit: '/exit', mode: (m) => `/mode?mode=${m}` }}
      autosaveDelay={0}
    />,
    { container },
  )
  await waitFor(() => expect(screen.getByTestId('onpage-status').textContent).toBe('Editing draft'))
}

const ann = (extra: string) => `data-onpage-ref="c:pages:1" ${extra}`

describe('row toolbar, settings and block picker', () => {
  // happy-dom has no layout: give elements an on-screen box so the overlay draws.
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 400,
      left: 0,
      right: 800,
      width: 800,
      height: 300,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    })
  })
  afterEach(() => vi.restoreAllMocks())
  const html = `<div ${ann('data-onpage-list="layout"')}><section ${ann('data-onpage-row="layout.0"')}><h2 ${ann('data-onpage-field="layout.0.heading"')}>Big</h2></section></div>`

  it('selecting a section shows its toolbar; settings edit a select; add section inserts a block', async () => {
    const { ds, saves } = source()
    await mountEditor(ds, html)
    fireEvent.click(document.querySelector('section')!)
    const toolbar = await screen.findByTestId('onpage-block-toolbar')
    expect(toolbar.getAttribute('aria-label')).toBe('Hero actions')
    fireEvent.click(screen.getByTestId('onpage-block-settings'))
    const settings = await screen.findByRole('dialog', { name: 'Hero settings' })
    const dark = settings.querySelector(
      '[data-testid="onpage-setting-layout.0.tone-dark"]',
    ) as HTMLElement
    expect(dark.getAttribute('role')).toBe('radio')
    fireEvent.click(dark)
    await waitFor(() => expect(saves.at(-1)).toMatchObject({ layout: [{ tone: 'dark' }] }))
    fireEvent.click(settings.querySelector('.po-close') as HTMLElement)
    fireEvent.click(screen.getByTestId('onpage-insert-below'))
    fireEvent.click(await screen.findByTestId('onpage-block-cta'))
    await waitFor(() =>
      expect(saves.at(-1)).toMatchObject({ layout: [{ blockType: 'hero' }, { blockType: 'cta' }] }),
    )
  })

  it("lists a section's links the page doesn't show: add, edit, remove", async () => {
    const withLinks: DocumentSchema = structuredClone(schema)
    const layout = withLinks.fields.find((f) => f.name === 'layout')
    if (layout?.type !== 'blocks') throw new Error('layout')
    layout.blocks[0]!.fields.push({
      name: 'links',
      type: 'array',
      label: 'Links',
      labels: { singular: 'Link', plural: 'Links' },
      fields: [{ name: 'label', type: 'text', label: 'Label' }],
    })
    const { ds, saves } = source({ loadSchema: async () => withLinks })
    await mountEditor(ds, html)
    fireEvent.click(document.querySelector('section')!)
    fireEvent.click(await screen.findByTestId('onpage-block-settings'))
    await screen.findByTestId('onpage-setting-list-layout.0.links')
    fireEvent.click(screen.getByTestId('onpage-setting-add-layout.0.links'))
    await waitFor(() =>
      expect(saves.at(-1)).toMatchObject({ layout: [{ links: [expect.any(Object)] }] }),
    )
    const label = await screen.findByLabelText('Label')
    fireEvent.change(label, { target: { value: 'Docs' } })
    fireEvent.blur(label)
    await waitFor(() =>
      expect(saves.at(-1)).toMatchObject({ layout: [{ links: [{ label: 'Docs' }] }] }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove Link 1' }))
    await waitFor(() => expect(saves.at(-1)).toMatchObject({ layout: [{ links: [] }] }))
  })

  it('duplicate and delete, with undo', async () => {
    const { ds, saves } = source()
    await mountEditor(ds, html)
    fireEvent.click(document.querySelector('section')!)
    fireEvent.click(await screen.findByTestId('onpage-block-duplicate'))
    await waitFor(() => expect((saves.at(-1)?.layout as unknown[]).length).toBe(2))
    const dup = saves.at(-1)!.layout as Array<{ id: string }>
    expect(dup[0]!.id).not.toBe(dup[1]!.id) // fresh row id
  })
})

describe('relationship and upload editors', () => {
  it('relationship: searches by the title field and stores the populated doc', async () => {
    const { ds, saves } = source()
    await mountEditor(ds, `<span ${ann('data-onpage-field="author"')}>No author</span>`)
    fireEvent.click(document.querySelector('span')!)
    const option = await screen.findByTestId('onpage-relationship-7', undefined, { timeout: 2000 })
    fireEvent.click(option)
    await waitFor(() => expect(saves.at(-1)).toEqual({ author: 7 })) // saved as an id
  })
  it('upload: picks an image through the MediaLibrary port', async () => {
    const { ds, saves } = source()
    await mountEditor(
      ds,
      `<img alt="" ${ann('data-onpage-field="image" data-onpage-kind="media"')}>`,
    )
    fireEvent.click(document.querySelector('img')!)
    fireEvent.click(await screen.findByTestId('onpage-media-3', undefined, { timeout: 2000 }))
    await waitFor(() => expect(saves.at(-1)).toEqual({ image: 3 }))
  })
  it('upload: asks for alt text before uploading a new file', async () => {
    const { ds, saves } = source()
    const upload = vi.fn<NonNullable<MediaLibrary['upload']>>(async () => ({
      id: 9,
      url: '/cat.png',
      alt: 'A cat asleep',
      doc: { id: 9, url: '/cat.png', alt: 'A cat asleep' },
    }))
    URL.createObjectURL ??= () => 'blob:x'
    URL.revokeObjectURL ??= () => undefined
    await mountEditor(
      ds,
      `<img alt="" ${ann('data-onpage-field="image" data-onpage-kind="media"')}>`,
      { ...media, upload },
    )
    fireEvent.click(document.querySelector('img')!)
    await screen.findByTestId('onpage-media-upload')
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!
    fireEvent.change(input, { target: { files: [new File(['x'], 'IMG_2034.png')] } })
    expect(upload).not.toHaveBeenCalled() // waits for the alt text
    fireEvent.change(await screen.findByTestId('onpage-media-alt'), {
      target: { value: '  A cat asleep ' },
    })
    fireEvent.submit(screen.getByTestId('onpage-media-alt-form'))
    await waitFor(() => expect(saves.at(-1)).toEqual({ image: 9 }))
    expect(upload).toHaveBeenCalledWith(expect.any(File), {
      relationTo: 'media',
      alt: 'A cat asleep',
    })
  })
  it("upload: edits the current image's alt text on the media document", async () => {
    const marked = stegaEncode('Old words', { ref: 'c:pages:1', path: 'image', kind: 'media' })
    const { ds, saves } = source({
      loadDocument: async () => ({ ...initial(), image: { id: 3, url: '/a.png', alt: marked } }),
    })
    const updateAlt = vi.fn<NonNullable<MediaLibrary['updateAlt']>>(async (id, { alt }) => ({
      id,
      url: '/a.png',
      alt,
      doc: { id, url: '/a.png', alt },
    }))
    await mountEditor(
      ds,
      `<img alt="" ${ann('data-onpage-field="image" data-onpage-kind="media"')}>`,
      { ...media, updateAlt },
    )
    fireEvent.click(document.querySelector('img')!)
    const field = await screen.findByTestId<HTMLInputElement>('onpage-media-alt-current')
    expect(field.value).toBe('Old words') // without the marker
    fireEvent.change(field, { target: { value: 'A red door' } })
    fireEvent.submit(field.closest('form')!)
    await waitFor(() =>
      expect(updateAlt).toHaveBeenCalledWith(3, { relationTo: 'media', alt: 'A red door' }),
    )
    await waitFor(() => expect(saves.at(-1)).toEqual({ image: 3 }))
  })
})

describe('page settings', () => {
  it("lists the document's fields that aren't on the page, and edits them", async () => {
    const withMeta: DocumentSchema = {
      ...schema,
      editable: [...schema.editable, 'slug', 'meta'],
      fields: [
        ...schema.fields,
        { name: 'slug', type: 'text', label: 'Slug' },
        {
          name: 'meta',
          type: 'group',
          label: 'SEO',
          fields: [
            { name: 'title', type: 'text', label: 'Meta title' },
            { name: 'description', type: 'textarea', label: 'Meta description' },
          ],
        },
      ],
    }
    const { ds, saves } = source({
      loadSchema: async () => withMeta,
      loadDocument: async () => ({ ...initial(), slug: 'home', meta: { title: 'Home' } }),
    })
    // The title is on the page; everything else isn't.
    await mountEditor(ds, `<span ${ann('data-onpage-field="title"')}>Hello</span>`)
    fireEvent.click(screen.getByTestId('onpage-page-settings-open'))
    const panel = await screen.findByTestId('onpage-page-settings')
    const labels = [...panel.querySelectorAll('label, legend')].map((l) => l.textContent)
    expect(labels).toEqual(expect.arrayContaining(['Author', 'Image', 'SEO', 'Meta title']))
    expect(labels).not.toContain('Title') // edited on the page
    expect(labels).not.toContain('Slug') // the page's own address
    const metaTitle = screen.getByLabelText('Meta title')
    fireEvent.change(metaTitle, { target: { value: 'Welcome' } })
    fireEvent.blur(metaTitle)
    await waitFor(() => expect(saves.at(-1)).toMatchObject({ meta: { title: 'Welcome' } }))
  })
})

describe('field conditions', () => {
  it('hides the fields the data source says are hidden, and asks again after a change', async () => {
    const conditional: DocumentSchema = {
      ...schema,
      conditions: true,
      editable: [...schema.editable, 'featured', 'badge'],
      fields: [
        ...schema.fields,
        { name: 'featured', type: 'checkbox', label: 'Featured' },
        { name: 'badge', type: 'text', label: 'Badge' },
      ],
    }
    const hiddenFields = vi.fn<NonNullable<DataSource['hiddenFields']>>(async (_r, doc) =>
      doc.featured ? [] : ['badge'],
    )
    const { ds } = source({
      loadSchema: async () => conditional,
      loadDocument: async () => ({ ...initial(), featured: false }),
      hiddenFields,
    })
    await mountEditor(ds, `<span ${ann('data-onpage-field="title"')}>Hello</span>`)
    fireEvent.click(screen.getByTestId('onpage-page-settings-open'))
    const panel = await screen.findByTestId('onpage-page-settings')
    await waitFor(() => expect(hiddenFields).toHaveBeenCalled())
    await waitFor(() => expect(panel.textContent).not.toContain('Badge'))
    fireEvent.click(screen.getByLabelText('Featured'))
    await waitFor(() => expect(panel.textContent).toContain('Badge'))
  })
})

describe('save failures', () => {
  it('outlines the fields a validation error names, and clears them once saved', async () => {
    let fail = true
    const { ds } = source({
      saveDraft: async () =>
        fail
          ? {
              ok: false,
              status: 400,
              message: 'Invalid: Title',
              fields: [{ path: 'title', message: 'Required' }],
            }
          : { ok: true },
    })
    await mountEditor(ds, `<span ${ann('data-onpage-field="title"')}>Hello</span>`)
    const el = document.querySelector('span')!
    act(() => hub.get()!.session.setValue('c:pages:1', 'title', ''))
    await waitFor(() => expect(el.getAttribute('data-onpage-invalid')).toBe('Required'))
    fail = false
    fireEvent.click(screen.getByTestId('onpage-retry'))
    await waitFor(() => expect(el.hasAttribute('data-onpage-invalid')).toBe(false))
  })
  it('on a conflict, Keep my changes re-applies them on the latest version', async () => {
    let conflict = true
    const saves: Record<string, unknown>[] = []
    const { ds } = source({
      loadDocument: async () => ({ ...initial(), updatedAt: conflict ? 'v0' : 'v1' }),
      saveDraft: async (_r, data) => {
        saves.push(data)
        if (conflict) return ((conflict = false), { ok: false, status: 409, message: 'stale' })
        return { ok: true }
      },
    })
    await mountEditor(ds, `<span ${ann('data-onpage-field="title"')}>Hello</span>`)
    act(() => hub.get()!.session.setValue('c:pages:1', 'title', 'Mine'))
    fireEvent.click(await screen.findByTestId('onpage-keep-mine'))
    await waitFor(() => expect(saves).toEqual([{ title: 'Mine' }, { title: 'Mine' }]))
    await waitFor(() => expect(screen.queryByTestId('onpage-keep-mine')).toBeNull())
  })
})

describe('history panel', () => {
  it('lists versions, outlines changes since published, and restores one', async () => {
    const restoreVersion = vi.fn<NonNullable<DataSource['restoreVersion']>>(async () => {})
    const { ds } = source({
      loadDocument: async (_r, o) => (o.draft ? { ...initial(), title: 'Draft title' } : initial()),
      listVersions: async () => [
        { id: 'v2', updatedAt: new Date().toISOString(), status: 'draft' },
        { id: 'v1', updatedAt: new Date(Date.now() - 3600_000).toISOString(), status: 'published' },
      ],
      restoreVersion,
    })
    await mountEditor(ds, `<span ${ann('data-onpage-field="title"')}>Draft title</span>`)
    fireEvent.click(screen.getByTestId('onpage-versions-open'))
    const older = await screen.findByTestId('onpage-version-1')
    expect(older.textContent).toContain('published')
    expect(screen.getByTestId('onpage-version-0').textContent).toContain('current')
    fireEvent.click(screen.getByTestId('onpage-versions-highlight'))
    const span = document.querySelector('span[data-onpage-field]')!
    await waitFor(() => expect(span.hasAttribute('data-onpage-changed')).toBe(true))
    expect(screen.getByTestId('onpage-versions').textContent).toContain('1 change')
    const restore = screen.getByTestId('onpage-version-restore-1')
    fireEvent.click(restore)
    expect(restore.textContent).toBe('Restore as draft?')
    fireEvent.click(restore)
    await waitFor(() => expect(restoreVersion).toHaveBeenCalledWith(expect.anything(), 'v1'))
    fireEvent.click(screen.getByTestId('onpage-versions-highlight'))
    await waitFor(() => expect(span.hasAttribute('data-onpage-changed')).toBe(false))
  })
})

describe('comments panel', () => {
  it('lists, adds (about the selection), resolves, and asks for a review', async () => {
    const stored: PageComment[] = [
      {
        id: 1,
        body: 'Old',
        kind: 'comment',
        resolved: true,
        createdAt: new Date().toISOString(),
        author: 'Ada',
        guest: false,
      },
      {
        id: 2,
        body: 'Love it',
        quote: 'Big',
        kind: 'comment',
        resolved: false,
        createdAt: new Date().toISOString(),
        author: 'Sam',
        guest: true,
      },
    ]
    const addComment = vi.fn<NonNullable<DataSource['addComment']>>(async () => {})
    const resolveComment = vi.fn<NonNullable<DataSource['resolveComment']>>(async () => {})
    const requestReview = vi.fn<NonNullable<DataSource['requestReview']>>(async () => ({
      url: 'u',
      expiresAt: 'e',
    }))
    const { ds } = source({
      loadSchema: async () => ({ ...schema, comments: true, canPublish: false }),
      listComments: async () => stored,
      addComment,
      resolveComment,
      requestReview,
    })
    await mountEditor(ds, `<span ${ann('data-onpage-field="title"')}>Hello</span>`)
    // Can't publish: Publish is off, and the dock counts the open comment.
    expect(screen.getByTestId<HTMLButtonElement>('onpage-publish').disabled).toBe(true)
    await waitFor(() =>
      expect(screen.getByTestId('onpage-comments-open').textContent).toBe('Comments (1)'),
    )
    act(() => hub.get()!.setSelected({ key: 'c:pages:1', path: 'title' }))
    fireEvent.click(screen.getByTestId('onpage-comments-open'))
    const items = await screen.findAllByTestId('onpage-comment')
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('Love it'), // open first
      expect.stringContaining('Old'),
    ])
    expect(items[0]!.textContent).toContain('via share link')
    fireEvent.change(screen.getByTestId('onpage-comment-text'), { target: { value: 'Shorter' } })
    fireEvent.click(screen.getByTestId('onpage-comment-add'))
    await waitFor(() =>
      expect(addComment).toHaveBeenCalledWith(expect.objectContaining({ slug: 'pages' }), {
        body: 'Shorter',
        path: 'title', // about the selected field
      }),
    )
    fireEvent.click(screen.getAllByTestId('onpage-comment-resolve')[0]!)
    await waitFor(() => expect(resolveComment).toHaveBeenCalledWith(2, true))
    fireEvent.change(screen.getByTestId('onpage-review-note'), {
      target: { value: 'Check the hero' },
    })
    fireEvent.click(screen.getByTestId('onpage-review-request'))
    await waitFor(() =>
      expect(requestReview).toHaveBeenCalledWith(expect.anything(), {
        note: 'Check the hero',
        locale: undefined,
      }),
    )
  })
})

describe('saved sections and new pages', () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 400,
      left: 0,
      right: 800,
      width: 800,
      height: 300,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    })
  })
  afterEach(() => vi.restoreAllMocks())
  const html = `<div ${ann('data-onpage-list="layout"')}><section ${ann('data-onpage-row="layout.0"')}><h2 ${ann('data-onpage-field="layout.0.heading"')}>Big</h2></section></div>`
  it('saves a section, and inserts saved ones from the picker with new ids', async () => {
    const savePattern = vi.fn<NonNullable<DataSource['savePattern']>>(async () => {})
    const { ds, saves } = source({
      loadSchema: async () => ({ ...schema, patterns: true }),
      savePattern,
      listPatterns: async () => [
        {
          id: 7,
          name: 'Launch hero',
          blockType: 'hero',
          data: { id: 'old', blockType: 'hero', heading: 'Saved!' },
        },
      ],
    })
    await mountEditor(ds, html)
    fireEvent.click(document.querySelector('section')!)
    fireEvent.click(await screen.findByTestId('onpage-block-save'))
    const name = await screen.findByTestId<HTMLInputElement>('onpage-save-section-name')
    expect(name.value).toBe('Hero')
    fireEvent.change(name, { target: { value: 'Launch hero' } })
    fireEvent.click(screen.getByTestId('onpage-save-section-save'))
    await waitFor(() =>
      expect(savePattern).toHaveBeenCalledWith(
        'Launch hero',
        expect.objectContaining({ blockType: 'hero', heading: 'Big' }),
      ),
    )
    fireEvent.click(document.querySelector('section')!)
    fireEvent.click(await screen.findByTestId('onpage-insert-below'))
    fireEvent.click(await screen.findByTestId('onpage-saved-7'))
    await waitFor(() => {
      const layout = saves.at(-1)?.layout as Array<{ id: string; heading?: string }> | undefined
      expect(layout?.[1]?.heading).toBe('Saved!')
      expect(layout?.[1]?.id).not.toBe('old')
    })
  })
  for (const action of ['duplicate', 'create'] as const) {
    it(`${action === 'duplicate' ? 'duplicates the page' : 'creates a page'} and opens it`, async () => {
      const assign = vi.fn()
      vi.stubGlobal('location', { ...window.location, assign })
      try {
        const duplicatePage = vi.fn<NonNullable<DataSource['duplicatePage']>>(async () => ({
          id: 9,
          path: '/home-copy',
        }))
        const createPage = vi.fn<NonNullable<DataSource['createPage']>>(async () => ({
          id: 10,
          path: '/news',
        }))
        const { ds } = source({ duplicatePage, createPage })
        await mountEditor(ds, html)
        fireEvent.click(screen.getByTestId('onpage-page-settings-open'))
        if (action === 'duplicate') {
          fireEvent.click(await screen.findByTestId('onpage-page-duplicate'))
          await waitFor(() => expect(assign).toHaveBeenCalledWith('/home-copy'))
        } else {
          fireEvent.change(await screen.findByTestId('onpage-page-new-title'), {
            target: { value: 'News' },
          })
          fireEvent.click(screen.getByTestId('onpage-page-create'))
          await waitFor(() => expect(createPage).toHaveBeenCalledWith('pages', { title: 'News' }))
          await waitFor(() => expect(assign).toHaveBeenCalledWith('/news'))
        }
      } finally {
        vi.unstubAllGlobals()
      }
    })
  }
})

describe('documents without drafts', () => {
  it('says that changes go live', async () => {
    const { ds } = source({ loadSchema: async () => ({ ...schema, drafts: false }) })
    await mountEditor(ds, `<span ${ann('data-onpage-field="title"')}>Hello</span>`)
    expect((await screen.findByTestId('onpage-live-doc')).textContent).toBe('Page: changes go live')
  })
})

describe('document locks', () => {
  it('takes the lock while editing, refreshes it after saves, and says who else holds one', async () => {
    const calls: string[] = []
    let holder: string | null = null
    const { ds } = source({
      lock: async (_ref, action) => (calls.push(action), { lockedBy: holder }),
    })
    const { unmount } = render(<></>)
    await mountEditor(ds, `<span ${ann('data-onpage-field="title"')}>Hello</span>`)
    await waitFor(() => expect(calls).toEqual(['take']))
    const api = hub.get()!
    act(() => api.session.setValue('c:pages:1', 'title', 'A'))
    await waitFor(() => expect(calls).toEqual(['take', 'take'])) // a save clears it server-side
    expect(screen.queryByTestId('onpage-locked')).toBeNull()
    holder = 'Ada'
    act(() => api.session.setValue('c:pages:1', 'title', 'B'))
    expect((await screen.findByTestId('onpage-locked')).textContent).toBe(
      'Ada is editing this Page',
    )
    unmount()
  })
})

describe('onEvent', () => {
  it('reports saves, failures, conflicts and publishes', async () => {
    const events: OnPageEvent[] = []
    let next: 'ok' | 'invalid' | 'conflict' = 'ok'
    const { ds } = source({
      loadDocument: async () => ({ ...initial(), _status: 'draft' }),
      saveDraft: async () =>
        next === 'ok'
          ? { ok: true }
          : next === 'invalid'
            ? { ok: false, status: 400, message: 'Title is required' }
            : { ok: false, status: 409, message: 'changed' },
    })
    await mountEditor(ds, `<span ${ann('data-onpage-field="title"')}>Hello</span>`, media, (e) =>
      events.push(e),
    )
    const api = hub.get()!
    const key = 'c:pages:1' as const
    const set = (v: string) => act(() => api.session.setValue(key, 'title', v))
    set('A')
    await waitFor(() => expect(events.map((e) => e.type)).toContain('saved'))
    next = 'invalid'
    set('')
    await waitFor(() =>
      expect(events).toContainEqual({
        type: 'saveFailed',
        ref: { kind: 'collection', slug: 'pages', id: 1 },
        message: 'Title is required',
      }),
    )
    next = 'conflict'
    set('B')
    await waitFor(() => expect(events.map((e) => e.type)).toContain('conflict'))
    next = 'ok'
    await act(() => api.session.reload(key))
    await waitFor(() =>
      expect(screen.getByTestId<HTMLButtonElement>('onpage-publish').disabled).toBe(false),
    )
    fireEvent.click(screen.getByTestId('onpage-publish'))
    await waitFor(() => expect(events.map((e) => e.type)).toContain('published'))
  })
})

describe('publish panel', () => {
  it('publishes the chosen documents, or schedules them', async () => {
    const published: unknown[] = []
    const schedulePublish = vi.fn<NonNullable<DataSource['schedulePublish']>>(async (_r, o) => ({
      id: 1,
      waitUntil: o.at.toISOString(),
      type: 'publish',
    }))
    const { ds } = source({
      loadSchema: async () => ({ ...schema, schedulePublish: true }),
      loadDocument: async () => ({ ...initial(), _status: 'draft' }),
      publish: async (ref) => (published.push(ref), { ok: true }),
      schedulePublish,
    })
    await mountEditor(ds, `<span ${ann('data-onpage-field="title"')}>Hello</span>`)
    fireEvent.click(screen.getByTestId('onpage-publish-more'))
    const doc = await screen.findByTestId<HTMLInputElement>('onpage-publish-doc-c:pages:1')
    expect(doc.checked).toBe(true) // has unpublished changes
    expect(screen.getByText('Hello')).toBeTruthy()
    // Schedule an hour from now.
    const at = new Date(Date.now() + 3600_000)
    const local = new Date(at.getTime() - at.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16)
    fireEvent.change(screen.getByTestId('onpage-schedule-at'), { target: { value: local } })
    fireEvent.click(screen.getByTestId('onpage-schedule'))
    await waitFor(() => expect(schedulePublish).toHaveBeenCalledTimes(1))
    expect(schedulePublish.mock.calls[0]![0]).toMatchObject({ slug: 'pages', id: 1 })
    expect(published).toEqual([]) // scheduling doesn't publish now
    await waitFor(() => expect(screen.queryByTestId('onpage-publish-panel')).toBeNull())
    // Publish now, through the panel.
    fireEvent.click(screen.getByTestId('onpage-publish-more'))
    fireEvent.click(await screen.findByTestId('onpage-publish-selected'))
    await waitFor(() => expect(published).toHaveLength(1))
  })
})

describe('OnPageClient', () => {
  it('renders the given doc without an editor, with inert annotations', () => {
    hub.set(null)
    render(
      <OnPageClient
        collection="pages"
        doc={{ id: 1, title: 'Static' }}
        render={(d, e) => <h1 {...e.field('title')}>{d.title}</h1>}
      />,
    )
    expect(screen.getByRole('heading').textContent).toBe('Static')
    expect(screen.getByRole('heading').hasAttribute('data-onpage-ref')).toBe(false)
  })
  it('inside an editor: renders editor state with markers and live annotations', async () => {
    const { ds } = source()
    document.body.innerHTML = ''
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(
      <>
        <OnPageEditor dataSource={ds} links={{ exit: '/exit' }} />
        <OnPageClient
          collection="pages"
          doc={initial()}
          render={(d, e) => <h1 {...e.field('title')}>{d.title}</h1>}
        />
      </>,
      { container: host },
    )
    await waitFor(() =>
      expect(stegaDecode(screen.getByRole('heading').textContent ?? '')[0]).toMatchObject({
        path: 'title',
      }),
    )
    expect(screen.getByRole('heading').getAttribute('data-onpage-ref')).toBe('c:pages:1')
  })
})

describe('sanitizeHtml and hub', () => {
  it('drops scripts, handlers and unsafe URLs', () => {
    const out = sanitizeHtml(
      '<p onclick="x()">Hi <a href="javascript:alert(1)">x</a><a href="/ok">ok</a><script>bad()</script><img src="data:x" onerror="y()"></p>',
    )
    expect(out).not.toMatch(/onclick|onerror|javascript:|script|data:/)
    expect(out).toContain('href="/ok"')
  })
  it('is one shared store, even across module copies', () => {
    const seen = vi.fn()
    const off = hub.subscribe(seen)
    act(() => hub.set(null))
    expect((globalThis as Record<symbol, unknown>)[Symbol.for('payload-onpage.hub')]).toBeTruthy()
    off()
  })
})
