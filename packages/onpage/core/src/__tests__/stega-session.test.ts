import { describe, expect, it } from 'vitest'
import {
  encodeMarker,
  stegaClean,
  stegaCleanDeep,
  stegaDecode,
  stegaEncode,
  type Marker,
} from '../stega.ts'
import { isRefKey, parseRefKey, refKey, type RefKey } from '../docref.ts'
import { EditorSession } from '../session.ts'
import type { DataSource, Doc, SaveResult } from '../ports.ts'
import type { DocumentSchema } from '../schema.ts'

describe('docref', () => {
  it('round-trips collection and global keys', () => {
    expect(parseRefKey(refKey({ kind: 'collection', slug: 'pages', id: 23 }))).toEqual({
      kind: 'collection',
      slug: 'pages',
      id: 23,
    })
    expect(parseRefKey(refKey({ kind: 'collection', slug: 'posts', id: 'abc123' }))).toEqual({
      kind: 'collection',
      slug: 'posts',
      id: 'abc123',
    })
    expect(parseRefKey('g:header')).toEqual({ kind: 'global', slug: 'header' })
    expect(parseRefKey('x:nope')).toBeNull()
    // Only canonical safe integers become numbers: "007" and huge ids stay text.
    expect(parseRefKey('c:codes:007')).toEqual({ kind: 'collection', slug: 'codes', id: '007' })
    expect(parseRefKey('c:big:9007199254740993')).toMatchObject({ id: '9007199254740993' })
    expect(parseRefKey('c:posts:')).toBeNull()
  })
})

