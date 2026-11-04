import { describe, expect, it } from 'vitest'
import { Window } from 'happy-dom'
import type { NumberField, SchemaField, Target } from '@cargo/onpage-core'
import { canEdit, defineEditor, mergeEditors, resolveEditor } from '../registry.ts'
import { buildIndex } from '../targets.ts'
import type { EditorRegistry, FieldEditorProps } from '../types.ts'

const C = () => null
const reg: EditorRegistry = {
  text: { mode: 'inline', component: C },
  textarea: { mode: 'inline', component: C },
  email: { mode: 'inline', component: C },
  richText: { mode: 'inline', component: C },
  upload: { mode: 'popover', component: C },
  select: { mode: 'popover', component: C },
  color: { mode: 'popover', component: C },
}
const f = (type: SchemaField['type'], extra: Record<string, unknown> = {}): SchemaField => ({
  name: 'x',
  type,
  label: 'X',
  options: [],
  relationTo: 'media',
  fields: [],
  blocks: [],
  ...extra,
})

describe('resolveEditor', () => {
  it("prefers the field's own editor choice", () => {
    expect(resolveEditor(reg, f('text', { editor: 'color' }), 'text')).toBe('color')
  })
  it('ignores an unknown field choice', () => {
    expect(resolveEditor(reg, f('text', { editor: 'nope' }))).toBe('text')
  })
  it("uses the element's kind for rich text and media", () => {
    expect(resolveEditor(reg, f('richText'), 'richtext')).toBe('richText')
    expect(resolveEditor(reg, f('upload'), 'media')).toBe('upload')
  })
  it("doesn't open the image picker for a non-upload field marked as media", () => {
    expect(resolveEditor(reg, f('text'), 'media')).toBe('text')
  })
  it("keeps the field's textual type over the marker kind", () => {
    expect(resolveEditor(reg, f('email'), 'text')).toBe('email')
    expect(resolveEditor(reg, f('textarea'), 'text')).toBe('textarea')
  })
  it('falls back to the field type, or none', () => {
    expect(resolveEditor(reg, f('select'))).toBe('select')
    expect(resolveEditor(reg, f('json'))).toBeNull()
  })
  it('merges registries; null removes', () => {
    const merged = mergeEditors(reg, { select: null, json: { mode: 'popover', component: C } })
    expect(merged.select).toBeUndefined()
    expect(resolveEditor(merged, f('json'))).toBe('json')
  })
})

describe('buildIndex', () => {
  const doc = new Window().document as unknown as Document
  doc.body.innerHTML = `<h1 id="a">A</h1><p id="b">B</p>`
  const a = doc.getElementById('a')!
  const b = doc.getElementById('b')!
  const ref = { kind: 'collection' as const, slug: 'pages', id: 1 }
  const targets: Target[] = [
    { el: a, ref, path: 'title', kind: 'text', source: 'stega' },
    { el: b, ref, path: 'title', kind: 'text', source: 'annotation' },
  ]
  it('indexes by element and by path, annotations first', () => {
    const idx = buildIndex(targets)
    expect(idx.at(a)).toHaveLength(1)
    expect(idx.find('c:pages:1', 'title')?.el).toBe(b)
    expect(idx.find('c:pages:1', 'title', ['richtext'])).toBeUndefined()
  })
})

describe('typed editors', () => {
  it('never hands an editor a field kind it does not accept', () => {
    const typed = mergeEditors(reg, {
      color: defineEditor({ mode: 'popover', accepts: ['text'], component: C }),
      text: defineEditor({ mode: 'inline', accepts: ['text', 'textarea', 'email'], component: C }),
    })
    // `editor: 'color'` on a number field: not the color editor.
    expect(resolveEditor(typed, f('number', { editor: 'color' }))).toBeNull()
    expect(resolveEditor(typed, f('text', { editor: 'color' }))).toBe('color')
  })
  it('never edits a list of values in place', () => {
    const typed = { text: defineEditor({ mode: 'inline', accepts: ['text'], component: C }) }
    expect(resolveEditor(typed, f('text', { hasMany: true }), 'text')).toBeNull()
    expect(canEdit(typed.text, f('text'))).toBe(true)
  })
  it('types the component by the accepted kinds', () => {
    const NumberOnly = (_: FieldEditorProps<NumberField, number | null>) => null
    defineEditor({ mode: 'popover', accepts: ['number'], component: NumberOnly })
    // @ts-expect-error a number editor can't be registered for select fields
    defineEditor({ mode: 'popover', accepts: ['select'], component: NumberOnly })
    expect(true).toBe(true)
  })
})
