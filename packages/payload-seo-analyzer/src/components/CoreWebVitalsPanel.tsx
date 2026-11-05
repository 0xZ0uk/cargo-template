'use client'

import React, { useState } from 'react'
import { Banner, Button, RefreshIcon, Tabs } from '@payloadcms/ui'
import { Card, Field, Grid, StatTile, type Tone } from '../ui/index.js'
import { useSeoApi } from '../hooks/useSeoApi.js'
import './CoreWebVitalsPanel.css'

const s = {
  title: 'Core Web Vitals',
  subtitle: 'Real LCP / INP / CLS via PageSpeed Insights — informational, outside the SEO score (tie-breaker).',
  urlPlaceholder: 'https://your-site.com/page-to-test',
  urlLabel: 'URL to test',
  test: 'Test',
  testing: 'Analyzing…',
  retest: 'Re-test',
  mobile: 'Mobile',
  desktop: 'Desktop',
  sourceField: 'Field data (real users, CrUX)',
  sourceLab: 'Lab data (Lighthouse)',
  measured: (when: string) => `Measured ${when}`,
  noInp: 'INP needs real-user field data (not available in lab).',
  inpHint: 'INP is the most commonly failed Core Web Vital in 2026 — prioritize it.',
  noKey: 'Tip: set PAGESPEED_API_KEY on the server to raise the quota.',
  good: 'Good',
  ni: 'Needs improvement',
  poor: 'Poor',
  na: '—',
} as const

type Rating = 'good' | 'needs-improvement' | 'poor' | 'unknown'

interface Metric {
  value: number | null
  unit: string
  rating?: Rating
  note?: string
  source?: string
}
interface CwvResponse {
  url: string
  strategy: string
  source: 'field' | 'lab'
  hasFieldData: boolean
  /** Epoch ms of the PSI run. Absent for a result cached in memory (no `cacheStore`). */
  builtAt?: number
  keyConfigured: boolean
  metrics: { lcp: Metric; inp: Metric; cls: Metric; tbt: Metric }
}

function ratingTone(r?: Rating): Tone {
  if (r === 'good') return 'success'
  if (r === 'needs-improvement') return 'warning'
  if (r === 'poor') return 'danger'
  return 'neutral'
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function formatMeasuredAgo(builtAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - builtAt) / 1000))
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return rtf.format(-Math.floor(seconds / 60), 'minute')
  if (seconds < 86_400) return rtf.format(-Math.floor(seconds / 3600), 'hour')
  return rtf.format(-Math.floor(seconds / 86_400), 'day')
}

function formatValue(m: Metric, key: string): string {
  if (m.value === null || Number.isNaN(m.value)) return '—'
  if (key === 'cls') return m.value.toFixed(2)
  if (m.unit === 'ms') return m.value >= 1000 ? `${(m.value / 1000).toFixed(2)} s` : `${Math.round(m.value)} ms`
  return String(Math.round(m.value))
}

export function CoreWebVitalsPanel() {
  const seoApi = useSeoApi()
  const [url, setUrl] = useState<string>(typeof window !== 'undefined' ? window.location.origin : '')
  const [strategy, setStrategy] = useState<'mobile' | 'desktop'>('mobile')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<CwvResponse | null>(null)

  // Results are cached for 24 h; Re-test asks for a fresh PSI run (honoured for SEO admins only).
  const run = async (force = false) => {
    if (!url) return
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const res = await fetch(
        seoApi(
          `/core-web-vitals?url=${encodeURIComponent(url)}&strategy=${strategy}${force ? '&nocache=1' : ''}`,
        ),
        { credentials: 'include' },
      )
      const json = await res.json()
      if (!res.ok) setError(json.error || `Error ${res.status}`)
      else setData(json as CwvResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  const labelByKey: Record<string, string> = { lcp: 'LCP', inp: 'INP', cls: 'CLS' }

  const metricCard = (key: 'lcp' | 'inp' | 'cls', m: Metric) => (
    <StatTile
      hint={
        <>
          {m.rating === 'good' ? s.good : m.rating === 'needs-improvement' ? s.ni : m.rating === 'poor' ? s.poor : s.na}
          {m.note && <span className="seo-cwv__note">{s.noInp}</span>}
          {key === 'inp' && <span className="seo-cwv__note seo-text--brand">{s.inpHint}</span>}
        </>
      }
      key={key}
      label={labelByKey[key]}
      tone={ratingTone(m.rating)}
      value={formatValue(m, key)}
    />
  )

  return (
    <Card title={s.title}>
      <p className="seo-text seo-text--small seo-text--secondary">{s.subtitle}</p>

      <div className="seo-cwv__form">
        <Field className="seo-cwv__url" label={s.urlLabel}>
          <input
            aria-label={s.urlLabel}
            className="seo-input"
            onChange={(e) => setUrl(e.target.value)}
            placeholder={s.urlPlaceholder}
            type="url"
            value={url}
          />
        </Field>
        <Tabs<'mobile' | 'desktop'>
          onChange={setStrategy}
          tabs={[
            { label: s.mobile, value: 'mobile' },
            { label: s.desktop, value: 'desktop' },
          ]}
          value={strategy}
        />
        <Button buttonStyle="primary" disabled={loading || !url} margin={false} onClick={() => void run()} size="medium">
          {loading ? s.testing : s.test}
        </Button>
      </div>

      {error && (
        <div role="alert">
          <Banner type="danger">{error}</Banner>
        </div>
      )}

      {data && (
        <>
          <Grid>
            {metricCard('lcp', data.metrics.lcp)}
            {metricCard('inp', data.metrics.inp)}
            {metricCard('cls', data.metrics.cls)}
          </Grid>
          <p className="seo-text seo-text--small seo-text--secondary">
            {data.source === 'field' ? s.sourceField : s.sourceLab}
            {typeof data.builtAt === 'number' && ` · ${s.measured(formatMeasuredAgo(data.builtAt))}`}
            {!data.keyConfigured && ` · ${s.noKey}`}
          </p>
          <Button
            buttonStyle="secondary"
            disabled={loading}
            icon={<RefreshIcon />}
            margin={false}
            onClick={() => void run(true)}
            size="medium"
          >
            {s.retest}
          </Button>
        </>
      )}
    </Card>
  )
}
