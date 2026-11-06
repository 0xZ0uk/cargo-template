'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Banner, Button, NewTabIcon, RefreshIcon } from '@payloadcms/ui'
import { useSeoFeature } from '../hooks/useSeoAdmin.js'
import { Card, DataTable, EmptyState, LoadingState, TonePill } from '../ui/index.js'
import { usePayloadApi, useSeoApi } from '../hooks/useSeoApi.js'
import './CtrOpportunitiesPanel.css'

const s = {
  title: 'CTR opportunities (low clicks / good rank)',
  subtitle: 'Pages that rank well but get few clicks (weak meta). Google Search Console data → targeted meta rewrite.',
  needGsc: 'Connect Google Search Console above to enable CTR opportunities.',
  none: 'No opportunities for the period.',
  loading: 'Analyzing GSC data…',
  page: 'Page',
  pos: 'Pos.',
  ctr: 'CTR',
  expected: 'expected',
  potential: 'Potential clicks/mo',
  optimize: 'Optimize',
  optimizing: '…',
  apply: 'Apply',
  applied: 'Applied',
  noKey: 'OpenRouter API key required (OPENROUTER_API_KEY).',
  open: 'Open',
  refresh: 'Refresh',
} as const

interface Opportunity {
  url: string
  impressions: number
  clicks: number
  ctr: number
  position: number
  expectedCtr: number
  potentialClicks: number
  doc: { collection: string; id: string } | null
}
interface RowState {
  busy?: boolean
  suggestion?: { metaTitle: string; metaDescription: string; focusKeyword: string; current: { focusKeyword: string } }
  applied?: boolean
  error?: string
}

