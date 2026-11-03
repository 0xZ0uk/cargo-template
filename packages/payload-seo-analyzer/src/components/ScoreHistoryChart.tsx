'use client'

import React, { useEffect, useState, useMemo, useId } from 'react'
import { Banner } from '@payloadcms/ui'
import { useDashboardT } from '../hooks/useSeoLocale.js'
import {
  Card,
  EmptyState,
  LoadingState,
  ScorePill,
  TONE_MARK,
  TonePill,
  scoreTone,
  type Tone,
} from '../ui/index.js'
import { useSeoApi } from '../hooks/useSeoApi.js'
import './ScoreHistoryChart.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HistoryEntry {
  score: number
  level: string
  focusKeyword: string
  wordCount: number
  checksSummary: { pass: number; warning: number; fail: number }
  snapshotDate: string
}

interface HistoryResponse {
  history: HistoryEntry[]
  trend: 'improving' | 'declining' | 'stable'
  scoreDelta: number
}

interface ScoreHistoryChartProps {
  documentId: string
  collection: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Score bands of the analyzer: 71+ is good, 41-70 needs work, below is poor. */
const SCORE_THRESHOLDS = { good: 71, ok: 41 }

function getTrendIcon(trend: 'improving' | 'declining' | 'stable'): string {
  switch (trend) {
    case 'improving':
      return '\u2197' // arrow upper-right
    case 'declining':
      return '\u2198' // arrow lower-right
    case 'stable':
      return '\u2192' // arrow right
  }
}

function getTrendTone(trend: 'improving' | 'declining' | 'stable'): Tone {
  switch (trend) {
    case 'improving':
      return 'success'
    case 'declining':
      return 'danger'
    case 'stable':
      return 'warning'
  }
}

function getTrendLabel(
  trend: 'improving' | 'declining' | 'stable',
  labels: { improving: string; declining: string; stable: string },
): string {
  return labels[trend]
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// SVG Sparkline
// ---------------------------------------------------------------------------

function Sparkline({
  data,
  width,
  height,
}: {
  data: number[]
  width: number
  height: number
}) {
  const padding = { top: 4, bottom: 4, left: 2, right: 2 }
  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom

  // Y-axis: always 0-100 for SEO scores
  const yMin = 0
  const yMax = 100

  const points = useMemo(() => {
    if (data.length === 0) return ''
    if (data.length === 1) {
      const x = padding.left + chartW / 2
      const y = padding.top + chartH - ((data[0] - yMin) / (yMax - yMin)) * chartH
      return `${x},${y}`
    }

    return data
      .map((val, i) => {
        const x = padding.left + (i / (data.length - 1)) * chartW
        const y = padding.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH
        return `${x},${y}`
      })
      .join(' ')
  }, [data, chartW, chartH, padding.left, padding.top])

  // Gradient fill area (polyline + bottom closing path)
  const areaPoints = useMemo(() => {
    if (data.length < 2) return ''

    const linePoints = data.map((val, i) => {
      const x = padding.left + (i / (data.length - 1)) * chartW
      const y = padding.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH
      return `${x},${y}`
    })

    const bottomRight = `${padding.left + chartW},${padding.top + chartH}`
    const bottomLeft = `${padding.left},${padding.top + chartH}`

    return linePoints.join(' ') + ' ' + bottomRight + ' ' + bottomLeft
  }, [data, chartW, chartH, padding.left, padding.top])

  // Color based on latest score
  const latestScore = data.length > 0 ? data[data.length - 1] : 0
  const lineColor = TONE_MARK[scoreTone(latestScore, SCORE_THRESHOLDS)]

  // useId(), not Math.random(): the random id changed on every render (so the
  // gradient reference was rebuilt each time) and differed between the server
  // and client renders, which is a hydration mismatch.
  const gradientId = `sparkline-grad-${useId()}`

  if (data.length === 0) return null

  return (
    <svg className="seo-chart" height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
          <stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
        </linearGradient>
      </defs>

      {/* Grid lines at 25, 50, 75 */}
      {[25, 50, 75].map((val) => {
        const y = padding.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH
        return (
          <line
            key={val}
            x1={padding.left}
            y1={y}
            x2={width - padding.right}
            y2={y}
            className="seo-chart__grid"
            strokeDasharray="2,2"
            opacity={0.5}
          />
        )
      })}

      {/* Gradient area fill */}
      {areaPoints && (
        <polygon points={areaPoints} fill={`url(#${gradientId})`} />
      )}

      {/* Main line */}
      <polyline
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Data points */}
      {data.map((val, i) => {
        const x =
          data.length === 1
            ? padding.left + chartW / 2
            : padding.left + (i / (data.length - 1)) * chartW
        const y = padding.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH
        const isLast = i === data.length - 1
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={isLast ? 3 : 1.5}
            className={isLast ? undefined : 'seo-score-history__point'}
            fill={isLast ? lineColor : undefined}
            stroke={lineColor}
            strokeWidth={isLast ? 2 : 1}
          />
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const ScoreHistoryChart: React.FC<ScoreHistoryChartProps> = ({ documentId, collection }) => {
  const seoApi = useSeoApi()
  const t = useDashboardT()
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!documentId || !collection) {
      setLoading(false)
      return
    }

    let cancelled = false

    const fetchHistory = async () => {
      try {
        setLoading(true)
        setError(false)

        const params = new URLSearchParams({
          documentId,
          collection,
          limit: '30',
        })

        const res = await fetch(seoApi(`/history?${params.toString()}`), {
          credentials: 'include',
          cache: 'no-store',
        })

        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const json: HistoryResponse = await res.json()
        if (!cancelled) {
          setData(json)
        }
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchHistory()
    return () => {
      cancelled = true
    }
  }, [documentId, collection])

  // Loading state
  if (loading) {
    return <LoadingState label={t.scoreHistory.loading} />
  }

  // Error state
  if (error) {
    return <Banner type="danger">{t.scoreHistory.loadingError}</Banner>
  }

  // Empty state
  if (!data || data.history.length === 0) {
    return <EmptyState description={t.scoreHistory.noHistoryDesc} title={t.scoreHistory.noHistory} />
  }

  const { history, trend, scoreDelta } = data
  const scores = history.map((h) => h.score)
  const latestScore = scores[scores.length - 1]
  const firstDate = history.length > 0 ? formatDate(history[0].snapshotDate) : ''
  const lastDate = history.length > 0 ? formatDate(history[history.length - 1].snapshotDate) : ''
  const trendIcon = getTrendIcon(trend)
  const trendLabel = getTrendLabel(trend, {
    improving: t.scoreHistory.improving,
    declining: t.scoreHistory.declining,
    stable: t.scoreHistory.stable,
  })

  return (
    <Card
      actions={
        <div className="seo-row seo-row--nowrap">
          {/* Trend badge */}
          <TonePill tone={getTrendTone(trend)}>
            {trendIcon} {trendLabel}
          </TonePill>

          {/* Score delta badge */}
          {scoreDelta !== 0 && (
            <TonePill tone={scoreDelta > 0 ? 'success' : 'danger'}>
              {scoreDelta > 0 ? '+' : ''}
              {scoreDelta}
            </TonePill>
          )}
        </div>
      }
      className="seo-score-history"
      footer={
        <div className="seo-row seo-row--between seo-row--nowrap seo-score-history__footer">
          <span className="seo-text seo-text--small seo-text--secondary">
            <span className="seo-text--strong">{history.length}</span> {t.scoreHistory.measures}
          </span>
          <span className="seo-row seo-row--nowrap seo-text seo-text--small seo-text--secondary">
            {t.scoreHistory.latestScore}
            <ScorePill score={latestScore} thresholds={SCORE_THRESHOLDS} />
          </span>
        </div>
      }
      title={t.scoreHistory.scoreEvolution}
    >
      {/* Sparkline chart */}
      <Sparkline data={scores} width={260} height={60} />

      {/* X-axis date labels */}
      <div className="seo-row seo-row--between seo-text seo-text--small seo-text--secondary">
        <span>{firstDate}</span>
        <span>{lastDate}</span>
      </div>
    </Card>
  )
}

export default ScoreHistoryChart
