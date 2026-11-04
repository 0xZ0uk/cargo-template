/** The default field editors. Spread, override or remove (`null`) entries via the `editors` option. */
import { toText } from '@cargo/onpage-core'
import { defineEditor } from '../registry.ts'
import type { EditorRegistry } from '../types.ts'
import { checkedOf, CheckboxEditor } from './CheckboxEditor.tsx'
import { ColorEditor, toColor } from './ColorEditor.tsx'
import { DateEditor, toIsoDate } from './DateEditor.tsx'
import { InlineText } from './InlineText.tsx'
import { NumberEditor, toNumber } from './NumberEditor.tsx'
import { RelationshipEditor } from './RelationshipEditor.tsx'
import { SelectEditor, selectedValues } from './SelectEditor.tsx'
import { UploadEditor } from './UploadEditor.tsx'

const text = defineEditor({
  mode: 'inline',
  accepts: ['text', 'textarea', 'email'],
  normalize: (raw) => toText(raw),
  component: InlineText,
})
const select = defineEditor({
  mode: 'popover',
  accepts: ['select', 'radio'],
  normalize: selectedValues,
  component: SelectEditor,
})

export const defaultEditors: EditorRegistry = {
  text,
  textarea: text,
  email: text,
  select,
  radio: select,
  checkbox: defineEditor({
    mode: 'popover',
    accepts: ['checkbox'],
    normalize: checkedOf,
    component: CheckboxEditor,
  }),
  number: defineEditor({
    mode: 'popover',
    accepts: ['number'],
    normalize: toNumber,
    component: NumberEditor,
  }),
  date: defineEditor({
    mode: 'popover',
    accepts: ['date'],
    normalize: toIsoDate,
    component: DateEditor,
  }),
  relationship: defineEditor({
    mode: 'popover',
    accepts: ['relationship'],
    component: RelationshipEditor,
  }),
  upload: defineEditor({ mode: 'popover', accepts: ['upload'], component: UploadEditor }),
  // A text field holding a hex color: `admin.custom.onpage.editor: 'color'`.
  color: defineEditor({
    mode: 'popover',
    accepts: ['text'],
    normalize: toColor,
    component: ColorEditor,
  }),
}

export {
  CheckboxEditor,
  ColorEditor,
  DateEditor,
  InlineText,
  NumberEditor,
  RelationshipEditor,
  SelectEditor,
  UploadEditor,
}
