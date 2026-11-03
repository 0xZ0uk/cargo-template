'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Banner, Button, RefreshIcon } from '@payloadcms/ui'
import { Card, Checklist, Grid, LoadingState, StatTile, TonePill, scoreTone, type Tone } from '../ui/index.js'
import { useSeoApi } from '../hooks/useSeoApi.js'

interface PageOption {
  id: string | number
  collection: string
  title: string
  slug: string
}
interface CoverageGap {
  query: string
  impressions: number
  position: number
  missingTerms?: string[]
  nearTop?: boolean
}
interface CtrGap {
  query: string
  ctr: number
  expectedCtr: number
  position: number
}
interface ContentGradeResponse {
  gscConnected: boolean
  message?: string
  grade?: string
  score?: number
  subScores?: { coverage?: number; ctr?: number; position?: number }
  weightedPosition?: number
  coverageGaps?: CoverageGap[]
  ctrGaps?: CtrGap[]
  recommendations?: string[]
}

const S = {
  fr: {
    title: 'Content Grade (couverture GSC)',
    subtitle: 'Note de couverture par page à partir des requêtes Google Search Console réelles — sans API SERP payante.',
    selectPage: 'Choisir une page…',
    loadingPages: 'Chargement des pages…',
    grading: 'Analyse de la couverture…',
    needGsc: 'Connectez Google Search Console pour activer le Content Grade.',
    noPages: 'Aucune page à analyser.',
    coverageGaps: 'Requêtes mal couvertes (à enrichir)',
    missing: 'termes manquants',
    nearTop: 'proche du top',
    ctrGaps: 'Requêtes à fort potentiel CTR',
    recommendations: 'Recommandations',
    coverage: 'Couverture',
    ctr: 'CTR',
    position: 'Position',
    refresh: 'Rafraîchir',
    grade: 'Note',
  },
  en: {
    title: 'Content Grade (GSC coverage)',
    subtitle: 'Per-page coverage grade from real Google Search Console queries — no paid SERP API.',
    selectPage: 'Pick a page…',
    loadingPages: 'Loading pages…',
    grading: 'Analyzing coverage…',
    needGsc: 'Connect Google Search Console to enable Content Grade.',
    noPages: 'No page to analyze.',
    coverageGaps: 'Poorly covered queries (enrich these)',
    missing: 'missing terms',
    nearTop: 'near top',
    ctrGaps: 'High-CTR-potential queries',
    recommendations: 'Recommendations',
    coverage: 'Coverage',
    ctr: 'CTR',
    position: 'Position',
    refresh: 'Refresh',
    grade: 'Grade',
  },
} as const

function gradeTone(grade?: string): Tone {
  if (!grade) return 'neutral'
  if (grade === 'A' || grade === 'B') return 'success'
  if (grade === 'C') return 'warning'
  return 'danger'
}

