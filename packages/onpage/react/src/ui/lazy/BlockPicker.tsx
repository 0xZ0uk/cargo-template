'use client'

import {
  cloneRow,
  fieldAtPath,
  insertItem,
  isReady,
  newBlockRow,
  previewRow,
  updateArray,
  type DataSource,
  type Doc,
  type EditorSession,
  type RefKey,
  type SavedSection,
  type SchemaBlock,
} from '@cargo/onpage-core'
import { useEffect, useRef, useState } from 'react'
import { insertRow } from '../../rowOps.ts'
import { useOnPage } from '../../context.tsx'
import type { TargetIndex } from '../../types.ts'
import { useEvent } from '../../useEvent.ts'
import { Dialog } from '../Dialog.tsx'

/** Wait this long on a card before previewing it, so sweeping across cards doesn't re-render each. */
const PREVIEW_DELAY = 100

/**
 * Choose a block type to insert at a position in a blocks field. Cards show
 * the block's thumbnail (Payload's `admin.images.thumbnail`), grouped by
 * `admin.group`. On a document rendered from editor state (client mode), the
 * picker is a side panel and the hovered or focused block is previewed in
 * place on the page, with its `example` content; nothing is saved until one is
 * chosen. A chosen block starts from its defaults, or from its example with
 * `insertExample`.
 */
export function BlockPicker() {
  const { panel, snap, isLive } = useOnPage()
  if (panel?.kind !== 'blocks') return null
  const state = snap.docs[panel.key]
  if (!isReady(state)) return null
  const field = fieldAtPath(state.schema.fields, state.doc, panel.listPath)?.field
  const blocks = field?.type === 'blocks' ? field.blocks : []
  // Keyed by insertion point, so a new picker always starts from the document as it is then.
  return (
    <Picker
      key={`${panel.key}|${panel.listPath}|${panel.index}`}
      docKey={panel.key}
      listPath={panel.listPath}
      index={panel.index}
      blocks={blocks}
      doc={state.doc}
      live={isLive(panel.key)}
    />
  )
}

