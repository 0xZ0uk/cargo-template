/**
 * MetaDescriptionField — Custom Payload CMS field component for meta description.
 *
 * Adds a character counter (120-160 optimal range) with color indicator,
 * a progress bar, and an optional "Generate" button that calls the
 * plugin's generate endpoint to auto-fill the description via user-provided
 * generate functions.
 *
 * This component is registered as a custom Field component on the
 * `meta.description` field when the SEO Analyzer plugin creates meta fields.
 */

'use client'

import React, { useCallback, useState, useId } from 'react'
import { Banner, Button, useField, useDocumentInfo } from '@payloadcms/ui'
import { Meter, cx, rangeTone } from '../ui/index.js'
import { useDashboardT } from '../hooks/useSeoLocale.js'
import { withSeoErrorBoundary } from './withSeoErrorBoundary.js'
import { resolveMetaFieldOptions, type MetaFieldOptionProps } from './metaFieldOptions.js'
import './MetaField.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MetaDescriptionFieldProps extends MetaFieldOptionProps {
  path: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DESC_MIN = 120
const DESC_MAX = 160

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function MetaDescriptionFieldInner(props: MetaDescriptionFieldProps) {
  const { path } = props
  const { hasGenerateFn, basePath } = resolveMetaFieldOptions(props)
  const t = useDashboardT()
  // One instance per locale tab on a localized document: a literal id would
  // point every tab's label at the first tab's input.
  const fieldId = useId()

  const { value, setValue } = useField<string>({ path })
  const { collectionSlug, globalSlug, id: docId } = useDocumentInfo()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const charCount = (value || '').length
  const tone = rangeTone(charCount, DESC_MIN, DESC_MAX)

  const handleGenerate = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`${basePath}/generate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'description',
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
  }, [basePath, collectionSlug, globalSlug, docId, setValue])

  return (
    <div className="seo-meta-field">
      <div className="seo-meta-field__header">
        <label className="seo-field__label" htmlFor={fieldId}>
          {t.metaDescription.label}
        </label>
        <span className={cx('seo-meta-field__count', `seo-meta-field__count--${tone}`)}>
          {charCount} / {DESC_MAX} {t.metaDescription.characters}
        </span>
      </div>

      <div className="seo-meta-field__controls">
        <textarea
          id={fieldId}
          className="seo-textarea"
          value={value || ''}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t.metaDescription.placeholder}
          rows={3}
        />

        {hasGenerateFn && (
          <Button buttonStyle="secondary" disabled={loading} onClick={handleGenerate} type="button">
            {loading ? t.common.generating : t.common.generate}
          </Button>
        )}
      </div>

      <Meter aria-label={t.metaDescription.label} max={DESC_MAX} tone={tone} value={Math.min(charCount, DESC_MAX)} />

      <div className="seo-meta-field__footer seo-field__description">
        <span>
          {t.metaDescription.optimal} {DESC_MIN}-{DESC_MAX} {t.metaDescription.characters}
        </span>
        <span className={cx('seo-meta-field__count', `seo-meta-field__count--${tone}`)}>
          {charCount < DESC_MIN
            ? `${DESC_MIN - charCount} ${t.metaDescription.charactersMissing}`
            : charCount > DESC_MAX
              ? `${charCount - DESC_MAX} ${t.metaDescription.charactersTooMany}`
              : t.metaDescription.idealLength}
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
export const MetaDescriptionField = withSeoErrorBoundary(MetaDescriptionFieldInner, { viewName: 'MetaDescriptionField' })

export default MetaDescriptionField
