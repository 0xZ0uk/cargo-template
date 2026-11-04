'use client'

/**
 * In-place editing for text, textarea and email fields.
 *
 * The site's element is never made editable (React owns its DOM). An editable
 * twin with the same computed typography is laid over it and the original is
 * hidden. In client mode each keystroke re-renders the page live underneath;
 * in refresh mode the twin shows the text and, after commit, stays as a ghost
 * until the server render arrives. Blur/Enter commits (one undo step), Escape
 * cancels.
 */
import { lazy, Suspense, useLayoutEffect, useRef, useState, type FocusEvent } from 'react'
import type { ScalarField } from '@cargo/onpage-core'
import { useOnPage } from '../context.tsx'
import { copyTypography, HIDDEN, placeCaret, placeOver, typographyOf } from '../dom.ts'
import { useTrackElement } from '../layout.ts'
import type { FieldEditorProps } from '../types.ts'

import { escapeHtml } from '../sanitize.ts'

const AssistMenu = lazy(() => import('../ui/lazy/AssistMenu.tsx'))

export function InlineText({
  docKey,
  path,
  field,
  value,
  element,
  commit,
  preview,
  close,
  ghost,
  live,
  point,
  t,
}: FieldEditorProps<ScalarField, string>) {
  const multiline = field.type === 'textarea'
  const ref = useRef<HTMLDivElement>(null)
  const initial = useRef(value)
  const done = useRef(false)
  const { assist, session } = useOnPage()
  const [assisting, setAssisting] = useState(false)
  const [box, setBox] = useState<DOMRect | null>(null)
  const menu = useRef<HTMLDivElement>(null)
  // Focus moving between the text and the assistant's menu isn't leaving the editor.
  const leaving = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null
    return !(to && (ref.current?.contains(to) || menu.current?.contains(to)))
  }

  useLayoutEffect(() => {
    const el = element()
    const twin = ref.current
    if (!twin) return
    if (el) {
      copyTypography(el, twin)
      placeOver(twin, el, { minWidth: 40, minHeight: true })
      el.setAttribute(HIDDEN, 'true')
    }
    twin.textContent = initial.current
    twin.focus({ preventScroll: true })
    placeCaret(twin, point)
    return () => element()?.removeAttribute(HIDDEN)
    // Runs once: the twin takes over the element for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow the element as the page reflows (client mode re-renders it live).
  useTrackElement(element, (el) => {
    if (!ref.current) return
    if (!el.hasAttribute(HIDDEN)) el.setAttribute(HIDDEN, 'true')
    placeOver(ref.current, el, { minWidth: 40, minHeight: true })
    if (assist) setBox(ref.current.getBoundingClientRect())
  })

  const read = () => {
    // textContent, not innerText: innerText applies CSS (text-transform:
    // uppercase on an eyebrow would save "SANDBOX" for "Sandbox").
    const text = (ref.current?.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\n$/, '')
    return multiline ? text : text.replace(/\s*\n\s*/g, ' ')
  }

  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    const text = read()
    if (save && text !== initial.current) {
      commit(text === '' && !field.required ? null : text)
      if (!live && ref.current) ghost({ html: escapeHtml(text), style: typographyOf(ref.current) })
    }
    close()
  }

  const applyAnswer = (text: string) => {
    const twin = ref.current
    if (!twin) return
    twin.textContent = text
    if (live) preview(read())
    twin.focus({ preventScroll: true })
    placeCaret(twin, undefined)
  }

  const docRef = session.get(docKey)?.ref
  const twinEl = (
    <div
      ref={ref}
      className="po-inline"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      tabIndex={0}
      aria-multiline={multiline}
      aria-label={t('inline.label', { field: field.label })}
      data-testid="onpage-inline-text"
      spellCheck
      onInput={() => live && preview(read())}
      onBlur={(e) => leaving(e) && finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          finish(true)
        }
      }}
    />
  )
  if (!assist || !docRef) return twinEl
  return (
    <>
      {twinEl}
      <button
        type="button"
        className="po-btn po-assist-btn"
        style={box ? { top: Math.max(4, box.top - 30), left: box.right - 28 } : { display: 'none' }}
        aria-label={t('assist.label')}
        title={t('assist.label')}
        aria-expanded={assisting}
        // Keep the text focused: a blur would commit it.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setAssisting((on) => !on)}
        data-testid="onpage-assist-open"
      >
        ✨
      </button>
      {assisting && (
        <div ref={menu} onBlur={(e) => leaving(e) && finish(true)}>
          <Suspense fallback={null}>
            <AssistMenu
              assist={assist}
              anchor={ref}
              text={read}
              field={{ name: field.name, label: field.label, type: field.type }}
              docRef={docRef}
              path={path}
              locale={session.locale}
              onResult={applyAnswer}
              t={t}
            />
          </Suspense>
        </div>
      )}
    </>
  )
}
