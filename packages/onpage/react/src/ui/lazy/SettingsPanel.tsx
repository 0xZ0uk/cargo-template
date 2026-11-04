'use client'

/**
 * Settings for one section or item, generated from the schema: every value
 * that isn't edited directly on the page — selects (layout, background, width,
 * spacing…), checkboxes, numbers, dates, relationships, URLs and other plain
 * text, images that aren't on the page. Changes apply immediately.
 */
import {
  errorText,
  fieldAtPath,
  getAt,
  relationTitle,
  rowFieldsOf,
  toText,
  isListField,
  type ChoiceField,
  type NumberField,
  type ScalarField,
  type SchemaField,
  isReady,
  newArrayRow,
  resolveRow,
  type ArrayField,
  type RefKey,
} from '@cargo/onpage-core'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useOnPage } from '../../context.tsx'
import type { Translate } from '../../messages.ts'
import { checkedOf } from '../../editors/CheckboxEditor.tsx'
import { selectedValues } from '../../editors/SelectEditor.tsx'
import { canEdit } from '../../registry.ts'
import { joinPath, settable } from '../../settings.ts'
import { usePageSettings } from '../usePageSettings.ts'
import { ArrowDownIcon, ArrowUpIcon, CloseIcon } from '../../icons.tsx'
import { insertRow, rowOps } from '../../rowOps.ts'
import { Dialog } from '../Dialog.tsx'
import { docTitle } from '../titles.ts'

const display = (v: unknown, t: Translate): string => {
  if (v == null || v === '') return t('common.none')
  if (Array.isArray(v))
    return v.length ? t('common.selected', { count: v.length }) : t('common.none')
  return typeof v === 'object' ? relationTitle(v) : toText(v)
}

function TextInput({
  docKey,
  path,
  field,
  id,
}: {
  docKey: RefKey
  path: string
  field: ScalarField | NumberField
  id: string
}) {
  const { session, snap } = useOnPage()
  const value = getAt(snap.docs[docKey]?.doc, path)
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? toText(value)
  const parse = (v: string) => (field.type === 'number' ? (v === '' ? null : Number(v)) : v)
  const commit = () => {
    if (draft === null) return
    session.setValue(docKey, path, parse(draft))
    setDraft(null)
  }
  return (
    <input
      id={id}
      className="po-input"
      type={field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : 'text'}
      value={shown}
      onChange={(e) => {
        setDraft(e.target.value)
        session.setValue(docKey, path, parse(e.target.value), { transient: true })
      }}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      data-testid={`onpage-setting-${path}`}
    />
  )
}