function Picker({
  docKey,
  listPath,
  index,
  blocks,
  doc,
  live,
}: {
  docKey: RefKey
  listPath: string
  index: number
  blocks: SchemaBlock[]
  doc: Doc
  live: boolean
}) {
  const { session, snap, targets, setPanel, setSelected, t } = useOnPage()
  const preview = usePreview(session, targets, docKey, listPath, index, doc, live)
  const saved = useSavedSections(
    snap.docs[docKey]?.schema?.patterns ? session.dataSource : null,
    blocks,
  )
  /** A saved section as a new row: its content, with fresh row ids. */
  const savedRow = (p: SavedSection) => {
    const block = blocks.find((b) => b.slug === p.blockType)
    return block ? cloneRow({ ...p.data, blockType: block.slug }, block.fields) : null
  }
  const chooseSaved = (p: SavedSection) => {
    const row = savedRow(p)
    if (!row) return
    preview.revert()
    const next = insertRow(session, docKey, listPath, index, row)
    setPanel(null)
    setSelected(next)
  }

  const choose = (block: SchemaBlock) => {
    preview.revert()
    const row = block.insertExample ? previewRow(block) : newBlockRow(block)
    const next = insertRow(session, docKey, listPath, index, row)
    setPanel(null)
    setSelected(next)
  }

  return (
    <Dialog
      title={t('blocks.title')}
      onClose={() => setPanel(null)}
      t={t}
      variant={live ? 'panel' : 'modal'}
      width={640}
      testId="onpage-block-picker"
    >
      {live && <p className="po-blocks-hint">{t('blocks.previewHint')}</p>}
      {groupBlocks(blocks).map(({ group, items }, g) => (
        <section
          key={group ?? ''}
          className={`po-blocks-group${group === undefined && g > 0 ? ' is-ungrouped' : ''}`}
        >
          {group && <h3 className="po-h4">{group}</h3>}
          <div className={`po-blocks${live ? ' is-narrow' : ''}`}>
            {items.map((b, i) => (
              <BlockCard
                key={b.slug}
                block={b}
                first={g === 0 && i === 0}
                previewing={preview.shown === b.slug}
                onChoose={() => choose(b)}
                onPreview={
                  live ? (via) => preview.show(b.slug, () => previewRow(b), via) : undefined
                }
                onKey={preview.arm}
              />
            ))}
          </div>
        </section>
      ))}
      {saved.length > 0 && (
        <section className="po-blocks-group" data-testid="onpage-saved-sections">
          <h3 className="po-h4">{t('blocks.saved')}</h3>
          <div className={`po-blocks${live ? ' is-narrow' : ''}`}>
            {saved.map((p) => {
              const block = blocks.find((b) => b.slug === p.blockType)
              const id = `saved:${String(p.id)}`
              return (
                <button
                  key={id}
                  type="button"
                  className={`po-block-card${preview.shown === id ? ' is-previewing' : ''}`}
                  onClick={() => chooseSaved(p)}
                  onPointerEnter={
                    live ? () => preview.show(id, () => savedRow(p), 'pointer') : undefined
                  }
                  onFocus={live ? () => preview.show(id, () => savedRow(p), 'focus') : undefined}
                  onKeyDown={preview.arm}
                  data-testid={`onpage-saved-${String(p.id)}`}
                >
                  {block?.thumbnail ? (
                    <img src={block.thumbnail.url} alt="" loading="lazy" />
                  ) : (
                    <span className="po-block-thumb" aria-hidden="true">
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="po-block-label">
                    {p.name}
                    {block && <small> · {block.labels.singular}</small>}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}
    </Dialog>
  )
}

/** The saved sections this list accepts (none without saved sections on). */
function useSavedSections(ds: DataSource | null, blocks: SchemaBlock[]): SavedSection[] {
  const [list, setList] = useState<SavedSection[]>([])
  const slugs = blocks.map((b) => b.slug).join(',')
  useEffect(() => {
    if (!ds?.listPatterns || !slugs) return
    let live = true
    ds.listPatterns({ blocks: slugs.split(',') }).then(
      (p) => live && setList(p),
      () => undefined, // saved sections are extra: the picker works without them
    )
    return () => {
      live = false
    }
  }, [ds, slugs])
  return list
}

function BlockCard({
  block,
  first,
  previewing,
  onChoose,
  onPreview,
  onKey,
}: {
  block: SchemaBlock
  /** Gets focus when the picker opens. */
  first: boolean
  /** This block is the one shown on the page. */
  previewing: boolean
  onChoose: () => void
  onPreview?: ((via: 'pointer' | 'focus') => void) | undefined
  onKey: () => void
}) {
  const name = block.labels.singular
  return (
    <button
      type="button"
      className={`po-block-card${previewing ? ' is-previewing' : ''}`}
      onClick={onChoose}
      onPointerEnter={onPreview && (() => onPreview('pointer'))}
      onFocus={onPreview && (() => onPreview('focus'))}
      onKeyDown={onKey}
      {...(first ? { 'data-autofocus': '' } : {})}
      data-testid={`onpage-block-${block.slug}`}
    >
      {block.thumbnail ? (
        // The card's label names it; alt adds what the image shows, if the config says.
        <img src={block.thumbnail.url} alt={block.thumbnail.alt ?? ''} loading="lazy" />
      ) : (
        <span className="po-block-thumb" aria-hidden="true">
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="po-block-label">{name}</span>
    </button>
  )
}

/** Blocks in config order, grouped by `group`; ungrouped blocks last (as in Payload's block drawer). */
export function groupBlocks(
  blocks: SchemaBlock[],
): Array<{ group: string | undefined; items: SchemaBlock[] }> {
  const out: Array<{ group: string | undefined; items: SchemaBlock[] }> = []
  for (const b of blocks) {
    const g = out.find((x) => x.group === b.group)
    if (g) g.items.push(b)
    else out.push({ group: b.group, items: [b] })
  }
  return out.sort((a, b) => Number(a.group === undefined) - Number(b.group === undefined))
}

/**
 * The live preview: shows a block at the insertion point as a transient edit
 * (no history, no save). Reverting restores the document as it was when the
 * picker opened, rather than cancelling every transient change, so text an
 * editor was still typing elsewhere in the document is kept.
 *
 * The first card gets focus when the picker opens; that focus doesn't preview.
 * Keyboard focus previews once the editor has pressed a key in the picker.
 */
function usePreview(
  session: EditorSession,
  targets: TargetIndex,
  key: RefKey,
  listPath: string,
  index: number,
  base: Doc,
  live: boolean,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const shown = useRef<string | null>(null)
  const [shownSlug, setShownSlug] = useState<string | null>(null)
  const keyed = useRef(false)
  const scrollTo = useRef(false)
  // The document when the picker opened; fixed for the picker's life (it's keyed by insertion point).
  const [initial] = useState(base)

  const revert = useEvent(() => {
    clearTimeout(timer.current)
    if (shown.current === null) return
    shown.current = null
    setShownSlug(null)
    session.apply(key, () => initial, { transient: true })
  })

  /** Show a row on the page: `id` names the card (a block slug, or a saved section). */
  const show = (id: string, makeRow: () => unknown, via: 'pointer' | 'focus') => {
    if (via === 'focus' && !keyed.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (shown.current === id) return
      shown.current = id
      setShownSlug(id)
      scrollTo.current = true
      const row = makeRow()
      session.apply(key, () => updateArray(initial, listPath, (a) => insertItem(a, index, row)), {
        transient: true,
      })
    }, PREVIEW_DELAY)
  }

  // Bring the previewed section into view once the page has rendered it.
  useEffect(() => {
    if (!live || !scrollTo.current) return
    const el = targets.find(key, `${listPath}.${index}`, ['item'])?.el
    if (!el) return
    scrollTo.current = false
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }, [live, targets, key, listPath, index])

  // However the picker closes (choice, Escape, ✕, a click on the page), the preview goes.
  useEffect(() => revert, [revert])

  const arm = () => {
    keyed.current = true
  }

  return { show, revert, arm, shown: shownSlug }
}
