'use client'

import React, { useState, useId } from 'react'
import { Collapsible } from '@payloadcms/ui'
import { useDashboardT } from '../hooks/useSeoAdmin.js'
import { cx, rangeTone, TonePill } from '../ui/index.js'
import { useResolvedThresholds } from '../hooks/useSeoConfig.js'
import type { ResolvedThresholds } from '../helpers/thresholds.js'
import './SeoSocialPreview.css'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface SeoSocialPreviewProps {
  metaTitle?: string
  metaDescription?: string
  imageUrl?: string
  hostname?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function SeoSocialPreview({
  metaTitle,
  metaDescription,
  imageUrl,
  hostname,
}: SeoSocialPreviewProps) {
  const t = useDashboardT()
  const limits = useResolvedThresholds()
  const [activeTab, setActiveTab] = useState<'facebook' | 'twitter'>('facebook')
  // This component is rendered inside the document editor, once per locale tab
  // on a localized document: literal ids would collide.
  const uid = useId()

  const title = metaTitle || ''
  const desc = metaDescription || ''
  const host = hostname || 'example.com'

  // Truncated values for preview display
  const fbTitle = title || t.socialPreview.pageTitlePlaceholder
  const fbDesc = desc || t.socialPreview.pageDescriptionPlaceholder
  const twTitle = title || t.socialPreview.pageTitlePlaceholder
  const twDesc = desc || t.socialPreview.pageDescriptionPlaceholder

  return (
    <Collapsible
      className="seo-social"
      header={
        <span className="seo-social__title">
          {/* Share icon (SVG) */}
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          {t.socialPreview.title}
        </span>
      }
      initCollapsed
    >
      <div className="seo-stack">
        {/* Tab switcher */}
        <div role="tablist" aria-label={t.socialPreview.title} className="seo-social__tabs">
          <TabButton
            label={t.socialPreview.facebook}
            active={activeTab === 'facebook'}
            onClick={() => setActiveTab('facebook')}
            id={`${uid}-tab-facebook`}
            panelId={`${uid}-panel-facebook`}
          />
          <TabButton
            label={t.socialPreview.twitter}
            active={activeTab === 'twitter'}
            onClick={() => setActiveTab('twitter')}
            id={`${uid}-tab-twitter`}
            panelId={`${uid}-panel-twitter`}
          />
        </div>

        {/* Facebook Preview */}
        {activeTab === 'facebook' && (
          <div
            role="tabpanel"
            id={`${uid}-panel-facebook`}
            aria-labelledby={`${uid}-tab-facebook`}
            className="seo-stack"
          >
            <div className="seo-social__fb">
              <div className="seo-social__fb-card">
                <ImagePlaceholder imageUrl={imageUrl} label={t.socialPreview.ogImage} />
                <div className="seo-social__fb-body">
                  <div className="seo-social__fb-host">{host}</div>
                  <div className="seo-social__fb-title">{fbTitle}</div>
                  <div className="seo-social__fb-desc">{fbDesc}</div>
                </div>
              </div>
            </div>

            {/* Character counters */}
            <CharCounters limits={limits} titleLen={title.length} descLen={desc.length} titleLabel={t.socialPreview.previewTitle} descLabel={t.socialPreview.previewDescription} charsLabel={t.common.characters} />
          </div>
        )}

        {/* Twitter/X Preview */}
        {activeTab === 'twitter' && (
          <div
            role="tabpanel"
            id={`${uid}-panel-twitter`}
            aria-labelledby={`${uid}-tab-twitter`}
            className="seo-stack"
          >
            <div className="seo-social__tw-card">
              <ImagePlaceholder imageUrl={imageUrl} label={t.socialPreview.cardImage} />
              <div className="seo-social__tw-body">
                <div className="seo-social__tw-host">{host}</div>
                <div className="seo-social__tw-title">{twTitle}</div>
                <div className="seo-social__tw-desc">{twDesc}</div>
              </div>
            </div>

            {/* Character counters */}
            <CharCounters limits={limits} titleLen={title.length} descLen={desc.length} titleLabel={t.socialPreview.previewTitle} descLabel={t.socialPreview.previewDescription} charsLabel={t.common.characters} />
          </div>
        )}
      </div>
    </Collapsible>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TabButton({
  label,
  active,
  onClick,
  id,
  panelId,
}: {
  label: string
  active: boolean
  onClick: () => void
  id?: string
  panelId?: string
}) {
  return (
    // role="tab" + aria-selected: the active tab is signalled to assistive tech, not by
    // colour alone. Same look as Payload's own tabs (see SeoSocialPreview.css).
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={active}
      aria-controls={panelId}
      onClick={onClick}
      className={cx('seo-social__tab', active && 'seo-social__tab--active')}
    >
      {label}
    </button>
  )
}

function ImagePlaceholder({
  imageUrl,
  label,
}: {
  imageUrl?: string
  label: string
}) {
  if (imageUrl) {
    // The URL comes from the document data, so it stays inline.
    return <div className="seo-social__image" style={{ backgroundImage: `url(${imageUrl})` }} />
  }

  return (
    <div className="seo-social__image seo-social__image--empty">
      <span>{label}</span>
    </div>
  )
}

function CharCounters({ limits, titleLen, descLen, titleLabel, descLabel, charsLabel }: { limits: ResolvedThresholds; titleLen: number; descLen: number; titleLabel: string; descLabel: string; charsLabel: string }) {
  return (
    <div className="seo-stack seo-stack--tight">
      <div className="seo-row seo-row--between seo-row--nowrap">
        <span className="seo-text seo-text--small seo-text--secondary">{titleLabel}</span>
        <TonePill tone={rangeTone(titleLen, limits.titleLengthMin, limits.titleLengthMax)}>
          {titleLen} / {limits.titleLengthMax} {charsLabel}
        </TonePill>
      </div>
      <div className="seo-row seo-row--between seo-row--nowrap">
        <span className="seo-text seo-text--small seo-text--secondary">{descLabel}</span>
        <TonePill tone={rangeTone(descLen, limits.metaDescLengthMin, limits.metaDescLengthMax)}>
          {descLen} / {limits.metaDescLengthMax} {charsLabel}
        </TonePill>
      </div>
    </div>
  )
}

export default SeoSocialPreview
