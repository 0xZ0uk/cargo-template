'use client'

/**
 * Everything drawn over the page: hover outlines, the section and item
 * toolbars, "+" insert points and "+ Add" for lists. Positions are measured
 * from the target elements whenever the layout changes.
 */
import {
  fieldAtPath,
  getAt,
  isEditablePath,
  isListField,
  newArrayRow,
  refKey,
  resolveRow,
  rowPrefixes,
  type RowInfo,
  type Target,
  isReady,
  type RefKey,
} from '@shipment/onpage-core'
import { useEffect, useState } from 'react'
import { useOnPage } from '../context.tsx'
import { isOurs, shortcut } from '../dom.ts'
import { belowList, GEOMETRY, inViewport, outlineBox, toolbarPosition } from '../geometry.ts'
import { useLayoutTick } from '../layout.ts'
import { DragHandle } from './DragHandle.tsx'
import { ToolbarButton } from './ToolbarButton.tsx'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BookmarkIcon,
  CloseIcon,
  DuplicateIcon,
  SettingsIcon,
} from '../icons.tsx'
import { targetsAt } from '../targets.ts'
import { insertRow, rowOps } from '../rowOps.ts'
import { hasSettings } from '../settings.ts'

interface Hover {
  field?: Target | undefined
  rows: Target[] // innermost first
}

function useHover(): Hover {
  const { targets } = useOnPage()
  const [hover, setHover] = useState<Hover>({ rows: [] })
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const t = e.target
      if (!(t instanceof Element) || isOurs(t)) return // over our UI: keep the current hover
      const next = targetsAt(targets, t)
      setHover((h) =>
        h.field === next.field &&
        h.rows.length === next.rows.length &&
        h.rows.every((r, i) => r === next.rows[i])
          ? h
          : next,
      )
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [targets])
  return hover
}

function Outline({
  el,
  variant,
  label,
}: {
  el: Element
  variant?: 'block' | 'item'
  label?: string | undefined
}) {
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return (
    <>
      <div className={`po-outline${variant ? ` is-${variant}` : ''}`} style={outlineBox(r)} />
      {label && (
        <div
          className={`po-chip${variant === 'item' ? ' is-item' : ''}`}
          style={{
            top: Math.max(r.top - GEOMETRY.outline, GEOMETRY.chipMinTop),
            left: r.left - GEOMETRY.outline,
          }}
        >
          {label}
        </div>
      )}
    </>
  )
}

interface ActiveRow {
  key: RefKey
  info: RowInfo
  el: Element
}

function RowToolbar({ row, variant }: { row: ActiveRow; variant: 'block' | 'item' }) {
  const { session, snap, setSelected, setPanel, selected, targets, t } = useOnPage()
  const [dragging, setDragging] = useState(false)
  const { key, info, el } = row
  const canSaveSection = !!snap.docs[key]?.schema?.patterns && !!session.dataSource.savePattern
  const r = el.getBoundingClientRect()
  // Off screen, the toolbar hides; but not mid-drag, which would end the drag with it.
  if (!dragging && !inViewport(r, GEOMETRY.toolbar)) return null
  const { path } = info
  const label = targets.find(key, path, ['item'])?.label || info.label
  const ops = rowOps(session, key, info)
  const move = (dir: -1 | 1) => {
    const next = ops.move(dir)
    if (next) setSelected(next)
  }
  const duplicate = () => {
    const next = ops.duplicate()
    if (next) setSelected(next)
  }
  const remove = () => {
    if (ops.remove() && selected?.key === key && selected.path.startsWith(path)) setSelected(null)
  }
  return (
    <div
      className={`po-bar${variant === 'item' ? ' is-item' : ''}`}
      style={toolbarPosition(r, getComputedStyle(el).direction === 'rtl')}
      role="toolbar"
      aria-label={t('row.toolbar', { label })}
      data-testid={`onpage-${variant}-toolbar`}
    >
      <DragHandle
        rowKey={key}
        info={info}
        onDragging={setDragging}
        testId={`onpage-${variant}-drag`}
      />
      <span className="po-btn po-bar-label">{label}</span>
      <ToolbarButton
        label={t('row.moveUp')}
        icon={<ArrowUpIcon />}
        disabled={!ops.canMove(-1)}
        onClick={() => move(-1)}
        testId={`onpage-${variant}-up`}
      />
      <ToolbarButton
        label={t('row.moveDown')}
        icon={<ArrowDownIcon />}
        disabled={!ops.canMove(1)}
        onClick={() => move(1)}
        testId={`onpage-${variant}-down`}
      />
      <ToolbarButton
        label={t('row.duplicate')}
        icon={<DuplicateIcon />}
        disabled={!ops.canDuplicate}
        onClick={duplicate}
        testId={`onpage-${variant}-duplicate`}
      />
      {variant === 'block' && canSaveSection && (
        <ToolbarButton
          label={t('row.saveSection')}
          icon={<BookmarkIcon />}
          onClick={() => setPanel({ kind: 'saveSection', key, path, title: label })}
          testId="onpage-block-save"
        />
      )}
      {hasSettings(info.rowFields, path, key, targets) && (
        <ToolbarButton
          label={t('row.settings')}
          icon={<SettingsIcon />}
          onClick={() => setPanel({ kind: 'settings', key, path, title: label })}
          testId={`onpage-${variant}-settings`}
        />
      )}
      <ToolbarButton
        label={t('row.delete', { undo: shortcut('Z') })}
        icon={<CloseIcon />}
        danger
        disabled={!ops.canRemove}
        onClick={remove}
        testId={`onpage-${variant}-delete`}
      />
    </div>
  )
}

