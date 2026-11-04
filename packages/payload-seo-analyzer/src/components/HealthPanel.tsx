'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Banner } from '@payloadcms/ui'
import { Card, Dot, TonePill } from '../ui/index.js'
import { useSeoApi } from '../hooks/useSeoApi.js'

const S = {
  fr: {
    title: 'Santé du module SEO',
    subtitle: 'Configuration et état des intégrations / jobs (lecture seule).',
    ok: 'Tout est configuré ✓',
    ai: 'IA (OpenRouter)',
    gsc: 'Search Console',
    psi: 'PageSpeed',
    alerts: 'Alertes',
    rank: 'Dernier relevé positions',
    none: 'jamais',
    warnings: 'À corriger',
  },
  en: {
    title: 'SEO module health',
    subtitle: 'Integration & background-job status (read-only).',
    ok: 'All configured ✓',
    ai: 'AI (OpenRouter)',
    gsc: 'Search Console',
    psi: 'PageSpeed',
    alerts: 'Alerts',
    rank: 'Last rank snapshot',
    none: 'never',
    warnings: 'To fix',
  },
} as const

interface Health {
  ok: boolean
  config: { aiKey: boolean; pageSpeedKey: boolean; gscConfigured: boolean; alertWebhook: boolean; alertEmail: boolean }
  runtime: { gscConnected: boolean; lastRankSnapshot: string | null }
  warnings: string[]
}

export function HealthPanel({ locale }: { locale: 'fr' | 'en' }) {
  const seoApi = useSeoApi()
  const s = S[locale] ?? S.fr
  const [h, setH] = useState<Health | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(seoApi('/health'), { credentials: 'include', cache: 'no-store' })
      if (res.ok) setH((await res.json()) as Health)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!h) return null

  const status = (label: string, on: boolean) => (
    <span className="seo-row seo-row--nowrap seo-text seo-text--small" key={label}>
      <Dot tone={on ? 'success' : 'neutral'} />
      {label}
    </span>
  )

  return (
    <Card
      actions={<TonePill tone={h.ok ? 'success' : 'warning'}>{h.ok ? s.ok : `${h.warnings.length} ⚠`}</TonePill>}
      title={s.title}
    >
      <p className="seo-text seo-text--small seo-text--secondary">{s.subtitle}</p>

      <div className="seo-row" style={{ columnGap: 'var(--spacer-3)' }}>
        {status(s.ai, h.config.aiKey)}
        {status(s.gsc, h.config.gscConfigured && h.runtime.gscConnected)}
        {status(s.psi, h.config.pageSpeedKey)}
        {status(s.alerts, h.config.alertWebhook || h.config.alertEmail)}
        <span className="seo-text seo-text--small seo-text--secondary">
          {s.rank}: {h.runtime.lastRankSnapshot ? new Date(h.runtime.lastRankSnapshot).toLocaleDateString(locale) : s.none}
        </span>
      </div>

      {h.warnings.length > 0 && (
        <Banner type="warning">
          <strong>{s.warnings}</strong>
          <ul style={{ margin: 'var(--spacer-1) 0 0', paddingInlineStart: 'var(--spacer-4)' }}>
            {h.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Banner>
      )}
    </Card>
  )
}
