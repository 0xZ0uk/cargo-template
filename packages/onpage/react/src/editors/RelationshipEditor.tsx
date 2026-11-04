'use client'

/**
 * Relationship editor: search the related collection(s) by their title field
 * (Payload REST, so access control applies) and pick one, or several for
 * hasMany. Polymorphic fields get a collection switch and store `{ relationTo, value }`.
 */
import {
  asList,
  relationId,
  relationTitle,
  type RelationField,
  type SearchHit,
} from '@cargo/onpage-core'
import { useCallback, useState } from 'react'
import { useOnPage } from '../context.tsx'
import type { FieldEditorProps } from '../types.ts'
import { EditorPopover } from './kit.tsx'
import { useDebouncedSearch } from './useDebouncedSearch.ts'
import { CloseIcon } from '../icons.tsx'

export function RelationshipEditor(props: FieldEditorProps<RelationField>) {
  const { docKey, field, value, commit, close, t } = props
  const { session, snap } = useOnPage()
  const targets = Array.isArray(field.relationTo) ? field.relationTo : [field.relationTo]
  const poly = Array.isArray(field.relationTo)
  const [collection, setCollection] = useState(targets[0] ?? '')
  const relations = snap.docs[docKey]?.schema?.relations ?? {}
  const titleField = relations[collection]?.titleField
  const many = !!field.hasMany
  const current = asList(value, many)
  const ds = session.dataSource
  const search = useCallback(
    async (query: string, _page: number, signal: AbortSignal) =>
      ds.search
        ? {
            items: await ds.search(collection, {
              query,
              titleField,
              locale: session.locale,
              limit: 12,
              signal,
            }),
            hasMore: false,
          }
        : { items: [] as SearchHit[], hasMore: false },
    [ds, collection, titleField, session.locale],
  )
  const results = useDebouncedSearch<SearchHit>(ds.search ? search : null)

  const wrap = (hit: SearchHit): unknown =>
    poly ? { relationTo: collection, value: hit.doc } : hit.doc
  const same = (v: unknown, id: string | number) => String(relationId(v)) === String(id)
  const pick = (hit: SearchHit) => {
    if (!many) {
      commit(wrap(hit))
      close()
      return
    }
    commit(
      current.some((v) => same(v, hit.id))
        ? current.filter((v) => !same(v, hit.id))
        : [...current, wrap(hit)],
    )
  }
  const remove = (i: number) => commit(many ? current.filter((_, j) => j !== i) : null)

  return (
    <EditorPopover props={props} testId="onpage-relationship" width={320}>
      {current.map((v, i) => (
        <div className="po-rel-item" key={`${String(relationId(v))}-${i}`}>
          {relationTitle(v, titleField)}
          {(!field.required || many) && (
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={t('common.removeItem', { item: relationTitle(v, titleField) })}
            >
              <CloseIcon />
            </button>
          )}
        </div>
      ))}
      {poly && (
        <div className="po-seg" role="radiogroup" aria-label={field.label}>
          {targets.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === collection}
              onClick={() => setCollection(c)}
            >
              {relations[c]?.label ?? c}
            </button>
          ))}
        </div>
      )}
      {!ds.search ? (
        <p className="po-muted">{t('search.unsupported')}</p>
      ) : (
        <>
          <input
            className="po-input"
            aria-label={t('search.placeholder')}
            placeholder={t('search.placeholder')}
            value={results.query}
            data-autofocus
            onChange={(e) => results.setQuery(e.target.value)}
            data-testid="onpage-relationship-search"
          />
          {results.error && <p className="po-error">{results.error}</p>}
          <div
            className="po-pop-list"
            role="listbox"
            aria-multiselectable={many}
            aria-label={field.label}
          >
            {results.items.map((h) => (
              <button
                key={String(h.id)}
                type="button"
                role="option"
                aria-selected={current.some((v) => same(v, h.id))}
                onClick={() => pick(h)}
                data-testid={`onpage-relationship-${h.id}`}
              >
                {h.title}
              </button>
            ))}
          </div>
        </>
      )}
    </EditorPopover>
  )
}
