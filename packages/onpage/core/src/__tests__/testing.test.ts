import { describe, expect, it } from 'vitest'
import { EditorSession } from '../session.ts'
import type { DocumentSchema } from '../schema.ts'
import { memoryDataSource } from '../testing.ts'

const pages: DocumentSchema = {
  kind: 'collection',
  slug: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  editable: ['title'],
  drafts: true,
  fields: [{ name: 'title', type: 'text', label: 'Title' }],
}

describe('memoryDataSource', () => {
  const make = () =>
    memoryDataSource({
      schemas: { pages },
      docs: {
        'c:pages:1': { id: 1, title: 'Home', updatedAt: 'v0' },
        'c:pages:2': { id: 2, title: 'About', updatedAt: 'v0' },
      },
    })
  it('drives a real editor session: saves, the stale-write check, publish', async () => {
    const ds = make()
    const s = new EditorSession({ dataSource: ds, autosaveDelay: 0 })
    await s.open({ kind: 'collection', slug: 'pages', id: 1 })
    s.setValue('c:pages:1', 'title', 'Hello')
    await s.flush()
    expect(ds.saves).toEqual([
      {
        ref: { kind: 'collection', slug: 'pages', id: 1 },
        data: { title: 'Hello', _status: 'draft' },
      },
    ])
    expect(ds.docs['c:pages:1']).toMatchObject({ title: 'Hello', _status: 'draft' })
    expect(ds.published['c:pages:1']?.title).toBe('Home')
    ds.conflictOnce('c:pages:1')
    s.setValue('c:pages:1', 'title', 'Again')
    await s.flush()
    expect(s.get('c:pages:1')!.save.status).toBe('conflict')
    await s.reload('c:pages:1')
    expect((await s.publish()).ok).toBe(true)
    expect(ds.published['c:pages:1']?.title).toBe('Hello')
  })
  it('searches a collection by its title field', async () => {
    const hits = await make().search!('pages', { query: 'ab', titleField: 'title' })
    expect(hits.map((h) => h.title)).toEqual(['About'])
  })
})
