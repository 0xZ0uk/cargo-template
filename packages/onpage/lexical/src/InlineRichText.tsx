'use client'

/**
 * In-place rich-text editing with Lexical. The editable surface is laid over
 * the rendered element, takes its classes (so the site's prose styles apply)
 * and hides the original. Clicking outside, or "Done", commits; Escape cancels.
 * Only a real change is written: the value is compared with what the same
 * editor produced for the untouched content.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
  type HeadingTagType,
} from '@lexical/rich-text'
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  type ListType,
} from '@lexical/list'
import { $setBlocksType } from '@lexical/selection'
import { $findMatchingParent } from '@lexical/utils'
import {
  $createParagraphNode,
  $createRangeSelectionFromDom,
  $getNearestNodeFromDOMNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  FORMAT_TEXT_COMMAND,
  type BaseSelection,
  REDO_COMMAND,
  UNDO_COMMAND,
  type LexicalEditor,
} from 'lexical'
import { newRowId, safeLinkUrl, type RefKey, type ScalarField } from '@cargo/onpage-core'
import {
  HIDDEN,
  caretAt,
  copyTypography,
  placeOver,
  typographyOf,
  useEvent,
  useOnPageOptional,
  useTrackElement,
  type FieldEditorProps,
  type Translate,
  RedoIcon,
  UndoIcon,
} from '@cargo/onpage-react/editor-kit'
import { LinkPicker, type InternalLink } from './LinkPicker.tsx'
import {
  $createPayloadLinkNode,
  $isPayloadLinkNode,
  type PayloadLinkFields,
  type PayloadLinkNode,
} from './nodes.tsx'
import { RICH_TEXT_NODES } from './nodeList.ts'
import { fromEditorState, hasOpaque, plainText, toEditorState } from './convert.ts'

export { RICH_TEXT_NODES }

/** The block the selection is in, as the toolbar shows it. */
type BlockKind = 'paragraph' | 'quote' | HeadingTagType | `list-${ListType}`

interface ToolbarState {
  bold: boolean
  italic: boolean
  underline: boolean
  block: BlockKind
  link: boolean
}

const EMPTY_TOOLBAR: ToolbarState = {
  bold: false,
  italic: false,
  underline: false,
  block: 'paragraph',
  link: false,
}

function readToolbarState(): ToolbarState {
  const sel = $getSelection()
  if (!$isRangeSelection(sel)) return EMPTY_TOOLBAR
  const anchor = sel.anchor.getNode()
  const top = anchor.getKey() === 'root' ? anchor : anchor.getTopLevelElementOrThrow()
  const list = $findMatchingParent(anchor, $isListNode)
  const block: BlockKind = list
    ? `list-${list.getListType()}`
    : $isHeadingNode(top)
      ? top.getTag()
      : $isQuoteNode(top)
        ? 'quote'
        : 'paragraph'
  return {
    bold: sel.hasFormat('bold'),
    italic: sel.hasFormat('italic'),
    underline: sel.hasFormat('underline'),
    block,
    link: !!$findMatchingParent(anchor, $isPayloadLinkNode),
  }
}

/**
 * Pull the browser's current selection into Lexical. Keyboard-extended
 * selections (⌥⇧→ and friends) don't always reach Lexical's model before a
 * toolbar click, so every toolbar action syncs first and acts on what the user
 * actually sees selected.
 */
function syncSelection(editor: LexicalEditor) {
  const dom = window.getSelection()
  const root = editor.getRootElement()
  if (!dom || !root || !dom.anchorNode || !root.contains(dom.anchorNode)) return
  editor.update(
    () => {
      const sel = $createRangeSelectionFromDom(dom, editor)
      if (sel) $setSelection(sel)
    },
    { discrete: true },
  )
}

/** The URL of the link around the selection, if any. */
function currentLinkUrl(editor: LexicalEditor): string | undefined {
  let url: string | undefined
  editor.getEditorState().read(() => {
    const sel = $getSelection()
    if ($isRangeSelection(sel))
      url = $findMatchingParent(sel.anchor.getNode(), $isPayloadLinkNode)?.getFields().url
  })
  return url
}

/**
 * Link the selection to `url`; an empty url removes the link around it. Returns
 * false (and changes nothing) for an unsafe URL such as `javascript:`.
 */