export function ContentGradePanel({ locale }: { locale: 'fr' | 'en' }) {
  const seoApi = useSeoApi()
  const s = S[locale] ?? S.fr
  const [pages, setPages] = useState<PageOption[]>([])
  const [pagesLoading, setPagesLoading] = useState(true)
  const [selected, setSelected] = useState<string>('')
  const [data, setData] = useState<ContentGradeResponse | null>(null)
  const [grading, setGrading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPages = useCallback(async () => {
    setPagesLoading(true)
    try {
      const res = await fetch(seoApi('/audit'), { credentials: 'include', cache: 'no-store' })
      const json = await res.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results: any[] = Array.isArray(json.results) ? json.results : []
      setPages(
        results
          .filter((r) => r && r.id != null && r.collection && !String(r.collection).startsWith('global:'))
          .map((r) => ({ id: r.id, collection: r.collection, title: r.title || r.slug || String(r.id), slug: r.slug || '' })),
      )
    } catch {
      /* non-blocking — the page list is a convenience */
    } finally {
      setPagesLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPages()
  }, [loadPages])

  const grade = useCallback(async (value: string) => {
    if (!value) return
    const [collection, id] = value.split('::')
    setGrading(true)
    setError(null)
    setData(null)
    try {
      const res = await fetch(
        seoApi(`/content-grade?collection=${encodeURIComponent(collection)}&id=${encodeURIComponent(id)}`),
        { credentials: 'include', cache: 'no-store' },
      )
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || `Error ${res.status}`)
        return
      }
      setData(json as ContentGradeResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setGrading(false)
    }
  }, [])

  const onSelect = (value: string) => {
    setSelected(value)
    void grade(value)
  }

  return (
    <Card
      actions={
        selected && !grading ? (
          <Button buttonStyle="secondary" icon={<RefreshIcon />} margin={false} onClick={() => void grade(selected)} size="medium">
            {s.refresh}
          </Button>
        ) : undefined
      }
      title={s.title}
    >
      <p className="seo-text seo-text--small seo-text--secondary">{s.subtitle}</p>

      <div className="seo-row">
        <select
          aria-label={s.selectPage}
          className="seo-select seo-select--inline"
          disabled={pagesLoading}
          onChange={(e) => onSelect(e.target.value)}
          value={selected}
        >
          <option value="">{pagesLoading ? s.loadingPages : pages.length === 0 ? s.noPages : s.selectPage}</option>
          {pages.map((p) => (
            <option key={`${p.collection}::${p.id}`} value={`${p.collection}::${p.id}`}>
              {p.title} — {p.collection}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div role="alert">
          <Banner type="danger">{error}</Banner>
        </div>
      )}
      {grading && <LoadingState label={s.grading} />}

      {!grading && data && data.gscConnected === false && <Banner type="default">{data.message || s.needGsc}</Banner>}

      {!grading && data && data.gscConnected !== false && (
        <>
          <Grid>
            <StatTile label={s.grade} tone={gradeTone(data.grade)} value={data.grade ?? '—'} />
            {typeof data.score === 'number' && (
              <StatTile label="Score /100" tone={scoreTone(data.score)} value={Math.round(data.score)} />
            )}
            {data.subScores?.coverage != null && (
              <StatTile label={s.coverage} tone={scoreTone(data.subScores.coverage)} value={Math.round(data.subScores.coverage)} />
            )}
            {data.weightedPosition != null && (
              <StatTile
                label={s.position}
                tone={data.weightedPosition <= 10 ? 'success' : data.weightedPosition <= 30 ? 'warning' : 'danger'}
                value={data.weightedPosition.toFixed(1)}
              />
            )}
          </Grid>

          {data.coverageGaps && data.coverageGaps.length > 0 && (
            <section className="seo-stack seo-stack--tight">
              <h4 className="seo-text seo-text--strong">{s.coverageGaps}</h4>
              <Checklist
                items={data.coverageGaps.slice(0, 10).map((g, i) => ({
                  id: `${g.query || i}`,
                  tone: 'warning',
                  content: (
                    <span className="seo-row seo-text seo-text--small">
                      <span className="seo-text--strong">{g.query}</span>
                      {g.nearTop && <TonePill tone="warning">{s.nearTop}</TonePill>}
                      {g.missingTerms && g.missingTerms.length > 0 && (
                        <span className="seo-text--danger">
                          {s.missing}: {g.missingTerms.slice(0, 5).join(', ')}
                        </span>
                      )}
                    </span>
                  ),
                }))}
              />
            </section>
          )}

          {data.recommendations && data.recommendations.length > 0 && (
            <section className="seo-stack seo-stack--tight">
              <h4 className="seo-text seo-text--strong">{s.recommendations}</h4>
              <Checklist
                items={data.recommendations.slice(0, 8).map((r, i) => ({
                  id: String(i),
                  tone: 'brand',
                  content: <span className="seo-text seo-text--small">{r}</span>,
                }))}
              />
            </section>
          )}
        </>
      )}
    </Card>
  )
}
