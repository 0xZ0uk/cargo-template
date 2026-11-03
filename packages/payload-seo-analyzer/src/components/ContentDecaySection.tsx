'use client'

import React, { useState, useMemo } from 'react'
import { Button, Collapsible } from '@payloadcms/ui'
import { useDashboardT } from '../hooks/useSeoLocale.js'
import { DataTable, Dot, EmptyState, TonePill, cx, type Tone } from '../ui/index.js'
import { usePayloadApi } from '../hooks/useSeoApi.js'
import './ContentDecaySection.css'

interface AuditItem {
  id: number | string
  collection: string
  title: string
  slug: string
  updatedAt: string
  contentLastReviewed: string
  daysSinceUpdate: number | null
}

export function ContentDecaySection({ items }: { items: AuditItem[] }) {
  const payloadApi = usePayloadApi()
  const t = useDashboardT()
  const [open, setOpen] = useState(false)
  const [markingReviewed, setMarkingReviewed] = useState<string | null>(null)
  const [reviewedKeys, setReviewedKeys] = useState<Set<string>>(new Set())

  const decayData = useMemo(() => {
    return items
      .map((item) => {
        const days =
          item.daysSinceUpdate ??
          (item.updatedAt
            ? Math.floor(
                (Date.now() - new Date(item.updatedAt).getTime()) / (1000 * 60 * 60 * 24),
              )
            : null)
        let level: 'green' | 'yellow' | 'orange' | 'red' = 'green'
        if (days !== null) {
          if (days > 365) level = 'red'
          else if (days > 180) level = 'orange'
          else if (days > 90) level = 'yellow'
        }
        return { ...item, daysSinceUpdate: days, level }
      })
      .filter((item) => item.daysSinceUpdate !== null)
      .sort((a, b) => (b.daysSinceUpdate ?? 0) - (a.daysSinceUpdate ?? 0))
  }, [items])

  const staleCount = decayData.filter((d) => d.level === 'orange' || d.level === 'red').length

  // Age bands: under 3 months is fresh, 3-6 months is not flagged yet (neutral),
  // beyond 6 months counts as stale.
  const levelTones: Record<string, Tone> = {
    green: 'success',
    yellow: 'neutral',
    orange: 'warning',
    red: 'danger',
  }
  const levelLabels: Record<string, string> = {
    green: t.contentDecay.lessThan3Months,
    yellow: t.contentDecay.months3to6,
    orange: t.contentDecay.months6to12,
    red: t.contentDecay.moreThan12Months,
  }

  const handleMarkReviewed = async (item: AuditItem) => {
    const key = `${item.collection}-${item.id}`
    setMarkingReviewed(key)
    try {
      const today = new Date().toISOString().split('T')[0]
      const res = await fetch(payloadApi(`/${item.collection}/${item.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ contentLastReviewed: today }),
      })
      if (res.ok) {
        setReviewedKeys((prev) => new Set(prev).add(key))
      }
    } catch {
      /* ignore */
    }
    setMarkingReviewed(null)
  }

  return (
    <Collapsible
      header={
        <span className="seo-row seo-row--nowrap">
          <span className="seo-text seo-text--strong">{t.contentDecay.title}</span>
          {staleCount > 0 && <TonePill tone="warning">{staleCount}</TonePill>}
        </span>
      }
      isCollapsed={!open}
      onToggle={(collapsed) => setOpen(!collapsed)}
    >
      {open && (
        <div className="seo-stack">
          <p className="seo-text seo-text--small seo-text--secondary">{t.contentDecay.description}</p>

          {/* Legend */}
          <div className="seo-row seo-content-decay__legend">
            {(['green', 'yellow', 'orange', 'red'] as const).map((lvl) => {
              const count = decayData.filter((d) => d.level === lvl).length
              return (
                <div className="seo-row seo-row--nowrap seo-text seo-text--small" key={lvl}>
                  <Dot tone={levelTones[lvl]} />
                  <span className="seo-text--secondary">{levelLabels[lvl]}</span>
                  <span>({count})</span>
                </div>
              )
            })}
          </div>

          {decayData.length === 0 ? (
            <EmptyState title={t.contentDecay.noData} />
          ) : (
            <div className="seo-content-decay__scroll">
              <DataTable aria-label={t.contentDecay.title} className="seo-content-decay__table">
                <thead>
                  <tr>
                    <th />
                    <th>{t.common.page}</th>
                    <th>{t.contentDecay.lastUpdate}</th>
                    <th>{t.contentDecay.lastReview}</th>
                    <th>{t.contentDecay.ageDays}</th>
                    <th>{t.contentDecay.action}</th>
                  </tr>
                </thead>
                <tbody>
                  {decayData.slice(0, 30).map((item) => {
                    const key = `${item.collection}-${item.id}`
                    const wasReviewed = reviewedKeys.has(key)
                    const tone = levelTones[item.level]
                    return (
                      <tr key={key}>
                        <td className="seo-content-decay__dot">
                          <Dot tone={tone} />
                        </td>
                        <td>
                          <div className="seo-truncate seo-text seo-text--strong">
                            {item.title || t.common.noTitle}
                          </div>
                          <div className="seo-row seo-row--nowrap seo-text seo-text--small seo-text--secondary">
                            <TonePill tone="neutral">
                              {item.collection === 'pages' ? t.common.page : t.common.article}
                            </TonePill>
                            <span className="seo-truncate">/{item.slug}</span>
                          </div>
                        </td>
                        <td className="seo-text--secondary">
                          {item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('fr-FR') : '-'}
                        </td>
                        <td className="seo-text--secondary">
                          {item.contentLastReviewed
                            ? new Date(item.contentLastReviewed).toLocaleDateString('fr-FR')
                            : '-'}
                        </td>
                        <td className={cx('seo-text--strong', tone !== 'neutral' && `seo-text--${tone}`)}>
                          {item.daysSinceUpdate ?? '-'} j
                        </td>
                        <td>
                          {wasReviewed ? (
                            <TonePill tone="success">{t.contentDecay.reviewed}</TonePill>
                          ) : (
                            <Button
                              buttonStyle="secondary"
                              disabled={markingReviewed === key}
                              onClick={() => handleMarkReviewed(item)}
                            >
                              {markingReviewed === key ? '...' : t.contentDecay.markReviewed}
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </DataTable>
            </div>
          )}
        </div>
      )}
    </Collapsible>
  )
}