function applyLink(editor: LexicalEditor, rawUrl: string, saved: BaseSelection | null): boolean {
  const url = rawUrl.trim()
  if (url && !safeLinkUrl(url)) return false
  setLink(editor, url ? { url, newTab: /^https?:/.test(url), linkType: 'custom' } : null, saved)
  return true
}

/** Link the selection to a page of the site, as Payload stores it: `linkType: 'internal'` and `doc`. */
function applyInternalLink(editor: LexicalEditor, link: InternalLink, saved: BaseSelection | null) {
  setLink(
    editor,
    {
      linkType: 'internal',
      doc: { relationTo: link.relationTo, value: link.value },
      newTab: false,
    },
    saved,
  )
}

/** Set (or with null, remove) the link around the selection. */
function setLink(
  editor: LexicalEditor,
  fields: PayloadLinkFields | null,
  saved: BaseSelection | null,
) {
  editor.update(() => {
    // Focus moved to the URL field; put back the selection it was opened for.
    if (saved) $setSelection(saved.clone())
    const sel = $getSelection()
    if (!$isRangeSelection(sel)) return
    const nodes = sel.extract()
    const existing = nodes
      .map((n) => $findMatchingParent(n, $isPayloadLinkNode))
      .find((n): n is PayloadLinkNode => n !== null)
    if (existing) {
      if (!fields) {
        for (const child of existing.getChildren()) existing.insertBefore(child)
        existing.remove()
      } else {
        // Switching kinds drops the other kind's target (no stale url on a page link, or doc on a URL).
        const { url: _u, doc: _d, ...rest } = existing.getFields()
        existing.setFields({ ...rest, ...fields })
      }
      return
    }
    if (!fields) return
    let link: PayloadLinkNode | null = null
    for (const node of nodes) {
      if (!$isTextNode(node) || $findMatchingParent(node, $isPayloadLinkNode)) continue
      if (!link || node.getPreviousSibling() !== link) {
        // Payload's own link node carries an id; so do ours.
        link = $createPayloadLinkNode({ ...fields }, newRowId())
        node.insertBefore(link)
      }
      link.append(node)
    }
  })
}

/** A toolbar button that keeps the editor's selection (and syncs a keyboard selection first). */
function ToolButton({
  label,
  title,
  pressed = false,
  onAction,
  id,
}: {
  label: React.ReactNode
  title: string
  pressed?: boolean
  onAction: () => void
  id: string
}) {
  const [editor] = useLexicalComposerContext()
  return (
    <button
      type="button"
      className="po-btn"
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      data-testid={`onpage-rt-${id}`}
      onMouseDown={(e) => e.preventDefault() /* keep the editor's selection */}
      onClick={() => {
        syncSelection(editor)
        onAction()
      }}
    >
      {label}
    </button>
  )
}

