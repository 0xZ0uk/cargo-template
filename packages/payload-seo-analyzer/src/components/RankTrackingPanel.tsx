'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Banner, Button, RefreshIcon } from '@payloadcms/ui'
import { useSeoFeature } from '../hooks/useSeoLocale.js'
import { Card, DataTable, EmptyState, LoadingState, TonePill } from '../ui/index.js'
import { useSeoApi } from '../hooks/useSeoApi.js'
import './RankTrackingPanel.css'

const S = {
  fr: {
    title: 'Suivi de positions (rank tracking)',
    subtitle: 'Historique quotidien des positions Google (via Search Console) et mouvements dans le temps.',
    needGsc: 'Connectez Google Search Console ci-dessus pour activer le suivi de positions.',
    snapshot: 'Relever maintenant',
    snapshotting: 'Relevé en cours…',
    noData: 'Pas encore de données. Le relevé tourne automatiquement chaque jour ; cliquez « Relever maintenant » pour démarrer.',
    lastSnapshot: 'Dernier relevé',
    query: 'Requête',
    position: 'Position',
    change: 'Évolution',
    clicks: 'Clics',
    impressions: 'Impr.',
    stable: 'stable',
    newQ: 'nouveau',
    countLabel: 'requêtes suivies',
    loading: 'Chargement…',
  },
  en: {
    title: 'Rank tracking',
    subtitle: 'Daily Google position history (via Search Console) and movement over time.',
    needGsc: 'Connect Google Search Console above to enable rank tracking.',
    snapshot: 'Snapshot now',
    snapshotting: 'Snapshotting…',
    noData: 'No data yet. The snapshot runs automatically every day; click "Snapshot now" to start.',
    lastSnapshot: 'Last snapshot',
    query: 'Query',
    position: 'Position',
    change: 'Change',
    clicks: 'Clicks',
    impressions: 'Impr.',
    stable: 'stable',
    newQ: 'new',
    countLabel: 'tracked queries',
    loading: 'Loading…',
  },
} as const

interface Mover {
  query: string
  page: string | null
  position: number
  previousPosition: number | null
  delta: number
  clicks: number
  impressions: number
  ctr: number
  snapshotDate: string
}

export function RankTrackingPanel({ locale }: { locale: 'fr' | 'en' }) {
  const seoApi = useSeoApi()
  const gscEnabled = useSeoFeature('gscApi')
  const s = S[locale] ?? S.fr
  const [movers, setMovers] = useState<Mover[] | null>(null)
  const [lastSnapshot, setLastSnapshot] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notConnected, setNotConnected] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (gscEnabled === false) {
        // features.gscApi is off, so the endpoint is not registered: calling it
        // would only make the browser log a 404 on every visit. Same state as a 404.
        setNotConnected(true)
        setMovers(null)
        return
      }
      const res = await fetch(seoApi('/rank-history'), { credentials: 'include', cache: 'no-store' })
      // 404 = endpoint not registered (features.gscApi off) · 403/409 = not admin / not connected.
      if (res.status === 404 || res.status === 403 || res.status === 409) {
        setNotConnected(true)
        setMovers(null)
        return
      }
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || `Error ${res.status}`)
        return
      }
      setMovers((json.movers as Mover[]) || [])
      setLastSnapshot(json.lastSnapshot || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [gscEnabled])

  useEffect(() => {
    void load()
  }, [load])

  const snapshotNow = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(seoApi('/rank-snapshot'), { method: 'POST', credentials: 'include' })
      const json = await res.json()
      if (res.status === 409) {
        setNotConnected(true)
        return
      }
      if (!res.ok) {
        setError(json.error || json.reason || `Error ${res.status}`)
        return
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  // delta > 0 = improved (moved up the SERP); < 0 = dropped.
  const renderDelta = (m: Mover) => {
    if (m.previousPosition === null) {
      return <span className="seo-text seo-text--small seo-text--secondary">{s.newQ}</span>
    }
    if (Math.abs(m.delta) < 0.1) {
      return <span className="seo-text seo-text--small seo-text--secondary">{s.stable}</span>
    }
    const up = m.delta > 0
    return (
      <TonePill tone={up ? 'success' : 'danger'}>
        {up ? '+' : '−'}
        {Math.abs(m.delta).toFixed(1)}
      </TonePill>
    )
  }

  return (
    <Card
      actions={
        !notConnected ? (
          <Button
            buttonStyle="secondary"
            disabled={busy}
            icon={<RefreshIcon />}
            margin={false}
            onClick={snapshotNow}
            size="medium"
          >
            {busy ? s.snapshotting : s.snapshot}
          </Button>
        ) : undefined
      }
      title={s.title}
    >
      <p className="seo-text seo-text--small seo-text--secondary">{s.subtitle}</p>

      {error && (
        <div role="alert">
          <Banner type="danger">{error}</Banner>
        </div>
      )}

      {notConnected && <Banner type="default">{s.needGsc}</Banner>}

      {!notConnected && (
        <>
          {lastSnapshot && (
            <p className="seo-text seo-text--small seo-text--secondary">
              {s.lastSnapshot}: {new Date(lastSnapshot).toLocaleString(locale)}
              {movers ? ` · ${movers.length} ${s.countLabel}` : ''}
            </p>
          )}

          {loading && !movers && <LoadingState label={s.loading} />}

          {movers && movers.length === 0 && <EmptyState title={s.noData} />}

          {movers && movers.length > 0 && (
            <DataTable aria-label={s.title}>
              <thead>
                <tr>
                  <th scope="col">{s.query}</th>
                  <th className="seo-table__num" scope="col">
                    {s.position}
                  </th>
                  <th className="seo-table__num" scope="col">
                    {s.change}
                  </th>
                  <th className="seo-table__num" scope="col">
                    {s.clicks}
                  </th>
                  <th className="seo-table__num" scope="col">
                    {s.impressions}
                  </th>
                </tr>
              </thead>
              <tbody>
                {movers.slice(0, 100).map((m, i) => (
                  <tr key={i}>
                    <td className="seo-rank__query" title={m.query}>
                      {m.query}
                    </td>
                    <td className="seo-table__num seo-text--strong">{m.position.toFixed(1)}</td>
                    <td className="seo-table__num">{renderDelta(m)}</td>
                    <td className="seo-table__num">{m.clicks}</td>
                    <td className="seo-table__num">{m.impressions}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </>
      )}
    </Card>
  )
}