describe('stega', () => {
  const marker: Marker = { ref: 'c:pages:23', path: 'sections.3.items.2.title', kind: 'text' }

  it('round-trips a marker and stays invisible', () => {
    const s = stegaEncode('Trade pricing', marker)
    expect(s.startsWith('Trade pricing')).toBe(true)
    expect(stegaDecode(s)).toEqual([marker])
    expect(stegaClean(s)).toBe('Trade pricing')
    expect(s.trim()).toBe(s) // codec chars are not whitespace
    expect(stegaClean(s)).not.toBe(s)
  })

  it('handles unicode values and paths', () => {
    const m: Marker = { ref: 'g:en-tête', path: 'titre', kind: 'textarea' }
    expect(stegaDecode(stegaEncode('Café ☕ — déjà', m))).toEqual([m])
    expect(stegaClean(stegaEncode('Café ☕ — déjà', m))).toBe('Café ☕ — déjà')
  })

  it('re-marks instead of doubling, and finds several markers in concatenated text', () => {
    const once = stegaEncode('A', marker)
    expect(stegaDecode(stegaEncode(once, marker))).toHaveLength(1)
    const other = { ...marker, path: 'sections.0.heading' }
    expect(stegaDecode(stegaEncode('A', marker) + ' ' + stegaEncode('B', other))).toEqual([
      marker,
      other,
    ])
  })

  it('ignores truncated or corrupted markers, and cleans their fragments', () => {
    const s = stegaEncode('Hello', marker)
    const truncated = s.slice(0, s.length - 9)
    expect(stegaDecode(truncated)).toEqual([])
    expect(stegaClean(truncated)).toBe('Hello')
    expect(truncated).not.toBe('Hello') // fragments are present until cleaned
    const enc = encodeMarker(marker)
    expect(stegaDecode(enc.slice(0, 5) + enc.slice(6))).toEqual([]) // body length broken
  })

  it('cleans deeply without touching non-strings', () => {
    const d = {
      a: stegaEncode('x', marker),
      n: 3,
      list: [stegaEncode('y', marker), { b: stegaEncode('z', marker) }],
      when: new Date(0),
    }
    const out = stegaCleanDeep(d)
    expect(out).toEqual({ a: 'x', n: 3, list: ['y', { b: 'z' }], when: d.when })
    expect(out.when).toBe(d.when)
  })

  it('drops __proto__ keys instead of invoking the prototype setter', () => {
    const d = JSON.parse('{"title":"Hi","__proto__":{"polluted":true}}')
    const out = stegaCleanDeep(d)
    expect(out).toEqual({ title: 'Hi' })
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

// ── session ───────────────────────────────────────────────────────────────
const pageSchema: DocumentSchema = {
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
      blocks: [
        {
          slug: 'hero',
          labels: { singular: 'Hero', plural: 'Heroes' },
          fields: [
            { name: 'heading', type: 'text', label: 'Heading' },
            { name: 'image', type: 'upload', label: 'Image', relationTo: 'media' },
          ],
        },
      ],
    },
  ],
}
const headerSchema: DocumentSchema = {
  kind: 'global',
  slug: 'header',
  labels: { singular: 'Header', plural: 'Header' },
  editable: ['tagline'],
  drafts: true,
  fields: [{ name: 'tagline', type: 'text', label: 'Tagline' }],
}

function fakeSource(docs: Record<string, Doc>, opts: { conflictOn?: string } = {}) {
  const saves: Array<{ key: string; data: Doc; updatedAt?: string | undefined }> = []
  const published: string[] = []
  let version = 0
  const key = (r: any) => (r.kind === 'global' ? `g:${r.slug}` : `c:${r.slug}:${r.id}`)
  const ds: DataSource = {
    loadSchema: async (ref) => (ref.kind === 'global' ? headerSchema : pageSchema),
    loadDocument: async (ref, o) =>
      structuredClone(docs[key(ref) + (o.draft ? '' : ':published')] ?? docs[key(ref)] ?? {}),
    saveDraft: async (ref, data, o): Promise<SaveResult> => {
      saves.push({ key: key(ref), data, updatedAt: o.updatedAt })
      if (opts.conflictOn === key(ref)) return { ok: false, status: 409, message: 'stale' }
      return { ok: true, updatedAt: `v${++version}` }
    },
    publish: async (ref) => {
      published.push(key(ref))
      return { ok: true, updatedAt: `p${++version}` }
    },
  }
  return { ds, saves, published }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('EditorSession', () => {
  const base = () => ({
    'c:pages:1': {
      id: 1,
      updatedAt: 'v0',
      title: 'Home',
      layout: [{ id: 'r1', blockType: 'hero', heading: 'Hi', image: { id: 9, url: '/x.jpg' } }],
    },
    'c:pages:1:published': { id: 1, title: 'Home (live)', layout: [] },
    'g:header': { updatedAt: 'h0', tagline: 'Lighting since 1909' },
  })

  it('opens several documents and edits each independently', async () => {
    const { ds, saves } = fakeSource(base())
    const s = new EditorSession({ dataSource: ds, autosaveDelay: 0 })
    await Promise.all([
      s.open({ kind: 'collection', slug: 'pages', id: 1 }),
      s.open({ kind: 'global', slug: 'header' }),
    ])
    expect(s.getSnapshot().docs['c:pages:1']?.status).toBe('ready')
    s.setValue('c:pages:1', 'layout.0.heading', 'Hello')
    s.setValue('g:header', 'tagline', 'Made in Ohio')
    await s.flush()
    expect(saves.find((x) => x.key === 'c:pages:1')!.data).toEqual({
      layout: [{ id: 'r1', blockType: 'hero', heading: 'Hello', image: 9 }],
    })
    expect(saves.find((x) => x.key === 'c:pages:1')!.updatedAt).toBe('v0')
    expect(saves.find((x) => x.key === 'g:header')!.data).toEqual({ tagline: 'Made in Ohio' })
  })

  it('undo is session-wide and ordered across documents', async () => {
    const { ds } = fakeSource(base())
    const s = new EditorSession({ dataSource: ds, autosaveDelay: 0 })
    await Promise.all([
      s.open({ kind: 'collection', slug: 'pages', id: 1 }),
      s.open({ kind: 'global', slug: 'header' }),
    ])
    s.setValue('c:pages:1', 'title', 'A')
    s.setValue('g:header', 'tagline', 'B')
    s.undo()
    expect(s.get('g:header')!.doc!.tagline).toBe('Lighting since 1909')
    expect(s.get('c:pages:1')!.doc!.title).toBe('A')
    s.undo()
    expect(s.get('c:pages:1')!.doc!.title).toBe('Home')
    s.redo()
    expect(s.get('c:pages:1')!.doc!.title).toBe('A')
    expect(s.getSnapshot().canRedo).toBe(true)
  })

  it('transient typing becomes one undo step; cancel restores', async () => {
    const { ds, saves } = fakeSource(base())
    const s = new EditorSession({ dataSource: ds, autosaveDelay: 0 })
    await s.open({ kind: 'collection', slug: 'pages', id: 1 })
    s.setValue('c:pages:1', 'title', 'H', { transient: true })
    s.setValue('c:pages:1', 'title', 'Ho', { transient: true })
    expect(saves).toHaveLength(0)
    s.cancelTransient('c:pages:1')
    expect(s.get('c:pages:1')!.doc!.title).toBe('Home')
    s.setValue('c:pages:1', 'title', 'Ho', { transient: true })
    s.setValue('c:pages:1', 'title', 'Hola')
    s.undo()
    expect(s.get('c:pages:1')!.doc!.title).toBe('Home')
  })

  it('a conflict on one document freezes only that document', async () => {
    const { ds, saves } = fakeSource(base(), { conflictOn: 'g:header' })
    const s = new EditorSession({ dataSource: ds, autosaveDelay: 0 })
    await Promise.all([
      s.open({ kind: 'collection', slug: 'pages', id: 1 }),
      s.open({ kind: 'global', slug: 'header' }),
    ])
    s.setValue('g:header', 'tagline', 'X')
    await s.flush()
    expect(s.get('g:header')!.save.status).toBe('conflict')
    s.setValue('c:pages:1', 'title', 'Still saving')
    await s.flush()
    expect(s.get('c:pages:1')!.save.status).toBe('saved')
    expect(saves.filter((x) => x.key === 'c:pages:1')).toHaveLength(1)
  })

  it('keep mine: re-applies unsaved fields on the latest version, keeping fields only they changed', async () => {
    const docs: Record<string, Doc> = base()
    let conflictOnce = true
    const saves: Array<{ data: Doc; updatedAt?: string | undefined }> = []
    const ds: DataSource = {
      loadSchema: async () => pageSchema,
      loadDocument: async () => structuredClone(docs['c:pages:1']!),
      saveDraft: async (_r, data, o) => {
        saves.push({ data, updatedAt: o.updatedAt })
        if (conflictOnce) return ((conflictOnce = false), { ok: false, status: 409 })
        return { ok: true, updatedAt: 'v2' }
      },
      publish: async () => ({ ok: true }),
    }
    const s = new EditorSession({ dataSource: ds, autosaveDelay: 0 })
    await s.open({ kind: 'collection', slug: 'pages', id: 1 })
    s.setValue('c:pages:1', 'title', 'Mine')
    await s.flush()
    expect(s.get('c:pages:1')!.save.status).toBe('conflict')
    // Edits made during the conflict are kept too.
    s.setValue('c:pages:1', 'title', 'Mine, later')
    // Meanwhile someone changed the layout (and saved at v1).
    docs['c:pages:1'] = {
      ...docs['c:pages:1']!,
      updatedAt: 'v1',
      layout: [{ id: 'r1', blockType: 'hero', heading: 'Theirs', image: 9 }],
    }
    await s.keepMine('c:pages:1')
    const doc = s.get('c:pages:1')!.doc!
    expect(doc.title).toBe('Mine, later')
    expect((doc.layout as Array<{ heading: string }>)[0]!.heading).toBe('Theirs')
    expect(saves.at(-1)).toEqual({ data: { title: 'Mine, later' }, updatedAt: 'v1' })
    expect(s.get('c:pages:1')!.save.status).toBe('saved')
  })

  it('restores a version: saves pending edits first, then continues from the restored draft', async () => {
    const docs: Record<string, Doc> = base()
    const order: string[] = []
    const ds: DataSource = {
      loadSchema: async () => pageSchema,
      loadDocument: async () => structuredClone(docs['c:pages:1']!),
      saveDraft: async (_r, data) => (order.push(`save ${JSON.stringify(data)}`), { ok: true }),
      publish: async () => ({ ok: true }),
      restoreVersion: async (_r, id) => {
        order.push(`restore ${id}`)
        docs['c:pages:1'] = { ...docs['c:pages:1']!, title: 'From v1', updatedAt: 'v9' }
      },
    }
    const s = new EditorSession({ dataSource: ds, autosaveDelay: 10_000 })
    await s.open({ kind: 'collection', slug: 'pages', id: 1 })
    s.setValue('c:pages:1', 'title', 'Unsaved')
    await s.restoreVersion('c:pages:1', 'v1')
    expect(order).toEqual(['save {"title":"Unsaved"}', 'restore v1'])
    expect(s.get('c:pages:1')!.doc!.title).toBe('From v1')
    expect(s.getSnapshot().canUndo).toBe(false) // history continues from the restored draft
  })

  it('records the fields a failed save or publish names, and clears them when it succeeds', async () => {
    let fail = true
    const fields = [{ path: 'title', message: 'Required' }]
    const ds: DataSource = {
      loadSchema: async () => pageSchema,
      loadDocument: async () => structuredClone(base()['c:pages:1']),
      saveDraft: async () =>
        fail ? { ok: false, status: 400, message: 'invalid', fields } : { ok: true },
      publish: async () => ({ ok: false, status: 400, message: 'invalid', fields }),
    }
    const s = new EditorSession({ dataSource: ds, autosaveDelay: 0 })
    await s.open({ kind: 'collection', slug: 'pages', id: 1 })
    s.setValue('c:pages:1', 'title', '')
    await s.flush()
    expect(s.get('c:pages:1')!.invalid).toEqual(fields)
    fail = false
    await s.retry('c:pages:1')
    await s.flush()
    expect(s.get('c:pages:1')!.invalid).toBeUndefined()
    const res = await s.publish()
    expect(res.fields).toEqual(fields)
    expect(s.get('c:pages:1')!.invalid).toEqual(fields)
  })

  it('publishes edited documents only, and discard restores published values', async () => {
    const { ds, published, saves } = fakeSource(base())
    const seen: string[] = []
    const s = new EditorSession({
      dataSource: ds,
      autosaveDelay: 0,
      onSaved: (r) => seen.push(refKey(r)),
    })
    await Promise.all([
      s.open({ kind: 'collection', slug: 'pages', id: 1 }),
      s.open({ kind: 'global', slug: 'header' }),
    ])
    s.setValue('c:pages:1', 'title', 'New')
    const res = await s.publish()
    expect(res.ok).toBe(true)
    expect(published).toEqual(['c:pages:1'])
    expect(seen).toContain('c:pages:1')
    s.setValue('c:pages:1', 'title', 'Throwaway')
    await s.discard()
    expect(s.get('c:pages:1')!.doc!.title).toBe('Home (live)')
    expect(saves.at(-1)!.data).toMatchObject({ title: 'Home (live)', layout: [] })
  })

  it("client mode adopts the page's draft without fetching it", async () => {
    const { ds } = fakeSource({})
    let loads = 0
    const counting: DataSource = {
      ...ds,
      loadDocument: async (...a) => (loads++, ds.loadDocument(...a)),
    }
    const s = new EditorSession({ dataSource: counting })
    await s.open({ kind: 'collection', slug: 'pages', id: 7 }, { id: 7, title: 'Client' })
    expect(loads).toBe(0)
    expect(s.get('c:pages:7')!.doc!.title).toBe('Client')
  })

  it('a page-provided value wins over a server load still in flight', async () => {
    const { ds } = fakeSource(base())
    let release!: () => void
    const slow: DataSource = {
      ...ds,
      loadDocument: (...a) => new Promise((r) => (release = () => r(ds.loadDocument(...a)))),
    }
    const s = new EditorSession({ dataSource: slow })
    const loading = s.open({ kind: 'collection', slug: 'pages', id: 1 })
    await settle()
    const fromPage = s.open(
      { kind: 'collection', slug: 'pages', id: 1 },
      { id: 1, title: 'From page', updatedAt: 'v0' },
    )
    release()
    await Promise.all([loading, fromPage])
    expect(s.get('c:pages:1')!.doc!.title).toBe('From page')
  })

  it('keeps edits typed while a publish is running', async () => {
    const { ds } = fakeSource(base())
    let finish!: () => void
    const gated: DataSource = {
      ...ds,
      publish: (...a) => new Promise((r) => (finish = () => r(ds.publish(...a)))),
    }
    const s = new EditorSession({ dataSource: gated, autosaveDelay: 0 })
    await s.open({ kind: 'collection', slug: 'pages', id: 1 })
    s.setValue('c:pages:1', 'title', 'First')
    const publishing = s.publish()
    await settle()
    await settle()
    expect(s.getSnapshot().busy).toBe(true)
    s.setValue('c:pages:1', 'title', 'Typed meanwhile')
    finish()
    await publishing
    expect(s.get('c:pages:1')!.doc!.title).toBe('Typed meanwhile')
    expect(s.getSnapshot().busy).toBe(false)
  })

  it('refuses to publish a document with a failed save, and runs operations one at a time', async () => {
    const { ds } = fakeSource(base())
    const failing: DataSource = {
      ...ds,
      saveDraft: async () => ({ ok: false, status: 422, message: 'Invalid' }),
    }
    const s = new EditorSession({ dataSource: failing, autosaveDelay: 0 })
    await s.open({ kind: 'collection', slug: 'pages', id: 1 })
    s.setValue('c:pages:1', 'title', '')
    const [a, b] = await Promise.all([s.publish(), s.publish()])
    expect(a.ok).toBe(false)
    expect(a.message).toMatch(/Invalid/)
    expect(b.ok).toBe(false)
  })

  it('discard clears a conflict and resets to the published values', async () => {
    const { ds, saves } = fakeSource(base(), { conflictOn: 'c:pages:1' })
    const s = new EditorSession({ dataSource: ds, autosaveDelay: 0 })
    await s.open({ kind: 'collection', slug: 'pages', id: 1 })
    s.setValue('c:pages:1', 'title', 'Mine')
    await s.flush()
    expect(s.get('c:pages:1')!.save.status).toBe('conflict')
    await s.discard()
    expect(s.get('c:pages:1')!.doc!.title).toBe('Home (live)')
    expect(saves.length).toBeGreaterThan(1) // the reset was sent, not swallowed by the frozen queue
  })

  it('retries a failed load, and stops notifying after dispose', async () => {
    const { ds } = fakeSource(base())
    let fail = true
    const flaky: DataSource = {
      ...ds,
      loadSchema: async (...a) =>
        fail ? Promise.reject(new Error('offline')) : ds.loadSchema(...a),
    }
    const s = new EditorSession({ dataSource: flaky })
    await s.open({ kind: 'collection', slug: 'pages', id: 1 })
    expect(s.get('c:pages:1')).toMatchObject({ status: 'error', error: 'offline' })
    fail = false
    await s.retry('c:pages:1')
    expect(s.get('c:pages:1')!.status).toBe('ready')
    let calls = 0
    s.subscribe(() => calls++)
    s.dispose()
    s.setValue('c:pages:1', 'title', 'x')
    expect(calls).toBe(0)
  })
})

describe('RefKey', () => {
  it('only accepts document keys where a document key belongs', () => {
    const key: RefKey = refKey({ kind: 'collection', slug: 'pages', id: 1 })
    expect(isRefKey(key)).toBe(true)
    expect(isRefKey('sections.0.title')).toBe(false)
    // @ts-expect-error a field path is not a document key
    const wrong: RefKey = 'sections.0.title'
    expect(wrong).toBeTruthy()
  })
})
