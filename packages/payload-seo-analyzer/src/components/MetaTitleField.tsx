/**
 * MetaTitleField — Custom Payload CMS field component for meta title.
 *
 * Adds a character counter (optimal range from the thresholds, 30-60 by default) with color indicator,
 * a progress bar, and an optional "Generate" button that calls the
 * plugin's generate endpoint to auto-fill the title via user-provided
 * generate functions.
 *
 * This component is registered as a custom Field component on the
 * `meta.title` field when the SEO Analyzer plugin creates meta fields.
 */

'use client'

import React, { useCallback, useState, useId } from 'react'
import { Banner, Button, useField, useDocumentInfo } from '@payloadcms/ui'
import { Meter, cx, rangeTone } from '../ui/index.js'
import { useDashboardT } from '../hooks/useSeoAdmin.js'
import { withSeoErrorBoundary } from './withSeoErrorBoundary.js'
import { resolveMetaFieldOptions, type MetaFieldOptionProps } from './metaFieldOptions.js'
import { useSeoApi } from '../hooks/useSeoApi.js'
import { useResolvedThresholds } from '../hooks/useSeoThresholds.js'
import './MetaField.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MetaTitleFieldProps extends MetaFieldOptionProps {
  path: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function MetaTitleFieldInner(props: MetaTitleFieldProps) {
  const { path } = props
  const { hasGenerateFn, basePath } = resolveMetaFieldOptions(props)
  const seoApi = useSeoApi()
  const generateUrl = basePath ? `${basePath}/generate` : seoApi('/generate')
  const t = useDashboardT()
  // The same limits the title rule checks against (custom range or defaults).
  const { titleLengthMin: TITLE_MIN, titleLengthMax: TITLE_MAX } = useResolvedThresholds()
  // One instance per locale tab on a localized document: a literal id would
  // point every tab's label at the first tab's input.
  const fieldId = useId()

  const { value, setValue } = useField<string>({ path })
  const { collectionSlug, globalSlug, id: docId } = useDocumentInfo()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const charCount = (value || '').length
  const tone = rangeTone(charCount, TITLE_MIN, TITLE_MAX)

  const handleGenerate = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(generateUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'title',
          collectionSlug: collectionSlug || undefined,
          globalSlug: globalSlug || undefined,
          docId: docId || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: t.common.serverError }))
        setError(data.error || `${t.common.serverError} ${res.status}`)
        return
      }

      const data = await res.json()
      if (data.result !== undefined) {
        setValue(data.result)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.networkError)
    } finally {
      setLoading(false)
    }
  }, [generateUrl, collectionSlug, globalSlug, docId, setValue])

  return (
    <div className="seo-meta-field">
      <div className="seo-meta-field__header">
        <label className="seo-field__label" htmlFor={fieldId}>
          {t.metaTitle.label}
        </label>
        <span className={cx('seo-meta-field__count', `seo-meta-field__count--${tone}`)}>
          {charCount} / {TITLE_MAX} {t.metaTitle.characters}
        </span>
      </div>

      <div className="seo-meta-field__controls">
        <input
          id={fieldId}
          type="text"
          className="seo-input"
          value={value || ''}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t.metaTitle.placeholder}
        />

        {hasGenerateFn && (
          <Button buttonStyle="secondary" disabled={loading} onClick={handleGenerate} type="button">
            {loading ? t.common.generating : t.common.generate}
          </Button>
        )}
      </div>

      <Meter aria-label={t.metaTitle.label} max={TITLE_MAX} tone={tone} value={Math.min(charCount, TITLE_MAX)} />

      <div className="seo-meta-field__footer seo-field__description">
        <span>
          {t.metaTitle.optimal} {TITLE_MIN}-{TITLE_MAX} {t.metaTitle.characters}
        </span>
        <span className={cx('seo-meta-field__count', `seo-meta-field__count--${tone}`)}>
          {charCount < TITLE_MIN
            ? `${TITLE_MIN - charCount} ${t.metaTitle.charactersMissing}`
            : charCount > TITLE_MAX
              ? `${charCount - TITLE_MAX} ${t.metaTitle.charactersTooMany}`
              : t.metaTitle.idealLength}
        </span>
      </div>

      {error && <Banner type="danger">{error}</Banner>}
    </div>
  )
}


/**
 * Payload mounts this field from the import map on every edit screen, so the
 * boundary must live in this module — the plugin never owns the parent form.
 * A crash here degrades to a retryable notice instead of taking the whole
 * document editor down.
 */
export const MetaTitleField = withSeoErrorBoundary(MetaTitleFieldInner, { viewName: 'MetaTitleField' })

export default MetaTitleField
