'use client'

import React, { useEffect, useId, useState } from 'react'
import { Banner } from '@payloadcms/ui'
import { useDashboardT } from '../hooks/useSeoLocale.js'
import { usePayloadApi, useSeoApi, useSeoCollections } from '../hooks/useSeoApi.js'
import { SCHEMA_TYPES } from '../helpers/buildSchema.js'
import { Card, EmptyState, Field, LoadingState, TonePill } from '../ui/index.js'

/** How many documents the picker lists per search. */
const RESULT_LIMIT = 20
const SEARCH_DEBOUNCE_MS = 250

interface DocOption {
  id: string
  label: string
}

interface Generated {
  type: string
  jsonLd: unknown
  html?: string
  warnings: string[]
}

export interface SchemaPreviewProps {
  jsonString: string
  scriptTag: string
  /** Pill shown in the preview card's header. */
  badge: React.ReactNode
}

/**
 * The "generate from a page" half of the schema builder: pick a collection and a
 * document, optionally force a schema type, and show what `/schema-generator` returns
 * (the same JSON-LD the site renders) with its warnings. The preview itself is the
 * builder's, passed in so both modes share highlighting and copy buttons.
 */
export function SchemaFromPage({ renderPreview }: { renderPreview: (props: SchemaPreviewProps) => React.ReactNode }) {
  const t = useDashboardT()
  const uid = useId()
  const seoApi = useSeoApi()
  const payloadApi = usePayloadApi()
  const collections = useSeoCollections()

  const [collection, setCollection] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [docs, setDocs] = useState<DocOption[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [selected, setSelected] = useState<DocOption | null>(null)
  const [type, setType] = useState('')

  const [generated, setGenerated] = useState<Generated | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeCollection = collection || collections[0]?.slug || ''
  const searchFields = collections.find((c) => c.slug === activeCollection)?.searchFields ?? ['title', 'slug']

  // Debounce the search box into the query that drives the request.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  // Documents of the chosen collection, matching the search by title or slug.
  const searchKey = searchFields.join(',')
  useEffect(() => {
    if (!activeCollection) return
    const controller = new AbortController()
    const params = new URLSearchParams({ limit: String(RESULT_LIMIT), depth: '0', sort: '-updatedAt' })
    for (const field of ['title', 'slug']) params.set(`select[${field}]`, 'true')
    if (query) {
      searchKey
        .split(',')
        .filter(Boolean)
        .forEach((field, i) => params.set(`where[or][${i}][${field}][like]`, query))
    }
    setDocsLoading(true)
    setDocsError(null)
    fetch(payloadApi(`/${encodeURIComponent(activeCollection)}?${params.toString()}`), {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as { docs?: Array<Record<string, unknown>>; errors?: Array<{ message?: string }> }
        if (!res.ok) throw new Error(json.errors?.[0]?.message || `${t.schemaBuilder.documentsError} (${res.status})`)
        setDocs(
          (json.docs ?? []).map((doc) => ({
            id: String(doc.id),
            label: String(doc.title || doc.slug || doc.id),
          })),
        )
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setDocs([])
        setDocsError(err instanceof Error ? err.message : t.schemaBuilder.documentsError)
      })
      .finally(() => {
        if (!controller.signal.aborted) setDocsLoading(false)
      })
    return () => controller.abort()
  }, [activeCollection, query, searchKey, payloadApi, t])

  // The JSON-LD of the chosen document, regenerated when the document or type changes.
  const selectedId = selected?.id
  useEffect(() => {
    if (!selectedId || !activeCollection) {
      setGenerated(null)
      setError(null)
      setGenerating(false)
      return
    }
    const controller = new AbortController()
    const url = `/schema-generator?collection=${encodeURIComponent(activeCollection)}&id=${encodeURIComponent(selectedId)}${type ? `&type=${encodeURIComponent(type)}` : ''}`
    setGenerating(true)
    setError(null)
    fetch(seoApi(url), { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as Partial<Generated> & { error?: string }
        if (!res.ok) throw new Error(json.error || `${t.schemaBuilder.generateError} (${res.status})`)
        setGenerated({
          type: json.type ?? '',
          jsonLd: json.jsonLd ?? {},
          html: json.html,
          warnings: Array.isArray(json.warnings) ? json.warnings : [],
        })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setGenerated(null)
        setError(err instanceof Error ? err.message : t.schemaBuilder.generateError)
      })
      .finally(() => {
        if (!controller.signal.aborted) setGenerating(false)
      })
    return () => controller.abort()
  }, [activeCollection, selectedId, type, seoApi, t])

  const jsonString = generated ? JSON.stringify(generated.jsonLd, null, 2) : ''
  // The endpoint's own serialization is what the site renders; fall back to wrapping the JSON.
  const scriptTag = generated?.html ?? `<script type="application/ld+json">\n${jsonString}\n</script>`

  // The selected document stays listed even when a new search no longer matches it.
  const options = selected && !docs.some((d) => d.id === selected.id) ? [selected, ...docs] : docs

  return (
    <div className="seo-schema__layout">
      <Card title={t.schemaBuilder.pageMode}>
        <Field label={t.schemaBuilder.selectCollection}>
          <select
            className="seo-select"
            id={`${uid}-collection`}
            onChange={(e) => {
              setCollection(e.target.value)
              setSelected(null)
              // Drop the previous collection's results so none can be picked against the new one.
              setDocs([])
              setSearch('')
              setQuery('')
            }}
            value={activeCollection}
          >
            {collections.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.schemaBuilder.searchDocuments}>
          <input
            className="seo-input"
            id={`${uid}-search`}
            onChange={(e) => setSearch(e.target.value)}
            type="search"
            value={search}
          />
        </Field>
        <Field label={t.schemaBuilder.selectDocument}>
          <select
            className="seo-select"
            id={`${uid}-document`}
            onChange={(e) => setSelected(options.find((d) => d.id === e.target.value) ?? null)}
            value={selected?.id ?? ''}
          >
            <option value="">{docsLoading ? t.schemaBuilder.loadingDocuments : t.schemaBuilder.chooseDocument}</option>
            {options.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        {docsError ? <Banner type="danger">{docsError}</Banner> : null}
        {!docsLoading && !docsError && docs.length === 0 ? (
          <p className="seo-text seo-text--secondary">{t.schemaBuilder.noDocuments}</p>
        ) : null}
        <Field label={t.schemaBuilder.schemaTypeOverride}>
          <select className="seo-select" id={`${uid}-type`} onChange={(e) => setType(e.target.value)} value={type}>
            <option value="">{t.schemaBuilder.autoDetect}</option>
            {SCHEMA_TYPES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <div className="seo-schema__preview">
        {generating ? <LoadingState label={t.schemaBuilder.generating} /> : null}
        {error ? <Banner type="danger">{error}</Banner> : null}
        {!generating && generated ? (
          <>
            {renderPreview({
              jsonString,
              scriptTag,
              badge: (
                <TonePill tone="success">
                  {t.schemaBuilder.effectiveType}: {generated.type}
                </TonePill>
              ),
            })}
            {generated.warnings.map((warning) => (
              <Banner key={warning} type="warning">
                {warning}
              </Banner>
            ))}
          </>
        ) : null}
        {!generating && !generated && !error ? (
          <EmptyState title={t.schemaBuilder.generatedFromPage} description={t.schemaBuilder.pickDocumentHint} />
        ) : null}
      </div>
    </div>
  )
}
