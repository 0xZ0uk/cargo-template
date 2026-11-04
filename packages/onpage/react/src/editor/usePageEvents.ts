'use client'

/**
 * Page-level input for the editor:
 *  - click a field to edit it, a row to select it (⌥-click uses the page normally)
 *  - keyboard: every target is focusable; Enter edits a field or selects a row,
 *    ⌥↑/⌥↓ move the selected row, ⌥⌫ deletes it, Escape clears; ⌘Z/⇧⌘Z undo/redo
 *  - a warning before leaving with unsaved changes
 */
import { useEvent } from '../useEvent.ts'
import { refKey, resolveRow, isReady } from '@cargo/onpage-core'
import { rowOps } from '../rowOps.ts'
import { useEffect } from 'react'
import { DOM_ATTR, isOurs, isTyping } from '../dom.ts'
import { isFieldTarget, isRowTarget, targetsAt } from '../targets.ts'
import type { OnPageContextValue } from '../types.ts'

const FOCUSABLE_FLAG = DOM_ATTR.focusable

export function usePageEvents(ctx: OnPageContextValue | null, root: () => ParentNode | null): void {
  const onClick = useEvent((e: MouseEvent) => {
    if (!ctx || e.altKey || e.button !== 0) return
    const t = e.target
    if (!(t instanceof Element) || isOurs(t)) return
    const r = root()
    if (r && !r.contains(t)) return
    if (ctx.panel?.kind === 'blocks') {
      // A click on the page closes the block picker (and its preview) instead of editing.
      e.preventDefault()
      e.stopPropagation()
      ctx.setPanel(null)
      return
    }
    const { field, rows } = targetsAt(ctx.targets, t)
    const row = rows[0]
    const inControl = !!t.closest('a,button,label,summary,[role="button"]')
    if (row) ctx.setSelected({ key: refKey(row.ref), path: row.path })
    else if (!field) ctx.setSelected(null)
    if (
      field &&
      ctx.edit(refKey(field.ref), field.path, {
        point: { x: e.clientX, y: e.clientY },
        kind: field.kind,
        anchor: field.el,
      })
    ) {
      e.preventDefault()
      e.stopPropagation()
    } else if ((field || row) && inControl) {
      e.preventDefault() // don't navigate away from the editor by accident
    }
  })

  /** ⌥↑/⌥↓ move the selected row, ⌥⌫ deletes it. True when the key was ours (even if the row can't move). */
  const moveSelected = (dir: -1 | 1 | 'delete') => {
    if (!ctx?.selected) return false
    const { key, path } = ctx.selected
    const state = ctx.snap.docs[key]
    const info = isReady(state) ? resolveRow(state.schema, state.doc, path) : null
    if (!info) return false
    const ops = rowOps(ctx.session, key, info)
    if (dir === 'delete') {
      if (ops.remove()) ctx.setSelected(null)
    } else {
      const next = ops.move(dir)
      if (next) ctx.setSelected(next)
    }
    return true
  }

  const onKey = useEvent((e: KeyboardEvent) => {
    if (!ctx) return
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'Escape') {
      ctx.setPanel(null)
      ctx.setSelected(null)
      return
    }
    if (isTyping(e.target)) return
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) ctx.session.redo()
      else ctx.session.undo()
      return
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      ctx.session.redo()
      return
    }
    if (
      e.altKey &&
      (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Backspace' || e.key === 'Delete')
    ) {
      if (moveSelected(e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 'delete'))
        e.preventDefault()
      return
    }
    if (
      (e.key === 'Enter' || e.key === 'F2') &&
      e.target instanceof Element &&
      e.target.hasAttribute(FOCUSABLE_FLAG)
    ) {
      const own = ctx.targets.at(e.target)
      const field = own.find(isFieldTarget)
      const row = own.find(isRowTarget)
      if (field && ctx.edit(refKey(field.ref), field.path, { kind: field.kind, anchor: field.el }))
        e.preventDefault()
      else if (row) {
        ctx.setSelected({ key: refKey(row.ref), path: row.path })
        e.preventDefault()
      }
    }
  })

  const onFocus = useEvent((e: FocusEvent) => {
    if (!ctx || !(e.target instanceof Element) || !e.target.hasAttribute(FOCUSABLE_FLAG)) return
    const row = ctx.targets.at(e.target).find(isRowTarget)
    if (row) ctx.setSelected({ key: refKey(row.ref), path: row.path })
  })

  const onUnload = useEvent((e: BeforeUnloadEvent) => {
    if (!ctx?.session.hasPendingSaves) return
    void ctx.session.flush()
    e.preventDefault()
  })

  useEffect(() => {
    document.documentElement.setAttribute(DOM_ATTR.editing, '')
    const click = (e: MouseEvent) => onClick(e)
    const key = (e: KeyboardEvent) => onKey(e)
    const focus = (e: FocusEvent) => onFocus(e)
    const unload = (e: BeforeUnloadEvent) => onUnload(e)
    document.addEventListener('click', click, true)
    document.addEventListener('keydown', key)
    document.addEventListener('focusin', focus)
    window.addEventListener('beforeunload', unload)
    return () => {
      document.documentElement.removeAttribute(DOM_ATTR.editing)
      document.removeEventListener('click', click, true)
      document.removeEventListener('keydown', key)
      document.removeEventListener('focusin', focus)
      window.removeEventListener('beforeunload', unload)
    }
  }, [onClick, onFocus, onKey, onUnload])

  // Make every target reachable by keyboard (restored when the editor goes away).
  const targets = ctx?.targets
  useEffect(() => {
    const touched: HTMLElement[] = []
    for (const t of targets?.all ?? []) {
      if (t.kind === 'list' || !(t.el instanceof HTMLElement) || t.el.hasAttribute('tabindex'))
        continue
      t.el.setAttribute('tabindex', '0')
      t.el.setAttribute(FOCUSABLE_FLAG, '')
      if (t.label) t.el.setAttribute('aria-description', t.label)
      touched.push(t.el)
    }
    return () => {
      for (const el of touched) {
        el.removeAttribute('tabindex')
        el.removeAttribute(FOCUSABLE_FLAG)
        el.removeAttribute('aria-description')
      }
    }
  }, [targets])
}
