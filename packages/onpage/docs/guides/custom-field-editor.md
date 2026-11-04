# Custom field editor

A field editor is a React component, registered by id with `defineEditor`. You declare which field types it accepts. Its props are then typed for those fields: a `number` editor gets a `NumberField` with `min`/`max`, and a select editor gets the `options`. The registry never hands an editor any other kind of field.

```tsx
'use client'
import { defineEditor, EditorPopover, type FieldEditorProps } from '@cargo/onpage-react/editor-kit'
import type { ScalarField } from '@cargo/onpage-core'
import { useState } from 'react'

function JsonEditor(props: FieldEditorProps<ScalarField>) {
  const { value, commit, close, t } = props
  const [text, setText] = useState(JSON.stringify(value ?? {}, null, 2))
  const [error, setError] = useState<string | null>(null)
  const apply = () => {
    try {
      commit(JSON.parse(text))
      close()
    } catch {
      setError('Invalid JSON')
    }
  }
  return (
    <EditorPopover props={props} testId="my-json" width={360}>
      <textarea
        className="po-input"
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        data-autofocus
      />
      {error && <p className="po-error">{error}</p>}
      <button type="button" className="po-btn po-primary" onClick={apply}>
        {t('common.apply')}
      </button>
    </EditorPopover>
  )
}

export const json = defineEditor({ mode: 'popover', accepts: ['json'], component: JsonEditor })
```

Register it from a client mount, and pass that mount to `<OnPage>`:

```tsx
'use client'
import { OnPageMount, type OnPageMountProps } from '@cargo/onpage-next/client'
import { json } from './JsonEditor'

export const Mount = (p: OnPageMountProps) => <OnPageMount {...p} editors={{ json }} />
```

```tsx
<OnPage mount={Mount} />
```

## Typed values

`normalize` turns the stored value into the editor's value once, before it renders. The component then receives that type:

```tsx
const percent = defineEditor({
  mode: 'popover',
  accepts: ['number'],
  normalize: (raw) => (typeof raw === 'number' ? raw : null),
  component: PercentEditor, // (props: FieldEditorProps<NumberField, number | null>)
})
```

A text draft that previews live and commits on Apply is `useDraft`. Add `ApplyBar` for the buttons:

```tsx
function PercentEditor(props: FieldEditorProps<NumberField, number | null>) {
  const { draft, change, save, onKeyDown } = useDraft(props, {
    format: (v) => (v === null ? '' : String(v)),
    parse: (d) => (d === '' ? null : Number.isFinite(Number(d)) ? Number(d) : undefined), // undefined = not valid yet
  })
  return (
    <EditorPopover props={props} testId="my-percent">
      <input
        className="po-input"
        value={draft}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
        data-autofocus
      />
      <ApplyBar onApply={save} t={props.t} />
    </EditorPopover>
  )
}
```

## Which editor a field gets

1. `admin: { custom: { onpage: { editor: 'json' } } }` on the field, when the editor accepts the field's type
2. The kind the element declares (`text`/`textarea`/`richtext`/`media`)
3. The editor registered for the field's type (`json`, `select`…)

Inline editors never get a field holding a list of values (`hasMany`). `null` removes a default (`editors={{ color: null }}`).

## Props

| Prop              |                                                                        |
| ----------------- | ---------------------------------------------------------------------- |
| `field`           | The field, typed by the kinds the editor accepts                       |
| `value`           | Current value (after `normalize`)                                      |
| `commit(v)`       | Save a value: one undo step, autosaved                                 |
| `preview(v)`      | Live preview (client mode); not saved                                  |
| `close()`         | Close; reverts uncommitted previews                                    |
| `element()`       | The page element showing the field (anchor, measurements)              |
| `ghost({ html })` | Refresh mode: keep new content on screen until the server render lands |
| `live`            | true when the page renders from editor state                           |
| `t(key, vars)`    | UI strings: keys and their variables are checked by the compiler       |

`editor-kit` also exports:

- the building blocks above: `EditorPopover`, `ApplyBar`, `useDraft`, `Dialog`
- hooks: `useOnPage`, `useDebouncedSearch` (its search receives an `AbortSignal`), `useTrackElement`
- DOM helpers: `placeOver`, `copyTypography`, `sanitizeHtml` and friends
