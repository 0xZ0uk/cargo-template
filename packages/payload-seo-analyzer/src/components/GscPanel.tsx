'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Banner, Button, RefreshIcon } from '@payloadcms/ui'
import { useSeoFeature } from '../hooks/useSeoAdmin.js'
import { Card, DataTable, EmptyState, LoadingState, TonePill } from '../ui/index.js'
import { useSeoApi } from '../hooks/useSeoApi.js'
import './GscPanel.css'

const s = {
  title: 'Google Search Console',
  subtitle: 'OAuth connection to automatically import real clicks, impressions and positions.',
  notConfigured:
    'Integration not configured. Enable features.gscApi and set GSC_OAUTH_CLIENT_ID / GSC_OAUTH_CLIENT_SECRET on the server, then register the redirect URI in Google Cloud.',
  redirectHint: 'Redirect URI to register:',
  connect: 'Connect Google Search Console',
  disconnect: 'Disconnect',
  connectedAs: 'Connected',
  notConnected: 'Not connected',
  fetch: 'Fetch data (28 d)',
  fetching: 'Loading…',
  byQuery: 'By query',
  byPage: 'By page',
  query: 'Query',
  page: 'Page',
  clicks: 'Clicks',
  impressions: 'Impressions',
  ctr: 'CTR',
  position: 'Position',
  noData: 'No data for the period.',
  refreshStatus: 'Refresh status',
  connectHint: 'A Google window will open. After authorizing, come back here and refresh the status.',
} as const

interface GscStatus {
  configured: boolean
  connected: boolean
  connectedEmail: string | null
  connectedAt: string | null
  propertyUrl: string | null
  redirectUri: string | null
}
interface GscRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export function GscPanel() {
  const seoApi = useSeoApi()
  const gscEnabled = useSeoFeature('gscApi')
  const [status, setStatus] = useState<GscStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<GscRow[] | null>(null)
  const [dimension, setDimension] = useState<'query' | 'page'>('query')
  const [dataLoading, setDataLoading] = useState(false)

  const loadStatus = useCallback(async () => {
    setError(null)
    if (gscEnabled === false) {
      // features.gscApi is off, so the endpoint is not registered: calling it would
      // only make the browser log a 404 on every visit. Same state as a 404.
      setStatus({ configured: false, connected: false, connectedEmail: null, connectedAt: null, propertyUrl: null, redirectUri: null })
      return
    }
    try {
      const res = await fetch(seoApi('/gsc/status'), { credentials: 'include' })
      if (res.status === 404) {
        // Endpoint not registered — features.gscApi is off. Show the "not configured" guidance.
        setStatus({ configured: false, connected: false, connectedEmail: null, connectedAt: null, propertyUrl: null, redirectUri: null })
        return
      }
      const json = await res.json()
      if (!res.ok) setError(json.error || `Error ${res.status}`)
      else setStatus(json as GscStatus)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    }
  }, [gscEnabled])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(seoApi('/gsc/auth'), { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) setError(json.error || `Error ${res.status}`)
      else if (json.authUrl) window.open(json.authUrl, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    setError(null)
    try {
      await fetch(seoApi('/gsc/disconnect'), { method: 'POST', credentials: 'include' })
      setRows(null)
      await loadStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  const fetchData = async (dim: 'query' | 'page') => {
    setDimension(dim)
    setDataLoading(true)
    setError(null)
    setRows(null)
    try {
      const res = await fetch(seoApi(`/gsc/data?dimension=${dim}&rowLimit=50`), { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) setError(json.error || `Error ${res.status}`)
      else setRows((json.rows as GscRow[]) || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setDataLoading(false)
    }
  }

  if (!status) {
    return (
      <Card title={s.title}>
        <LoadingState />
      </Card>
    )
  }

  return (
    <Card
      actions={
        <TonePill tone={status.connected ? 'success' : 'neutral'}>
          {status.connected ? s.connectedAs : s.notConnected}
        </TonePill>
      }
      title={s.title}
    >
      <p className="seo-text seo-text--small seo-text--secondary">{s.subtitle}</p>

      {error && (
        <div role="alert">
          <Banner type="danger">{error}</Banner>
        </div>
      )}

      {!status.configured && (
        <Banner type="default">
          <div className="seo-stack seo-stack--tight">
            <span>{s.notConfigured}</span>
            {status.redirectUri && (
              <span>
                <strong>{s.redirectHint}</strong> <code className="seo-mono">{status.redirectUri}</code>
              </span>
            )}
          </div>
        </Banner>
      )}

      {status.configured && !status.connected && (
        <>
          <div className="seo-row">
            <Button buttonStyle="primary" disabled={busy} margin={false} onClick={connect} size="medium">
              {s.connect}
            </Button>
            <Button
              buttonStyle="secondary"
              disabled={busy}
              icon={<RefreshIcon />}
              margin={false}
              onClick={() => void loadStatus()}
              size="medium"
            >
              {s.refreshStatus}
            </Button>
          </div>
          <p className="seo-text seo-text--small seo-text--secondary">{s.connectHint}</p>
        </>
      )}

      {status.configured && status.connected && (
        <>
          <p className="seo-text seo-text--small seo-text--secondary">
            {s.connectedAs}
            {status.connectedEmail ? ` · ${status.connectedEmail}` : ''}
            {status.propertyUrl ? ` · ${status.propertyUrl}` : ''}
          </p>
          <div className="seo-row">
            <Button
              aria-pressed={dimension === 'query'}
              buttonStyle={dimension === 'query' ? 'primary' : 'secondary'}
              disabled={dataLoading}
              margin={false}
              onClick={() => void fetchData('query')}
              size="medium"
            >
              {s.byQuery}
            </Button>
            <Button
              aria-pressed={dimension === 'page'}
              buttonStyle={dimension === 'page' ? 'primary' : 'secondary'}
              disabled={dataLoading}
              margin={false}
              onClick={() => void fetchData('page')}
              size="medium"
            >
              {s.byPage}
            </Button>
            <span className="seo-spacer" />
            <Button buttonStyle="secondary" disabled={busy} margin={false} onClick={disconnect} size="medium">
              {s.disconnect}
            </Button>
          </div>

          {dataLoading && <LoadingState label={s.fetching} />}

          {rows && rows.length === 0 && <EmptyState title={s.noData} />}

          {rows && rows.length > 0 && (
            <DataTable aria-label={dimension === 'query' ? s.byQuery : s.byPage}>
              <thead>
                <tr>
                  <th scope="col">{dimension === 'query' ? s.query : s.page}</th>
                  <th className="seo-table__num" scope="col">
                    {s.clicks}
                  </th>
                  <th className="seo-table__num" scope="col">
                    {s.impressions}
                  </th>
                  <th className="seo-table__num" scope="col">
                    {s.ctr}
                  </th>
                  <th className="seo-table__num" scope="col">
                    {s.position}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="seo-gsc__key" title={r.keys?.[0]}>
                      {r.keys?.[0] || '—'}
                    </td>
                    <td className="seo-table__num seo-text--strong">{r.clicks}</td>
                    <td className="seo-table__num">{r.impressions}</td>
                    <td className="seo-table__num">{(r.ctr * 100).toFixed(1)}%</td>
                    <td className="seo-table__num">{r.position.toFixed(1)}</td>
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
