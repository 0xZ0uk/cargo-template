'use client'

/**
 * Pick a page of the site for a rich-text link: search the collections the
 * schema lists as link targets (`linkTargets`), through the data source.
 */
import type { RefKey, SearchHit } from '@cargo/onpage-core'
import { useOnPage, useDebouncedSearch, type Translate } from '@cargo/onpage-react/editor-kit'
import { useCallback, useState } from 'react'

export interface InternalLink {
  relationTo: string
  value: string | number
  title: string
}

export function LinkPicker({
  docKey,
  onPick,
  t,
}: {
  docKey: RefKey
  onPick: (link: InternalLink) => void
  t: Translate
}) {
  const { session, snap } = useOnPage()
  const schema = snap.docs[docKey]?.schema
  const targets = schema?.linkTargets ?? []
  const [collection, setCollection] = useState(targets[0] ?? '')
  const titleField = schema?.relations?.[collection]?.titleField
  const ds = session.dataSource
  const search = useCallback(
    async (query: string, _page: number, signal: AbortSignal) => ({
      items: ds.search
        ? await ds.search(collection, {
            query,
            titleField,
            locale: session.locale,
            limit: 8,
            signal,
          })
        : [],
      hasMore: false,
    }),
    [ds, collection, titleField, session.locale],
  )
  const results = useDebouncedSearch<SearchHit>(ds.search && collection ? search : null)
  return (
    <span className="po-rt-pages" data-testid="onpage-rt-link-pages">
      {targets.length > 1 && (
        <select
          className="po-select"
          aria-label={t('rt.linkCollection')}
          value={collection}
          onChange={(e) => setCollection(e.target.value)}
        >
          {targets.map((slug) => (
            <option key={slug} value={slug}>
              {schema?.relations?.[slug]?.label ?? slug}
            </option>
          ))}
        </select>
      )}
      <input
        className="po-input"
        style={{ width: 200, height: 28 }}
        aria-label={t('rt.linkSearch')}
        placeholder={t('rt.linkSearch')}
        value={results.query}
        ref={(el) => el?.focus()}
        onChange={(e) => results.setQuery(e.target.value)}
        data-testid="onpage-rt-link-search"
      />
      <span className="po-rt-hits" role="listbox" aria-label={t('rt.linkSearch')}>
        {results.items.map((hit) => (
          <button
            key={String(hit.id)}
            type="button"
            role="option"
            aria-selected={false}
            className="po-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick({ relationTo: collection, value: hit.id, title: hit.title })}
            data-testid={`onpage-rt-link-hit-${hit.id}`}
          >
            {hit.title}
          </button>
        ))}
      </span>
    </span>
  )
}
