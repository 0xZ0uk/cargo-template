import { describe, expect, it } from 'vitest'
import type { DocumentSchema, DocumentState } from '@cargo/onpage-core'
import { resolveEditTarget } from '../editor/editTarget.ts'
import { defineEditor } from '../registry.ts'

const C = () => null
const editors = {
  text: defineEditor({ mode: 'inline', accepts: ['text'], component: C }),
  number: defineEditor({ mode: 'popover', accepts: ['number'], component: C }),
}
const schema: DocumentSchema = {
  kind: 'collection',
  slug: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  editable: ['title', 'count'],
  drafts: true,
  fields: [
    { name: 'title', type: 'text', label: 'Title' },
    { name: 'count', type: 'number', label: 'Count' },
    { name: 'secret', type: 'text', label: 'Secret' },
  ],
}
const ready: DocumentState = {
  key: 'c:pages:1',
  ref: { kind: 'collection', slug: 'pages', id: 1 },
  status: 'ready',
  schema,
  doc: { title: 'T', count: 2 },
  save: { status: 'idle', seq: 0 },
  edited: false,
}

describe('resolveEditTarget', () => {
  it('opens the field editor the registry picks', () => {
    expect(resolveEditTarget(ready, editors, 'c:pages:1', 'count', {})).toMatchObject({
      kind: 'edit',
      editing: { key: 'c:pages:1', path: 'count', editor: 'number' },
    })
  })
  it('says not-ready while loading or after a failure, so the caller can explain', () => {
    expect(
      resolveEditTarget(
        { ...ready, status: 'loading', schema: null },
        editors,
        'c:pages:1',
        'title',
        {},
      ).kind,
    ).toBe('not-ready')
    expect(resolveEditTarget(undefined, editors, 'c:pages:1', 'title', {}).kind).toBe('not-ready')
  })
  it("opens nothing for fields that aren't editable on the page or have no editor", () => {
    expect(resolveEditTarget(ready, editors, 'c:pages:1', 'secret', {}).kind).toBe('none')
    expect(resolveEditTarget(ready, { text: editors.text }, 'c:pages:1', 'count', {}).kind).toBe(
      'none',
    )
  })
})
