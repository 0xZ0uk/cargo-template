import { describe, expect, it } from 'vitest'
import { resolveRow, type DocumentSchema, type EditorSession } from '@cargo/onpage-core'
import { insertRow, rowOps } from '../rowOps.ts'

const schema: DocumentSchema = {
  kind: 'collection',
  slug: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  editable: ['items'],
  drafts: true,
  fields: [
    {
      name: 'items',
      type: 'array',
      label: 'Items',
      minRows: 1,
      maxRows: 3,
      fields: [{ name: 't', type: 'text', label: 'T' }],
    },
  ],
}

/** A session stand-in that applies changes to a local document. */
function fakeSession(doc: Record<string, unknown>) {
  const state = { doc }
  const session = {
    apply: (_key: string, fn: (d: Record<string, unknown>) => Record<string, unknown>) =>
      (state.doc = fn(state.doc)),
  }
  return { state, session: session as unknown as EditorSession }
}
const ops = (doc: Record<string, unknown>, path: string) => {
  const { state, session } = fakeSession(doc)
  const info = resolveRow(schema, state.doc, path)
  if (!info) throw new Error('no row')
  return { state, ops: rowOps(session, 'c:pages:1', info) }
}

describe('rowOps', () => {
  it('moves within bounds and returns the new selection', () => {
    const { state, ops: o } = ops({ items: [{ t: 'a' }, { t: 'b' }] }, 'items.0')
    expect(o.canMove(-1)).toBe(false)
    expect(o.move(-1)).toBeNull()
    expect(o.move(1)).toEqual({ key: 'c:pages:1', path: 'items.1' })
    expect(state.doc.items).toEqual([{ t: 'b' }, { t: 'a' }])
  })
  it('moves to any position (drag and drop), within bounds', () => {
    const { state, ops: o } = ops({ items: [{ t: 'a' }, { t: 'b' }, { t: 'c' }] }, 'items.0')
    expect(o.moveTo(0)).toBeNull()
    expect(o.moveTo(3)).toBeNull()
    expect(o.moveTo(2)).toEqual({ key: 'c:pages:1', path: 'items.2' })
    expect(state.doc.items).toEqual([{ t: 'b' }, { t: 'c' }, { t: 'a' }])
  })
  it('respects maxRows when duplicating, with a new row id', () => {
    const full = ops({ items: [{ id: '1' }, { id: '2' }, { id: '3' }] }, 'items.0')
    expect(full.ops.canDuplicate).toBe(false)
    expect(full.ops.duplicate()).toBeNull()
    const room = ops({ items: [{ id: '1', t: 'a' }] }, 'items.0')
    expect(room.ops.duplicate()).toEqual({ key: 'c:pages:1', path: 'items.1' })
    const [first, copy] = room.state.doc.items as Array<{ id: string; t: string }>
    expect(copy?.t).toBe('a')
    expect(copy?.id).not.toBe(first?.id)
  })
  it('respects minRows when removing', () => {
    const last = ops({ items: [{ t: 'a' }] }, 'items.0')
    expect(last.ops.canRemove).toBe(false)
    expect(last.ops.remove()).toBe(false)
    expect(last.state.doc.items).toHaveLength(1)
    const two = ops({ items: [{ t: 'a' }, { t: 'b' }] }, 'items.1')
    expect(two.ops.remove()).toBe(true)
    expect(two.state.doc.items).toEqual([{ t: 'a' }])
  })
  it('inserts a row and selects it', () => {
    const { state, session } = fakeSession({ items: [{ t: 'a' }] })
    expect(insertRow(session, 'c:pages:1', 'items', 0, { t: 'new' })).toEqual({
      key: 'c:pages:1',
      path: 'items.0',
    })
    expect(state.doc.items).toEqual([{ t: 'new' }, { t: 'a' }])
  })
})