/** A radio group with arrow-key navigation (WAI-ARIA radio pattern). */
function Segmented({
  docKey,
  path,
  field,
  labelId,
}: {
  docKey: RefKey
  path: string
  field: ChoiceField
  labelId: string
}) {
  const { session, snap } = useOnPage()
  const options = field.options
  const current =
    selectedValues(getAt(snap.docs[docKey]?.doc, path) ?? field.defaultValue, field)[0] ?? ''
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === current),
  )
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (!step) return
    e.preventDefault()
    const next = options[(index + step + options.length) % options.length]
    if (next) session.setValue(docKey, path, next.value)
    const group = e.currentTarget.parentElement
    requestAnimationFrame(() =>
      group?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus(),
    )
  }
  return (
    <div className="po-seg" role="radiogroup" aria-labelledby={labelId}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={current === o.value}
          tabIndex={i === index ? 0 : -1}
          onClick={() => session.setValue(docKey, path, o.value)}
          onKeyDown={onKey}
          data-testid={`onpage-setting-${path}-${o.value}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Control({
  docKey,
  path,
  field,
  anchor,
  id,
  labelId,
}: {
  docKey: RefKey
  path: string
  field: SchemaField
  anchor: RefObject<HTMLDivElement | null>
  id: string
  labelId: string
}) {
  const { session, snap, edit, editors, t } = useOnPage()
  const value = getAt(snap.docs[docKey]?.doc, path)
  const set = (v: unknown) => session.setValue(docKey, path, v)
  const openEditor = (
    <button
      id={id}
      type="button"
      className="po-input po-picker"
      onClick={() => edit(docKey, path, { anchor: anchor.current ?? undefined })}
      data-testid={`onpage-setting-${path}`}
    >
      {field.type === 'upload'
        ? t(value ? 'settings.changeImage' : 'settings.chooseImage')
        : display(value, t)}
    </button>
  )
  // A field with its own editor (e.g. `editor: 'color'`) opens it, whatever its type.
  if (field.editor && canEdit(editors[field.editor], field)) return openEditor
  switch (field.type) {
    case 'select':
    case 'radio': {
      if (field.hasMany) return openEditor
      if (field.options.length <= 5)
        return <Segmented docKey={docKey} path={path} field={field} labelId={labelId} />
      return (
        <select
          id={id}
          className="po-select"
          value={selectedValues(value ?? field.defaultValue, field)[0] ?? ''}
          onChange={(e) => set(e.target.value || null)}
          data-testid={`onpage-setting-${path}`}
        >
          {!field.required && <option value="">{t('common.none')}</option>}
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )
    }
    case 'checkbox':
      return (
        <label className="po-check">
          <input
            type="checkbox"
            checked={checkedOf(value, field)}
            onChange={(e) => set(e.target.checked)}
            data-testid={`onpage-setting-${path}`}
          />
          {field.label}
        </label>
      )
    case 'text':
    case 'textarea':
    case 'email':
    case 'number':
      return 'hasMany' in field && field.hasMany ? (
        openEditor
      ) : (
        <TextInput docKey={docKey} path={path} field={field} id={id} />
      )
    default:
      // Dates, relationships, images…: open the field editor, anchored to the panel row.
      return openEditor
  }
}

function Row({ docKey, path, field }: { docKey: RefKey; path: string; field: SchemaField }) {
  const anchor = useRef<HTMLDivElement>(null)
  const id = useId()
  const labelId = `${id}-label`
  return (
    <div className="po-row" ref={anchor}>
      {field.type !== 'checkbox' && (
        <label id={labelId} htmlFor={id}>
          {field.label}
        </label>
      )}
      <Control
        docKey={docKey}
        path={path}
        field={field}
        anchor={anchor}
        id={id}
        labelId={labelId}
      />
      {field.description && <small>{field.description}</small>}
    </div>
  )
}

const NONE: ReadonlySet<string> = new Set()

/**
 * Paths hidden by their field's `admin.condition`, for the document as it is
 * now: asked from the data source (conditions are functions on the server),
 * again shortly after each change.
 */
function useHiddenFields(key: RefKey): ReadonlySet<string> {
  const { session, snap } = useOnPage()
  const state = snap.docs[key]
  const ref = state?.ref
  const doc = state?.doc
  const conditional = !!state?.schema?.conditions
  const [hidden, setHidden] = useState<ReadonlySet<string>>(NONE)
  useEffect(() => {
    const { dataSource } = session
    if (!conditional || !dataSource.hiddenFields || !ref || !doc) return
    let live = true
    const id = setTimeout(() => {
      dataSource.hiddenFields?.(ref, doc).then(
        (paths) => live && setHidden(new Set(paths)),
        () => undefined, // can't tell: show every field, as before
      )
    }, 150)
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [conditional, session, ref, doc])
  return hidden
}

function Fields({
  docKey,
  fields,
  path,
  hidden,
}: {
  docKey: RefKey
  fields: SchemaField[]
  path: string
  hidden: ReadonlySet<string>
}) {
  const { targets } = useOnPage()
  return (
    <>
      {fields
        .filter((f) => settable(f, path, docKey, targets) && !hidden.has(joinPath(path, f.name)))
        .map((f) => {
          const full = joinPath(path, f.name)
          if (f.type === 'array')
            return <ArrayRows key={f.name} docKey={docKey} path={full} field={f} hidden={hidden} />
          if (f.type === 'group') {
            return (
              <fieldset key={f.name} className="po-group">
                <legend className="po-h4">{f.label}</legend>
                <Fields docKey={docKey} fields={f.fields} path={full} hidden={hidden} />
              </fieldset>
            )
          }
          return <Row key={f.name} docKey={docKey} path={full} field={f} />
        })}
    </>
  )
}

/** The rows of a list the page doesn't show, each with its own settings; add, move, remove. */
function ArrayRows({
  docKey,
  path,
  field,
  hidden,
}: {
  docKey: RefKey
  path: string
  field: ArrayField
  hidden: ReadonlySet<string>
}) {
  const { session, snap, t } = useOnPage()
  const state = snap.docs[docKey]
  if (!isReady(state)) return null
  const value = getAt(state.doc, path)
  const rows: unknown[] = Array.isArray(value) ? value : []
  const item = field.labels?.singular ?? field.label
  const canAdd = field.maxRows === undefined || rows.length < field.maxRows
  const add = () => insertRow(session, docKey, path, rows.length, newArrayRow(field))
  return (
    <fieldset className="po-group po-array" data-testid={`onpage-setting-list-${path}`}>
      <legend className="po-h4">{field.label}</legend>
      {rows.map((row, i) => {
        const rowPath = `${path}.${i}`
        const info = resolveRow(state.schema, state.doc, rowPath)
        const ops = info && rowOps(session, docKey, info)
        const rowId = row && typeof row === 'object' && 'id' in row ? row.id : undefined
        const id =
          typeof rowId === 'string' || typeof rowId === 'number' ? String(rowId) : String(i)
        return (
          <div key={id} className="po-array-row">
            <div className="po-array-head">
              <span>
                {item} {i + 1}
              </span>
              {ops && (
                <span className="po-actions">
                  <button
                    type="button"
                    className="po-btn"
                    aria-label={t('row.moveUp')}
                    title={t('row.moveUp')}
                    disabled={!ops.canMove(-1)}
                    onClick={() => ops.move(-1)}
                  >
                    <ArrowUpIcon />
                  </button>
                  <button
                    type="button"
                    className="po-btn"
                    aria-label={t('row.moveDown')}
                    title={t('row.moveDown')}
                    disabled={!ops.canMove(1)}
                    onClick={() => ops.move(1)}
                  >
                    <ArrowDownIcon />
                  </button>
                  <button
                    type="button"
                    className="po-btn"
                    aria-label={t('common.removeItem', { item: `${item} ${i + 1}` })}
                    title={t('common.remove')}
                    disabled={!ops.canRemove}
                    onClick={() => ops.remove()}
                  >
                    <CloseIcon />
                  </button>
                </span>
              )}
            </div>
            <Fields docKey={docKey} fields={field.fields} path={rowPath} hidden={hidden} />
          </div>
        )
      })}
      {canAdd && (
        <button
          type="button"
          className="po-btn"
          onClick={add}
          data-testid={`onpage-setting-add-${path}`}
        >
          + {t('row.addItem', { item })}
        </button>
      )}
    </fieldset>
  )
}

/** One document's page settings, with its conditions applied. */
function DocFields({ docKey, fields }: { docKey: RefKey; fields: SchemaField[] }) {
  const hidden = useHiddenFields(docKey)
  return <Fields docKey={docKey} fields={fields} path="" hidden={hidden} />
}

/** Duplicate the page, or start a new one in its collection; then open it. */
function PageActions() {
  const { session, snap, docKeys, notify, t } = useOnPage()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const id = useId()
  const ds = session.dataSource
  const page = docKeys.map((k) => snap.docs[k]).find((d) => d?.ref.kind === 'collection')
  if (!page || (!ds.duplicatePage && !ds.createPage)) return null
  const open = async (make: () => Promise<{ path: string | null } | undefined>) => {
    setBusy(true)
    try {
      await session.flush()
      const made = await make()
      if (!made?.path) throw new Error(t('pages.noPath'))
      notify(t('notify.pageCreated'))
      window.location.assign(made.path)
    } catch (e) {
      notify(errorText(e), true)
      setBusy(false)
    }
  }
  return (
    <fieldset className="po-group" data-testid="onpage-page-actions">
      <legend className="po-h4">{t('pages.title')}</legend>
      {ds.duplicatePage && (
        <button
          type="button"
          className="po-btn"
          disabled={busy}
          onClick={() => void open(() => ds.duplicatePage!(page.ref, {}))}
          data-testid="onpage-page-duplicate"
        >
          {t('pages.duplicate')}
        </button>
      )}
      {ds.createPage && (
        <form
          className="po-row"
          onSubmit={(e) => {
            e.preventDefault()
            void open(() => ds.createPage!(page.ref.slug, { title: title.trim() }))
          }}
        >
          <label htmlFor={id}>{t('pages.new')}</label>
          <div className="po-alt-line">
            <input
              id={id}
              className="po-input"
              placeholder={t('pages.newTitle')}
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              aria-describedby={`${id}-hint`}
              data-testid="onpage-page-new-title"
            />
            <button
              type="submit"
              className="po-btn"
              disabled={busy || !title.trim()}
              data-testid="onpage-page-create"
            >
              {t('pages.create')}
            </button>
          </div>
          <small id={`${id}-hint`}>{t('pages.hint')}</small>
        </form>
      )}
    </fieldset>
  )
}

function PageSettingsPanel() {
  const { setPanel, t } = useOnPage()
  const docs = usePageSettings()
  return (
    <Dialog
      variant="panel"
      title={t('settings.page')}
      onClose={() => setPanel(null)}
      t={t}
      testId="onpage-page-settings"
    >
      {docs.map(({ state, fields }) =>
        docs.length > 1 ? (
          <fieldset key={state.key} className="po-group">
            <legend className="po-h4">{docTitle(state)}</legend>
            <DocFields docKey={state.key} fields={fields} />
          </fieldset>
        ) : (
          <DocFields key={state.key} docKey={state.key} fields={fields} />
        ),
      )}
      <PageActions />
    </Dialog>
  )
}

function RowFields({
  docKey,
  fields,
  path,
}: {
  docKey: RefKey
  fields: SchemaField[]
  path: string
}) {
  const hidden = useHiddenFields(docKey)
  return <Fields docKey={docKey} fields={fields} path={path} hidden={hidden} />
}

export function SettingsPanel() {
  const { panel, setPanel, snap, t } = useOnPage()
  if (panel?.kind === 'page') return <PageSettingsPanel />
  if (panel?.kind !== 'settings') return null
  const state = snap.docs[panel.key]
  if (!isReady(state)) return null
  const owner = fieldAtPath(state.schema.fields, state.doc, panel.path)?.field
  // Row fields: the block's fields for a blocks row, the item fields for an array row.
  const fields =
    owner && isListField(owner) ? (rowFieldsOf(owner, getAt(state.doc, panel.path)) ?? []) : []
  return (
    <Dialog
      variant="panel"
      title={t('settings.title', { label: panel.title })}
      onClose={() => setPanel(null)}
      t={t}
      testId="onpage-settings"
    >
      <RowFields docKey={panel.key} fields={fields} path={panel.path} />
    </Dialog>
  )
}
