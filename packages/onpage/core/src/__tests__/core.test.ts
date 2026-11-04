import { describe, expect, it } from 'vitest'
import { narrow } from './fixtures/narrow.ts'
import {
  getAt,
  insertItem,
  moveItem,
  parsePath,
  removeItem,
  setAt,
  splitItemPath,
  updateArray,
} from '../path.ts'
import type { SchemaField } from '../schema.ts'
import schemaFixture from './fixtures/schema.json'
import {
  buildPatch,
  changedKeys,
  changedPaths,
  cloneRow,
  defaultsFor,
  fieldAtPath,
  newBlockRow,
  normalizeValue,
  previewRow,
} from '../fields.ts'
import { AutosaveQueue, type SaveState } from '../autosave.ts'
import type { SaveResult as SendResult } from '../ports.ts'

// The editor schema the plugin produces for fixtures/payloadFields.ts (see plugin tests).
const schema = schemaFixture as SchemaField[]

describe('path', () => {
  it('parses dotted paths with numeric indexes', () => {
    expect(parsePath('sections.3.items.0.title')).toEqual(['sections', 3, 'items', 0, 'title'])
  })
  it('gets and sets immutably, sharing untouched branches', () => {
    const doc: any = { a: { b: [{ c: 1 }, { c: 2 }] }, z: { keep: true } }
    const next = setAt(doc, 'a.b.1.c', 9)
    expect(getAt(next, 'a.b.1.c')).toBe(9)
    expect(doc.a.b[1]!.c).toBe(2)
    expect(next.z).toBe(doc.z)
    expect(next.a.b[0]).toBe(doc.a.b[0])
  })
  it('moves, inserts and removes items, clamping bounds', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1])
    expect(moveItem([1, 2, 3], 2, 99)).toEqual([1, 2, 3])
    expect(insertItem([1, 3], 1, 2)).toEqual([1, 2, 3])
    expect(removeItem([1, 2, 3], 1)).toEqual([1, 3])
    expect(updateArray({}, 'list', (a) => [...a, 'x'])).toEqual({ list: ['x'] })
    expect(splitItemPath('sections.3.items.1')).toEqual(['sections.3.items', 1])
    expect(splitItemPath('sections.3.heading')).toBeNull()
  })
})

describe('schema-aware field ops', () => {
  const doc = {
    sections: [
      {
        id: 'a1',
        blockType: 'hero',
        heading: 'Hi',
        image: { id: 7, url: '/x.jpg' },
        ctas: [{ id: 'c1', label: 'Go' }],
        section: { background: 'light' },
      },
      { id: 'a2', blockType: 'gallery', images: [{ id: 'g1', image: { id: 8 } }] },
    ],
  }
  it('finds fields through blocks, groups and arrays', () => {
    expect(fieldAtPath(schema, doc, 'sections.0.heading')?.field.type).toBe('text')
    expect(fieldAtPath(schema, doc, 'sections.0.section.background')?.field.type).toBe('select')
    const cta = fieldAtPath(schema, doc, 'sections.0.ctas.0.label')
    expect(cta?.field.name).toBe('label')
    expect(cta?.blockPath).toBe('sections.0')
    expect(cta?.block?.slug).toBe('hero')
    expect(fieldAtPath(schema, doc, 'sections.1.images.0.image')?.field.type).toBe('upload')
    expect(fieldAtPath(schema, doc, 'sections.9.heading')).toBeNull()
  })
  it('builds new blocks from defaults and minRows', () => {
    const hero = newBlockRow(narrow(schema[1], 'blocks').blocks[0]!)
    expect(hero).toMatchObject({
      blockType: 'hero',
      heading: 'Heading',
      section: { background: 'white' },
      ctas: [],
    })
    expect(typeof hero.id).toBe('string')
    const gallery = newBlockRow(narrow(schema[1], 'blocks').blocks[1]!) as { images: unknown[] }
    expect(gallery.images).toHaveLength(1)
    expect(defaultsFor([])).toEqual({})
  })
  it('previews a block with its example over the defaults, with fresh row ids', () => {
    const block = narrow(schema[1], 'blocks').blocks[0]!
    const row = previewRow({
      ...block,
      example: { heading: 'Sample', blockType: 'other', ctas: [{ id: 'x', label: 'Go' }] },
    }) as any
    expect(row).toMatchObject({
      blockType: 'hero',
      heading: 'Sample',
      section: { background: 'white' },
    })
    expect(typeof row.id).toBe('string')
    expect(row.ctas[0].label).toBe('Go')
    expect(row.ctas[0].id).not.toBe('x')
    expect(previewRow(block)).toMatchObject({ heading: 'Heading' })
  })
  it('clones rows with new row ids but keeps related-document ids', () => {
    const heroFields = narrow(schema[1], 'blocks').blocks[0]!.fields
    const copy = cloneRow(doc.sections[0], heroFields) as any
    expect(copy.id).not.toBe('a1')
    expect(copy.ctas[0]!.id).not.toBe('c1')
    expect(copy.ctas[0]!.label).toBe('Go')
    expect(copy.image.id).toBe(7)
  })
  it('normalizes populated uploads to ids for saving, keeping row ids', () => {
    const out = normalizeValue(doc.sections, schema[1]!) as any[]
    expect(out[0]!.image).toBe(7)
    expect(out[0]!.id).toBe('a1')
    expect(out[1]!.images[0]).toEqual({ id: 'g1', image: 8 })
    expect(buildPatch(doc as any, ['sections'], schema).sections).toEqual(out)
  })
  it('reports changed top-level keys only', () => {
    const next = setAt(doc, 'sections.0.heading', 'Hello')
    expect(changedKeys(doc as any, next as any, ['title', 'sections'])).toEqual(['sections'])
    expect(changedKeys(doc as any, { ...doc } as any, ['sections'])).toEqual([])
  })
})