function Toolbar({ onDone, t, docKey }: { onDone: () => void; t: Translate; docKey: RefKey }) {
  const [editor] = useLexicalComposerContext()
  const [state, setState] = useState<ToolbarState>(EMPTY_TOOLBAR)
  const [linkDraft, setLinkDraft] = useState<string | null>(null)
  const [linkMode, setLinkMode] = useState<'url' | 'page'>('url')
  // Optional: the editor also runs outside an OnPageEditor (tests, custom hosts).
  const api = useOnPageOptional()
  const canLinkPages = !!api?.session.getSnapshot().docs[docKey]?.schema?.linkTargets?.length
  const savedSelection = useRef<BaseSelection | null>(null)
  const [linkError, setLinkError] = useState(false)
  const openLink = () => {
    editor.getEditorState().read(() => {
      savedSelection.current = $getSelection()?.clone() ?? null
    })
    setLinkDraft(currentLinkUrl(editor) ?? 'https://')
  }
  const saveLink = () => {
    if (linkDraft === null) return
    if (!applyLink(editor, linkDraft === 'https://' ? '' : linkDraft, savedSelection.current)) {
      setLinkError(true)
      return
    }
    setLinkError(false)
    setLinkDraft(null)
    editor.focus()
  }
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) =>
        editorState.read(() => setState(readToolbarState())),
      ),
    [editor],
  )

  const setBlock = (kind: 'paragraph' | 'h2' | 'h3' | 'quote') =>
    editor.update(() => {
      const sel = $getSelection()
      if (!$isRangeSelection(sel)) return
      const target = state.block === kind ? 'paragraph' : kind
      $setBlocksType(sel, () =>
        target === 'paragraph'
          ? $createParagraphNode()
          : target === 'quote'
            ? $createQuoteNode()
            : $createHeadingNode(target),
      )
    })
  const list = (type: 'bullet' | 'number') => {
    if (state.block === `list-${type}`) editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined)
    else
      editor.dispatchCommand(
        type === 'bullet' ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND,
        undefined,
      )
  }
  return (
    <div className="po-rt-toolbar" role="toolbar" aria-label={t('rt.toolbar')}>
      <ToolButton
        label={<b>B</b>}
        title={t('rt.bold')}
        pressed={state.bold}
        onAction={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
        id="bold"
      />
      <ToolButton
        label={<i>I</i>}
        title={t('rt.italic')}
        pressed={state.italic}
        onAction={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
        id="italic"
      />
      <ToolButton
        label={<u>U</u>}
        title={t('rt.underline')}
        pressed={state.underline}
        onAction={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}
        id="underline"
      />
      <ToolButton
        label="🔗"
        title={t('rt.link')}
        pressed={state.link}
        onAction={openLink}
        id="link"
      />
      <ToolButton
        label="H2"
        title={t('rt.h2')}
        pressed={state.block === 'h2'}
        onAction={() => setBlock('h2')}
        id="h2"
      />
      <ToolButton
        label="H3"
        title={t('rt.h3')}
        pressed={state.block === 'h3'}
        onAction={() => setBlock('h3')}
        id="h3"
      />
      <ToolButton
        label="•"
        title={t('rt.ul')}
        pressed={state.block === 'list-bullet'}
        onAction={() => list('bullet')}
        id="ul"
      />
      <ToolButton
        label="1."
        title={t('rt.ol')}
        pressed={state.block === 'list-number'}
        onAction={() => list('number')}
        id="ol"
      />
      <ToolButton
        label="❝"
        title={t('rt.quote')}
        pressed={state.block === 'quote'}
        onAction={() => setBlock('quote')}
        id="quote"
      />
      <ToolButton
        label={<UndoIcon />}
        title={t('dock.undo')}
        onAction={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
        id="undo"
      />
      <ToolButton
        label={<RedoIcon />}
        title={t('dock.redo')}
        onAction={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
        id="redo"
      />
      <ToolButton label={t('rt.done')} title={t('rt.done')} onAction={onDone} id="done" />
      {linkDraft !== null && (
        <span style={{ display: 'inline-flex', gap: 4, marginLeft: 6, alignItems: 'center' }}>
          {canLinkPages && (
            <span className="po-seg" role="radiogroup" aria-label={t('rt.link')}>
              {(['url', 'page'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={linkMode === m}
                  className={`po-btn${linkMode === m ? ' is-on' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setLinkMode(m)}
                  data-testid={`onpage-rt-link-mode-${m}`}
                >
                  {t(m === 'url' ? 'rt.linkUrl' : 'rt.linkPage')}
                </button>
              ))}
            </span>
          )}
          {linkMode === 'page' && canLinkPages ? (
            <LinkPicker
              docKey={docKey}
              t={t}
              onPick={(link) => {
                applyInternalLink(editor, link, savedSelection.current)
                setLinkDraft(null)
                editor.focus()
              }}
            />
          ) : (
            <>
              <input
                className="po-input"
                style={{ width: 260, height: 28 }}
                value={linkDraft}
                aria-invalid={linkError || undefined}
                title={linkError ? t('rt.linkInvalid') : undefined}
                ref={(el) => el?.focus()}
                placeholder={t('rt.linkPlaceholder')}
                onChange={(e) => setLinkDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    saveLink()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    e.stopPropagation()
                    setLinkDraft(null)
                  }
                }}
                data-testid="onpage-rt-link-input"
              />
              <button
                type="button"
                className="po-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={saveLink}
                data-testid="onpage-rt-link-apply"
              >
                {t('rt.linkApply')}
              </button>
            </>
          )}
        </span>
      )}
    </div>
  )
}

/**
 * Grabs the editor instance and puts the caret where the user clicked —
 * through Lexical's own selection (setting only the DOM selection leaves
 * Lexical's model at the end of the text, so keys and toolbar act there).
 */
function Bridge({
  onReady,
  point,
}: {
  onReady: (editor: LexicalEditor) => void
  point?: { x: number; y: number } | undefined
}) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    onReady(editor)
    const root = editor.getRootElement()
    if (!root) return
    // Wait two frames so the surface sits exactly over the original text.
    let raf = requestAnimationFrame(
      () =>
        (raf = requestAnimationFrame(() => {
          const hit = point ? caretAt(point, root) : null
          // Focus first: Lexical may restore its own selection on focus, which would
          // undo the caret placement if it came before.
          root.focus({ preventScroll: true })
          editor.update(
            () => {
              const node = hit ? $getNearestNodeFromDOMNode(hit.node) : null
              if (hit && $isTextNode(node)) node.select(hit.offset, hit.offset)
              else $getRoot().selectEnd()
            },
            { discrete: true },
          )
        })),
    )
    return () => cancelAnimationFrame(raf)
  }, [editor, onReady, point])
  return null
}

export function InlineRichText({
  docKey,
  field,
  value,
  element,
  commit,
  close,
  ghost,
  live,
  point,
  t,
}: FieldEditorProps<ScalarField>) {
  const box = useRef<HTMLDivElement>(null)
  const editorRef = useRef<LexicalEditor | null>(null)
  const baseline = useRef<string | null>(null)
  const done = useRef(false)
  // The surface takes the element's classes, so the site's prose styles apply.
  const [className] = useState(() => {
    const cls = element()?.className
    return typeof cls === 'string' ? cls : ''
  })
  const onReady = useCallback((editor: LexicalEditor) => {
    editorRef.current = editor
    baseline.current = JSON.stringify(editor.getEditorState().toJSON())
  }, [])
  const initialState = useMemo(() => JSON.stringify(toEditorState(value)), []) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = element()
    if (el) {
      // Position before first paint, so the caret hit-test finds the surface.
      if (box.current) {
        placeOver(box.current, el)
        // Inherit the element's typography (not the UI layer's 13px), so the
        // surface lays out exactly over the original and the click point maps
        // to the right block.
        const surface = box.current.querySelector('.po-rt-surface')
        if (surface instanceof HTMLElement) copyTypography(el, surface)
      }
      el.setAttribute(HIDDEN, 'true')
    }
    return () => element()?.removeAttribute(HIDDEN)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow the original element's box as the page scrolls and reflows.
  useTrackElement(element, (el) => {
    if (!box.current) return
    if (!el.hasAttribute(HIDDEN)) el.setAttribute(HIDDEN, 'true')
    placeOver(box.current, el)
  })

  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    const editor = editorRef.current
    if (save && editor) {
      const json = editor.getEditorState().toJSON()
      if (JSON.stringify(json) !== baseline.current) {
        const next = fromEditorState(json)
        commit(plainText(next) || hasOpaque(next) ? next : null)
        const surface = editor.getRootElement()
        if (!live && surface)
          ghost({ html: surface.innerHTML, className, style: typographyOf(surface) })
      }
    }
    close()
  }

  // Commit when the user clicks anywhere outside the editor.
  // Escape (inside the editor) cancels.
  const onOutside = useEvent((e: PointerEvent) => {
    if (box.current && !box.current.contains(e.target as Node)) finish(true)
  })
  const onEscape = useEvent((e: KeyboardEvent) => {
    if (e.key === 'Escape' && box.current?.contains(document.activeElement)) {
      e.preventDefault()
      finish(false)
    }
  })
  useEffect(() => {
    const onDown = (e: PointerEvent) => onOutside(e)
    const onKey = (e: KeyboardEvent) => onEscape(e)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [onEscape, onOutside])

  return (
    <div
      ref={box}
      className="po-rt"
      role="group"
      aria-label={t('inline.label', { field: field.label })}
      data-testid="onpage-inline-richtext"
    >
      <LexicalComposer
        initialConfig={{
          namespace: 'payload-onpage',
          nodes: RICH_TEXT_NODES,
          editorState: initialState,
          onError: (error) => console.error('[payload-onpage] rich text', error),
          theme: { text: { bold: 'po-b', italic: 'po-i', underline: 'po-u' } },
        }}
      >
        <Toolbar onDone={() => finish(true)} t={t} docKey={docKey} />
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className={`${className} po-rt-surface`}
              aria-label={t('inline.label', { field: field.label })}
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <Bridge onReady={onReady} point={point} />
      </LexicalComposer>
    </div>
  )
}