export function CtrOpportunitiesPanel() {
  const payloadApi = usePayloadApi()
  const seoApi = useSeoApi()
  const gscEnabled = useSeoFeature('gscApi')
  const [opps, setOpps] = useState<Opportunity[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [notConnected, setNotConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<Record<string, RowState>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (gscEnabled === false) {
        // features.gscApi is off, so the endpoint is not registered: calling it
        // would only make the browser log a 404 on every visit. Same state as a 404.
        setNotConnected(true)
        return
      }
      const res = await fetch(seoApi('/ctr-opportunities'), { credentials: 'include', cache: 'no-store' })
      // 404 = endpoint not registered (features.gscApi off) · 403/409/400 = not admin / not connected / misconfig.
      if (res.status === 404 || res.status === 403 || res.status === 409 || res.status === 400) {
        setNotConnected(true)
        return
      }
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || `Error ${res.status}`)
        return
      }
      setNotConnected(false)
      setOpps((json.opportunities as Opportunity[]) || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [gscEnabled])

  useEffect(() => {
    void load()
  }, [load])

  const setRow = (url: string, patch: RowState) => setState((p) => ({ ...p, [url]: { ...p[url], ...patch } }))

  const optimize = async (o: Opportunity) => {
    if (!o.doc) return
    setRow(o.url, { busy: true, error: undefined })
    try {
      const res = await fetch(seoApi('/ai-optimize'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: o.doc.collection, id: o.doc.id }),
      })
      const json = await res.json()
      if (!res.ok) {
        setRow(o.url, { busy: false, error: json.code === 'no_api_key' ? s.noKey : json.error || `Error ${res.status}` })
        return
      }
      setRow(o.url, { busy: false, suggestion: { ...json.suggestions, current: json.current } })
    } catch (e) {
      setRow(o.url, { busy: false, error: e instanceof Error ? e.message : 'Network error' })
    }
  }

  const apply = async (o: Opportunity) => {
    const rs = state[o.url]
    if (!o.doc || !rs?.suggestion) return
    setRow(o.url, { busy: true, error: undefined })
    const patch: Record<string, unknown> = {}
    if (rs.suggestion.metaTitle || rs.suggestion.metaDescription) {
      patch.meta = { title: rs.suggestion.metaTitle, description: rs.suggestion.metaDescription }
    }
    if (rs.suggestion.focusKeyword && rs.suggestion.focusKeyword !== rs.suggestion.current?.focusKeyword) {
      patch.focusKeyword = rs.suggestion.focusKeyword
    }
    try {
      await fetch(payloadApi(`/${o.doc.collection}/${o.doc.id}`), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      setRow(o.url, { busy: false, applied: true })
    } catch (e) {
      setRow(o.url, { busy: false, error: e instanceof Error ? e.message : 'Network error' })
    }
  }

  return (
    <Card
      actions={
        !notConnected ? (
          <Button
            buttonStyle="secondary"
            icon={<RefreshIcon />}
            margin={false}
            onClick={() => void load()}
            size="medium"
          >
            {s.refresh}
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
      {loading && !notConnected && <LoadingState label={s.loading} />}
      {!loading && !notConnected && opps && opps.length === 0 && <EmptyState title={s.none} />}

      {!notConnected && opps && opps.length > 0 && (
        <DataTable aria-label={s.title}>
          <thead>
            <tr>
              <th scope="col">{s.page}</th>
              <th className="seo-table__num" scope="col">
                {s.pos}
              </th>
              <th className="seo-table__num" scope="col">
                {s.ctr}
              </th>
              <th className="seo-table__num" scope="col">
                {s.potential}
              </th>
              <th scope="col">
                <span className="seo-ctr__sr-only">{s.optimize}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {opps.slice(0, 50).map((o) => {
              const rs = state[o.url] || {}
              const path = (() => { try { return new URL(o.url).pathname } catch { return o.url } })()
              return (
                <React.Fragment key={o.url}>
                  <tr>
                    <td className="seo-ctr__page" title={o.url}>
                      {path}
                    </td>
                    <td className="seo-table__num">{o.position.toFixed(1)}</td>
                    <td className="seo-table__num">
                      <span className="seo-text--danger">{(o.ctr * 100).toFixed(1)}%</span>
                      <span className="seo-text--secondary"> / {(o.expectedCtr * 100).toFixed(0)}% {s.expected}</span>
                    </td>
                    <td className="seo-table__num seo-text--strong seo-text--warning">+{o.potentialClicks}</td>
                    <td className="seo-table__num">
                      {rs.applied ? (
                        <TonePill tone="success">{s.applied}</TonePill>
                      ) : o.doc ? (
                        rs.suggestion ? (
                          <Button
                            buttonStyle="primary"
                            disabled={rs.busy}
                            margin={false}
                            onClick={() => void apply(o)}
                            size="medium"
                          >
                            {rs.busy ? s.optimizing : s.apply}
                          </Button>
                        ) : (
                          <Button
                            buttonStyle="secondary"
                            disabled={rs.busy}
                            margin={false}
                            onClick={() => void optimize(o)}
                            size="medium"
                          >
                            {rs.busy ? s.optimizing : s.optimize}
                          </Button>
                        )
                      ) : (
                        <Button
                          buttonStyle="secondary"
                          el="anchor"
                          icon={<NewTabIcon />}
                          iconPosition="right"
                          margin={false}
                          newTab
                          size="medium"
                          url={o.url}
                        >
                          {s.open}
                        </Button>
                      )}
                    </td>
                  </tr>
                  {rs.suggestion && !rs.applied && (
                    <tr>
                      <td colSpan={5}>
                        <div className="seo-inset seo-stack seo-stack--tight">
                          <span className="seo-text seo-text--small seo-text--strong seo-text--success">{rs.suggestion.metaTitle}</span>
                          <span className="seo-text seo-text--small seo-text--secondary">{rs.suggestion.metaDescription}</span>
                        </div>
                      </td>
                    </tr>
                  )}
                  {rs.error && (
                    <tr>
                      <td colSpan={5}>
                        <span className="seo-text seo-text--small seo-text--danger" role="alert">
                          {rs.error}
                        </span>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </DataTable>
      )}
    </Card>
  )
}