describe('changedPaths', () => {
  const fields: SchemaField[] = [
    { name: 'title', type: 'text', label: 'T' },
    { name: 'author', type: 'relationship', label: 'A', relationTo: 'users' },
    {
      name: 'meta',
      type: 'group',
      label: 'M',
      fields: [{ name: 'description', type: 'textarea', label: 'D' }],
    },
    {
      name: 'layout',
      type: 'blocks',
      label: 'L',
      blocks: [
        {
          slug: 'hero',
          labels: { singular: 'H', plural: 'H' },
          fields: [{ name: 'heading', type: 'text', label: 'H' }],
        },
        {
          slug: 'cta',
          labels: { singular: 'C', plural: 'C' },
          fields: [{ name: 'label', type: 'text', label: 'L' }],
        },
      ],
    },
  ]
  const published = {
    title: 'Home',
    author: 7,
    meta: { description: 'old' },
    layout: [
      { id: 'a', blockType: 'hero', heading: 'Hi' },
      { id: 'b', blockType: 'cta', label: 'Go' },
    ],
  }
  it('lists changed fields at any depth; populated relations compare by id', () => {
    const draft = {
      ...published,
      author: { id: 7, name: 'Ada' }, // same relation, populated
      meta: { description: 'new' },
      layout: [
        { id: 'b', blockType: 'cta', label: 'Go now' }, // moved up and edited: matched by id
        { id: 'a', blockType: 'hero', heading: 'Hi' },
        { id: 'c', blockType: 'cta', label: 'New' }, // added
      ],
    }
    expect(changedPaths(published, draft, fields)).toEqual([
      'meta.description',
      'layout',
      'layout.0.label',
      'layout.2',
    ])
    expect(changedPaths(published, structuredClone(published), fields)).toEqual([])
  })
})

describe('AutosaveQueue', () => {
  function harness(results: SendResult[]) {
    const timers: Array<{ fn: () => void; ms: number }> = []
    const sent: Array<Record<string, unknown>> = []
    const states: SaveState[] = []
    const q = new AutosaveQueue({
      delay: 800,
      send: async (patch) => {
        sent.push(patch)
        return results.shift() ?? { ok: true }
      },
      onState: (s) => states.push(s),
      setTimer: (fn, ms) => {
        const t = { fn, ms }
        timers.push(t)
        return t
      },
      clearTimer: (h) => {
        const i = timers.indexOf(h as any)
        if (i >= 0) timers.splice(i, 1)
      },
    })
    const tick = async () => {
      const t = timers.shift()
      t?.fn()
      await new Promise((r) => setTimeout(r, 0))
      return t
    }
    return { q, sent, states, timers, tick }
  }

  it('debounces and merges patches into one request', async () => {
    const h = harness([])
    h.q.schedule({ title: 'a' })
    h.q.schedule({ title: 'b', sections: [] })
    expect(h.timers).toHaveLength(1)
    await h.tick()
    expect(h.sent).toEqual([{ title: 'b', sections: [] }])
    expect(h.q.current.status).toBe('saved')
  })

  it('freezes on a 409 conflict', async () => {
    const h = harness([{ ok: false, status: 409, message: 'stale' }])
    h.q.schedule({ title: 'x' })
    await h.tick()
    expect(h.q.current.status).toBe('conflict')
    h.q.schedule({ title: 'y' })
    expect(h.timers).toHaveLength(0)
  })

  it('retries other failures with backoff, then reports an error', async () => {
    const h = harness([
      { ok: false, status: 500 },
      { ok: false, status: 500 },
    ])
    const q2 = h.q
    q2.schedule({ title: 'x' })
    await h.tick()
    expect(h.timers[0]!.ms).toBe(1000)
    await h.tick()
    expect(h.timers[0]!.ms).toBe(2000)
    await h.tick()
    expect(h.q.current.status).toBe('saved')
    expect(h.sent).toHaveLength(3)
  })

  it('stops immediately on validation and permission errors, keeping the changes for retry()', async () => {
    const h = harness([{ ok: false, status: 400, message: 'Title is required' }])
    h.q.schedule({ title: '' })
    await h.tick()
    expect(h.q.current).toMatchObject({ status: 'error', message: 'Title is required' })
    expect(h.timers).toHaveLength(0)
    h.q.retry()
    await h.tick()
    expect(h.sent).toEqual([{ title: '' }, { title: '' }])
    expect(h.q.current.status).toBe('saved')
  })

  it('retries network failures and 429s', async () => {
    const h = harness([
      { ok: false, status: 0 },
      { ok: false, status: 429 },
    ])
    h.q.schedule({ a: 1 })
    await h.tick()
    await h.tick()
    await h.tick()
    expect(h.q.current.status).toBe('saved')
  })

  it('counts successful saves and stops timers on dispose', async () => {
    const h = harness([])
    h.q.schedule({ a: 1 })
    await h.tick()
    h.q.schedule({ a: 2 })
    await h.tick()
    expect(h.q.current.seq).toBe(2)
    h.q.schedule({ a: 3 })
    h.q.dispose()
    expect(h.timers).toHaveLength(0)
  })

  it('flush sends immediately and waits', async () => {
    const h = harness([])
    h.q.schedule({ a: 1 })
    await h.q.flush()
    expect(h.sent).toEqual([{ a: 1 }])
    expect(h.timers).toHaveLength(0)
  })
})
