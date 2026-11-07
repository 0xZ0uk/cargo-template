'use client'

import React, { useState } from 'react'
import { Button, Collapsible, SearchIcon } from '@payloadcms/ui'
import { cx, rangeTone, type Tone } from '../ui/index.js'
import {
  SERP_DESCRIPTION_MAX_CHARS_DESKTOP,
  SERP_DESCRIPTION_MAX_CHARS_MOBILE,
  SERP_TITLE_MAX_CHARS_DESKTOP,
  SERP_TITLE_MAX_CHARS_MOBILE,
} from '../constants.js'
import { highlightKeyphrases, truncateAtWord } from '../helpers/serpPreviewText.js'
import { useDashboardT } from '../hooks/useSeoAdmin.js'
import { useResolvedThresholds } from '../hooks/useSeoConfig.js'
import { withSeoErrorBoundary } from './withSeoErrorBoundary.js'
import './SerpPreview.css'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface SerpPreviewProps {
  metaTitle?: string
  metaDescription?: string
  slug?: string
  hostname?: string
  favicon?: string
  /** Focus keyphrase (and any synonyms), bolded in the title and description like Google does. */
  keyphrases?: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Text class for a tone (neutral reads as secondary text). */
function toneText(tone: Tone): string {
  return tone === 'neutral' ? 'seo-text--secondary' : `seo-text--${tone}`
}

function buildBreadcrumb(hostname: string, slug?: string): string {
  const base = hostname.replace(/^https?:\/\//, '').replace(/\/$/, '')
  if (!slug || slug === '/' || slug === '') return base
  const cleanSlug = slug.replace(/^\//, '').replace(/\/$/, '')
  const parts = cleanSlug.split('/')
  const breadcrumb = parts.map((p) => p.replace(/-/g, ' ')).join(' > ')
  return `${base} > ${breadcrumb}`
}

function buildFullUrl(hostname: string, slug?: string): string {
  const base = hostname.replace(/\/$/, '')
  const prefix = base.startsWith('http') ? base : `https://${base}`
  if (!slug || slug === '/' || slug === '') return prefix
  const cleanSlug = slug.replace(/^\//, '')
  return `${prefix}/${cleanSlug}`
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type DeviceMode = 'desktop' | 'mobile'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
function SerpPreviewInner({
  metaTitle,
  metaDescription,
  slug,
  hostname,
  favicon,
  keyphrases,
}: SerpPreviewProps) {
  const t = useDashboardT()
  const limits = useResolvedThresholds()
  const [device, setDevice] = useState<DeviceMode>('desktop')

  const title = metaTitle || ''
  const desc = metaDescription || ''
  const host = hostname || 'example.com'
  const fullUrl = buildFullUrl(host, slug)
  const breadcrumb = buildBreadcrumb(host, slug)

  const isDesktop = device === 'desktop'

  // Truncation limit per device (Google cuts by pixel width: these are approximations)
  const titleMaxChars = isDesktop ? SERP_TITLE_MAX_CHARS_DESKTOP : SERP_TITLE_MAX_CHARS_MOBILE
  const descMaxChars = isDesktop ? SERP_DESCRIPTION_MAX_CHARS_DESKTOP : SERP_DESCRIPTION_MAX_CHARS_MOBILE
  const displayTitle = title ? truncateAtWord(title, titleMaxChars) : ''
  const displayDesc = desc ? truncateAtWord(desc, descMaxChars) : ''
  const terms = keyphrases ?? []

  const counters: Array<{ label: string; text: string; tone: Tone }> = [
    {
      label: t.serpPreview.previewTitle,
      text: `${title.length} / ${limits.titleLengthMax} ${t.common.characters}`,
      tone: rangeTone(title.length, limits.titleLengthMin, limits.titleLengthMax),
    },
    {
      label: t.serpPreview.previewDescription,
      text: `${desc.length} / ${limits.metaDescLengthMax} ${t.common.characters}`,
      tone: rangeTone(desc.length, limits.metaDescLengthMin, limits.metaDescLengthMax),
    },
    {
      label: t.serpPreview.url,
      text: `${fullUrl.length} / 75 ${t.common.characters}`,
      tone: fullUrl.length <= 75 ? 'success' : 'danger',
    },
  ]

  return (
    <Collapsible
      header={
        <span className="seo-serp-preview__header">
          <SearchIcon />
          {t.serpPreview.title}
        </span>
      }
      initCollapsed
    >
      <div className="seo-stack">
        <div className="seo-row">
          <DeviceButton
            active={device === 'desktop'}
            icon="desktop"
            label={t.serpPreview.desktop}
            onClick={() => setDevice('desktop')}
          />
          <DeviceButton
            active={device === 'mobile'}
            icon="mobile"
            label={t.serpPreview.mobile}
            onClick={() => setDevice('mobile')}
          />
        </div>

        <div className={cx('seo-serp', 'seo-serp-preview', `seo-serp-preview--${device}`)}>
          <div className="seo-serp-preview__top">
            <div className="seo-serp-preview__favicon">
              {favicon ? (
                <img alt="" height={16} src={favicon} width={16} />
              ) : (
                <div className="seo-serp-preview__favicon-placeholder" />
              )}
            </div>

            <div className="seo-serp-preview__site">
              <div className="seo-serp__site">{host.replace(/^https?:\/\//, '')}</div>
              <div className="seo-serp__url">{breadcrumb}</div>
            </div>

            {/* 3-dot menu (decorative) */}
            <div aria-hidden="true" className="seo-serp-preview__menu">
              <span />
              <span />
              <span />
            </div>
          </div>

          <div className="seo-serp__title">
            {displayTitle ? highlightKeyphrases(displayTitle, terms) : <span className="seo-serp-preview__placeholder">{t.serpPreview.noMetaTitle}</span>}
          </div>

          <div className="seo-serp__description">
            {displayDesc ? (
              highlightKeyphrases(displayDesc, terms)
            ) : (
              <span className="seo-serp-preview__placeholder">{t.serpPreview.noMetaDescription}</span>
            )}
          </div>
        </div>

        <div className="seo-serp-preview__counters">
          {counters.map((counter) => (
            <div className="seo-row seo-row--between seo-row--nowrap" key={counter.label}>
              <span className="seo-text seo-text--small seo-text--secondary">{counter.label}</span>
              <span className={cx('seo-text seo-text--small seo-text--strong', toneText(counter.tone))}>
                {counter.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Collapsible>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DeviceButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string
  icon: 'desktop' | 'mobile'
  active: boolean
  onClick: () => void
}) {
  return (
    <Button
      aria-pressed={active}
      buttonStyle={active ? 'secondary' : 'ghost'}
      icon={
        icon === 'desktop' ? (
          <svg
            aria-hidden="true"
            fill="none"
            height="16"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="16"
          >
            <rect height="14" rx="2" ry="2" width="20" x="2" y="3" />
            <line x1="8" x2="16" y1="21" y2="21" />
            <line x1="12" x2="12" y1="17" y2="21" />
          </svg>
        ) : (
          <svg
            aria-hidden="true"
            fill="none"
            height="16"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="16"
          >
            <rect height="20" rx="2" ry="2" width="14" x="5" y="2" />
            <line x1="12" x2="12.01" y1="18" y2="18" />
          </svg>
        )
      }
      iconPosition="left"
      onClick={onClick}
      type="button"
    >
      {label}
    </Button>
  )
}

/**
 * Rendered by the sidebar (`SeoAnalyzer`) from the form's values. The boundary lives in this
 * module, so a crash here degrades to a retryable notice instead of taking the sidebar (and
 * the document editor with it) down.
 */
export const SerpPreview = withSeoErrorBoundary(SerpPreviewInner, { viewName: 'SerpPreview' })

export default SerpPreview
