'use client'

/**
 * The one dialog primitive: labelled, focus moves in on open and back on
 * close, Tab stays inside (modal), Escape closes. `variant="popover"` is
 * anchored next to an element and closes on an outside click.
 */
import { useEvent } from '../useEvent.ts'
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { focusableIn, popoverPosition } from '../dom.ts'
import { useLayoutTick } from '../layout.ts'
import type { Translate } from '../messages.ts'
import { CloseIcon } from '../icons.tsx'

export interface DialogProps {
  title: string
  onClose: () => void
  children: ReactNode
  t: Translate
  /** modal: centered with a backdrop. panel: fixed side panel. popover: next to `anchor`. */
  variant?: 'modal' | 'panel' | 'popover'
  anchor?: () => Element | null
  width?: number
  testId?: string
  /** Extra header content (search box, actions). */
  actions?: ReactNode
}

export function Dialog({
  title,
  onClose,
  children,
  t,
  variant = 'modal',
  anchor,
  width,
  testId,
  actions,
}: DialogProps) {
  const box = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const [height, setHeight] = useState(240)
  useLayoutTick() // popovers follow their anchor

  // Focus in on open, back on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = box.current
    if (el)
      (
        el.querySelector<HTMLElement>('[autofocus],[data-autofocus]') ??
        focusableIn(el)[0] ??
        el
      ).focus({ preventScroll: true })
    return () => previous?.focus?.({ preventScroll: true })
  }, [])

  // Popovers flip above their anchor when there's no room below: track their height.
  useEffect(() => {
    const el = box.current
    if (variant !== 'popover' || !el) return
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [variant])

  // Stable, so the listeners below aren't re-bound on every render (callers pass inline
  // closures); a re-bind would also re-open the deferral gap where an outside click is lost.
  const close = useEvent(onClose)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
        return
      }
      if (e.key !== 'Tab' || variant !== 'modal' || !box.current) return
      const items = focusableIn(box.current)
      const first = items[0]
      const last = items.at(-1)
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    const onDown = (e: PointerEvent) => {
      if (variant === 'popover' && box.current && !box.current.contains(e.target as Node)) close()
    }
    document.addEventListener('keydown', onKey, true)
    // Deferred, so the click that opened a popover doesn't close it.
    const timer = setTimeout(() => document.addEventListener('pointerdown', onDown, true))
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [close, variant])

  const header = (
    <header className="po-dialog-head">
      <h2 className="po-h3" id={titleId}>
        {title}
      </h2>
      {actions}
      <button
        type="button"
        className="po-btn po-close"
        onClick={onClose}
        aria-label={t('common.close')}
      >
        <CloseIcon />
      </button>
    </header>
  )

  if (variant === 'modal') {
    return (
      // Backdrop: a press outside the dialog closes it (Escape works from the keyboard).
      <div
        className="po-modal-bg"
        onPointerDown={(e) => e.target === e.currentTarget && onClose()}
        data-testid={testId}
      >
        <div
          ref={box}
          className="po-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          style={width ? { width: `min(${width}px, 100%)` } : undefined}
        >
          {header}
          <div className="po-body">{children}</div>
        </div>
      </div>
    )
  }
  const style: CSSProperties =
    variant === 'popover'
      ? {
          ...popoverPosition(anchor?.() ?? null, { width: width ?? 300, height }),
          width: width ?? 300,
        }
      : // The panel sits at the end of the UI: right, or left in a right-to-left UI.
        { top: 72, insetInlineEnd: 16 }
  return (
    <div
      ref={box}
      className={variant === 'popover' ? 'po-pop' : 'po-panel'}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={style}
      data-testid={testId}
    >
      {header}
      {children}
    </div>
  )
}
