/**
 * MetaImageField — Custom Payload CMS field component for meta image.
 *
 * Displays a status indicator for the meta image and an optional
 * "Generate" button that calls the plugin's generate endpoint to
 * auto-fill the image reference via user-provided generate functions.
 *
 * This component does NOT render the actual upload field — Payload
 * handles that natively. It adds the generate button UI alongside
 * the native upload field.
 */

'use client'

import React, { useCallback, useState } from 'react'
import { Banner, Button, CheckIcon, WarningIcon, useField, useDocumentInfo } from '@payloadcms/ui'
import { cx } from '../ui/index.js'
import { useDashboardT } from '../hooks/useSeoLocale.js'
import { withSeoErrorBoundary } from './withSeoErrorBoundary.js'
import { resolveMetaFieldOptions, type MetaFieldOptionProps } from './metaFieldOptions.js'
import './MetaField.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MetaImageFieldProps extends MetaFieldOptionProps {
  path: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function MetaImageFieldInner(props: MetaImageFieldProps) {
  const { path } = props
  const { hasGenerateFn, basePath } = resolveMetaFieldOptions(props)
  const t = useDashboardT()

  const { value, setValue } = useField<string | number | null>({ path })
  const { collectionSlug, globalSlug, id: docId } = useDocumentInfo()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const hasImage = value !== null && value !== undefined && value !== ''

  const handleGenerate = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const res = await fetch(`${basePath}/generate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'image',
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
        setSuccess(true)
        setTimeout(() => setSuccess(false), 3000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.networkError)
    } finally {
      setLoading(false)
    }
  }, [basePath, collectionSlug, globalSlug, docId, setValue])

  return (
    <div className="seo-meta-field">
      <div className="seo-meta-field__status">
        <div className="seo-meta-field__status-text">
          <span
            aria-hidden="true"
            className={cx('seo-meta-field__status-icon', `seo-meta-field__status-icon--${hasImage ? 'success' : 'warning'}`)}
          >
            {hasImage ? <CheckIcon /> : <WarningIcon />}
          </span>
          <div className="seo-stack seo-stack--tight">
            <span className="seo-text seo-text--small seo-text--strong">{t.metaImage.label}</span>
            <span className="seo-field__description">{hasImage ? t.metaImage.imageSet : t.metaImage.noImage}</span>
          </div>
        </div>

        {hasGenerateFn && (
          <Button
            buttonStyle="secondary"
            disabled={loading}
            icon={success ? <CheckIcon /> : undefined}
            onClick={handleGenerate}
            type="button"
          >
            {loading ? t.common.generating : success ? t.metaImage.set : t.common.generate}
          </Button>
        )}
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
export const MetaImageField = withSeoErrorBoundary(MetaImageFieldInner, { viewName: 'MetaImageField' })

export default MetaImageField