function InsertPoints({ row }: { row: ActiveRow }) {
  const { setPanel, t } = useOnPage()
  const r = row.el.getBoundingClientRect()
  const x = r.left + r.width / 2
  const at = (index: number, y: number, edge: 'above' | 'below') =>
    y > 0 && y < window.innerHeight ? (
      <div className="po-add" style={{ top: y, left: x }} key={edge}>
        <button
          type="button"
          className="po-btn"
          onClick={() =>
            setPanel({ kind: 'blocks', key: row.key, listPath: row.info.listPath, index })
          }
          aria-label={t(edge === 'above' ? 'row.addSectionAbove' : 'row.addSectionBelow')}
          data-testid={`onpage-insert-${edge}`}
        >
          + {t('row.addSection')}
        </button>
      </div>
    ) : null
  return (
    <>
      {at(row.info.index, r.top, 'above')}
      {at(row.info.index + 1, r.bottom, 'below')}
    </>
  )
}

function AddItem({ list }: { list: Target }) {
  const { snap, session, setPanel, setSelected, t } = useOnPage()
  const key = refKey(list.ref)
  const state = snap.docs[key]
  if (!isReady(state) || !isEditablePath(state.schema, list.path)) return null
  const field = fieldAtPath(state.schema.fields, state.doc, list.path)?.field
  if (!field || !isListField(field)) return null
  const rows = getAt(state.doc, list.path)
  const length = Array.isArray(rows) ? rows.length : 0
  const r = list.el.getBoundingClientRect()
  if (field.type === 'blocks') {
    // Sections get "+ Add section" above/below each one; this covers an empty list.
    if (length) return null
    return (
      <div
        className="po-add"
        style={{
          top: r.top + Math.min(r.height / 2, GEOMETRY.emptyListOffset),
          left: r.left + r.width / 2,
        }}
      >
        <button
          type="button"
          className="po-btn"
          onClick={() => setPanel({ kind: 'blocks', key, listPath: list.path, index: 0 })}
          data-testid="onpage-add-first-section"
        >
          + {t('row.addFirstSection')}
        </button>
      </div>
    )
  }
  if (field.maxRows !== undefined && length >= field.maxRows) return null
  // Below the list, or pinned to the bottom of the viewport while the list runs past it.
  if (!inViewport(r) || r.top > window.innerHeight - GEOMETRY.toolbar) return null
  const y = belowList(r)
  const item = list.label || field.labels?.singular || field.label
  const add = () => setSelected(insertRow(session, key, list.path, length, newArrayRow(field)))
  return (
    <div className="po-add is-item" style={{ top: y, left: r.left + r.width / 2 }}>
      <button type="button" className="po-btn" onClick={add} data-testid="onpage-add-item">
        + {t('row.addItem', { item })}
      </button>
    </div>
  )
}

export function Overlay() {
  const { selected, editing, targets, snap, panel } = useOnPage()
  useLayoutTick()
  const hover = useHover()
  // Choosing a section: the page may be showing a preview of it, which isn't editable yet.
  if (panel?.kind === 'blocks') return null

  const rowFor = (target: Target | undefined): ActiveRow | null => {
    if (!target) return null
    const key = refKey(target.ref)
    const state = snap.docs[key]
    const info = isReady(state) ? resolveRow(state.schema, state.doc, target.path) : null
    return info ? { key, info, el: target.el } : null
  }

  // The active row: the selected one, else the innermost hovered row.
  const active = rowFor(
    // A selection whose row is gone (undone, deleted) falls back to the hovered row.
    (selected && targets.find(selected.key, selected.path, ['item'])) ?? hover.rows[0],
  )

  // Its section: the outermost enclosing row of a blocks field (may be itself).
  let section: ActiveRow | null = null
  if (active) {
    for (const path of [...rowPrefixes(active.info.path), active.info.path]) {
      const candidate =
        path === active.info.path ? active : rowFor(targets.find(active.key, path, ['item']))
      if (candidate?.info.isBlock) {
        section = candidate
        break
      }
    }
  }
  const item = active && section?.info.path !== active.info.path ? active : null

  // "+ Add" for the active item's list, and for empty annotated lists.
  const lists = targets.all.filter((t) => t.kind === 'list')
  const itemList = item
    ? lists.find((l) => refKey(l.ref) === item.key && l.path === item.info.listPath)
    : undefined
  const emptyLists = lists.filter((l) => {
    const doc = snap.docs[refKey(l.ref)]?.doc
    const rows = doc ? getAt(doc, l.path) : undefined
    return doc && !(Array.isArray(rows) && rows.length)
  })
  const hoverField = !editing ? hover.field : undefined

  return (
    <>
      {section && <Outline el={section.el} variant="block" />}
      {item && <Outline el={item.el} variant="item" />}
      {hoverField && <Outline el={hoverField.el} label={hoverField.label} />}
      {!editing && section && <InsertPoints row={section} />}
      {!editing && section && <RowToolbar row={section} variant="block" />}
      {!editing && item && <RowToolbar row={item} variant="item" />}
      {!editing && itemList && <AddItem list={itemList} />}
      {!editing &&
        emptyLists
          .filter((l) => l !== itemList)
          .map((l) => <AddItem key={`${refKey(l.ref)}|${l.path}`} list={l} />)}
    </>
  )
}
