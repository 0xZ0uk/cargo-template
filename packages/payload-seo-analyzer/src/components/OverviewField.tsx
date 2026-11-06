/**
 * OverviewField — UI-only Payload CMS field that shows meta completeness.
 *
 * Displays three indicators (Title, Description, Image) with check/cross
 * status and a completeness progress bar (0/3 to 3/3). Uses Payload's
 * `useFormFields` hook to reactively read meta field values from the
 * current document form state.
 *
 * Intended for use in the editor sidebar as a quick glance overview.
 */

'use client'

import React, { useMemo } from 'react'
import { CheckIcon, XIcon, useFormFields } from '@payloadcms/ui'
import { Card, Meter, TonePill, type Tone } from '../ui/index.js'
import { useDashboardT } from '../hooks/useSeoAdmin.js'
import { withSeoErrorBoundary } from './withSeoErrorBoundary.js'
import './MetaField.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OverviewFieldProps {
  titlePath?: string
  descriptionPath?: string
  imagePath?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCompletenessTone(count: number): Tone {
  switch (count) {
    case 0:
      return 'danger'
    case 1:
    case 2:
      return 'warning'
    case 3:
      return 'success'
    default:
      return 'neutral'
  }
}

function getCompletenessLabel(count: number, ov: { incomplete: string; partial: string; almostComplete: string; complete: string }): string {
  switch (count) {
    case 0:
      return ov.incomplete
    case 1:
      return ov.partial
    case 2:
      return ov.almostComplete
    case 3:
      return ov.complete
    default:
      return ''
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function OverviewFieldInner({
  titlePath = 'meta.title',
  descriptionPath = 'meta.description',
  imagePath = 'meta.image',
}: OverviewFieldProps) {
  const t = useDashboardT()

  // Read all three meta field values reactively
  const formFields = useFormFields(([fields]) => ({
    title: fields[titlePath]?.value,
    description: fields[descriptionPath]?.value,
    image: fields[imagePath]?.value,
  }))

  const { hasTitle, hasDescription, hasImage, completedCount } = useMemo(() => {
    const title = formFields?.title
    const description = formFields?.description
    const image = formFields?.image

    const ht = typeof title === 'string' && title.trim().length > 0
    const hd = typeof description === 'string' && description.trim().length > 0
    const hi = image !== null && image !== undefined && image !== ''

    return {
      hasTitle: ht,
      hasDescription: hd,
      hasImage: hi,
      completedCount: (ht ? 1 : 0) + (hd ? 1 : 0) + (hi ? 1 : 0),
    }
  }, [formFields])

  const completenessTone = getCompletenessTone(completedCount)
  const completenessLabel = getCompletenessLabel(completedCount, t.overview)

  const indicators: Array<{ label: string; filled: boolean }> = [
    { label: t.overview.titleLabel, filled: hasTitle },
    { label: t.overview.descriptionLabel, filled: hasDescription },
    { label: t.overview.imageLabel, filled: hasImage },
  ]

  return (
    <Card
      actions={<TonePill tone={completenessTone}>{completedCount}/3</TonePill>}
      className="seo-overview"
      title={t.overview.metaCompleteness}
    >
      <Meter aria-label={t.overview.metaCompleteness} max={3} tone={completenessTone} value={completedCount} />

      <p className={`seo-text seo-text--small seo-text--${completenessTone === 'neutral' ? 'secondary' : completenessTone}`}>
        {completenessLabel}
      </p>

      <ul className="seo-overview__rows">
        {indicators.map((item) => (
          <li className="seo-overview__row" key={item.label}>
            <span className={`seo-meta-field__status-icon seo-meta-field__status-icon--${item.filled ? 'success' : 'warning'}`}>
              {item.filled ? <CheckIcon /> : <XIcon />}
            </span>
            <span className={item.filled ? 'seo-text seo-text--small' : 'seo-text seo-text--small seo-text--secondary'}>
              {item.label}
            </span>
            <span className="seo-overview__row-state">
              <TonePill tone={item.filled ? 'success' : 'neutral'}>{item.filled ? t.overview.set : t.overview.missing}</TonePill>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}


/**
 * Payload mounts this field from the import map on every edit screen, so the
 * boundary must live in this module — the plugin never owns the parent form.
 * A crash here degrades to a retryable notice instead of taking the whole
 * document editor down.
 */
export const OverviewField = withSeoErrorBoundary(OverviewFieldInner, { viewName: 'OverviewField' })

export default OverviewField
