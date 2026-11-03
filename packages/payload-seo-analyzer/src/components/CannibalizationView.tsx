'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Banner, Button, Collapsible, EditIcon, RefreshIcon, useConfig } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { useDashboardT } from '../hooks/useSeoLocale.js'
import type { DashboardTranslations } from '../dashboard-i18n.js'
import { toCsv } from '../helpers/csv.js'
import { DataTable, EmptyState, Grid, LoadingState, ScorePill, StatTile, TonePill, ViewBody, ViewHeader } from '../ui/index.js'
import { useSeoApi } from '../hooks/useSeoApi.js'
import './CannibalizationView.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PageEntry {
  id: number | string
  title: string
  slug: string
  collection: string
  score: number
}

interface Conflict {
  keyword: string
  pages: PageEntry[]
}

interface Stats {
  totalConflicts: number
  totalAffectedPages: number
}

// ---------------------------------------------------------------------------
// KeywordGroup sub-component
// ---------------------------------------------------------------------------
function KeywordGroup({ conflict, t }: { conflict: Conflict; t: DashboardTranslations }) {
  const {
    config: {
      routes: { admin: adminRoute },
    },
  } = useConfig()

  const severity = conflict.pages.length >= 3 ? 'high' : 'medium'
  const badgeLabel = severity === 'high' ? t.cannibalization.highRisk : t.cannibalization.warning

  return (
    <Collapsible
      className="seo-cannibalization__group"
      header={
        <span className="seo-row seo-row--nowrap">
          <span className="seo-text seo-text--strong">&quot;{conflict.keyword}&quot;</span>
          <TonePill tone={severity === 'high' ? 'danger' : 'warning'}>{badgeLabel}</TonePill>
          <span className="seo-text seo-text--small seo-text--secondary">
            {conflict.pages.length} {t.cannibalization.pages}
          </span>
        </span>
      }
    >
      <DataTable aria-label={conflict.keyword} bare>
        <thead>
          <tr>
            <th>{t.common.page}</th>
            <th>{t.seoView.collection}</th>
            <th>{t.seoView.slug}</th>
            <th className="seo-table__num">{t.seoView.score}</th>
            <th>
              <span className="seo-cannibalization__sr-only">{t.common.edit}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {conflict.pages.map((page) => (
            <tr key={`${page.collection}-${page.id}`}>
              <td>
                <span className="seo-text seo-text--strong seo-truncate seo-cannibalization__title" title={page.title}>
                  {page.title}
                </span>
              </td>
              <td>
                <TonePill tone={page.collection === 'pages' ? 'brand' : 'neutral'}>
                  {page.collection === 'pages' ? t.common.page : t.common.article}
                </TonePill>
              </td>
              <td>
                <span className="seo-mono seo-text--secondary" title={`/${page.slug}`}>
                  /{page.slug}
                </span>
              </td>
              <td className="seo-table__num">
                <ScorePill score={page.score} />
              </td>
              <td className="seo-table__num">
                <Button
                  aria-label={`${t.common.edit} — ${page.title}`}
                  buttonStyle="ghost"
                  el="link"
                  icon={<EditIcon />}
                  margin={false}
                  to={formatAdminURL({
                    adminRoute,
                    path: `/collections/${page.collection}/${page.id}`,
                  })}
                  tooltip={t.common.edit}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </Collapsible>
  )
}

// ---------------------------------------------------------------------------
// Main CannibalizationView component
// ---------------------------------------------------------------------------
export function CannibalizationView() {
  const seoApi = useSeoApi()
  const t = useDashboardT()

  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(seoApi('/cannibalization'), {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setConflicts(data.conflicts || [])
      setStats(data.stats || null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t.common.loadingError)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Filter conflicts by search
  const filteredConflicts = useMemo(() => {
    if (!search.trim()) return conflicts
    const q = search.toLowerCase()
    return conflicts.filter(
      (c) =>
        c.keyword.toLowerCase().includes(q) ||
        c.pages.some(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.slug.toLowerCase().includes(q),
        ),
    )
  }, [conflicts, search])

  // CSV export
  const handleExportCsv = useCallback(() => {
    const headers = [t.seoView.keyword, t.seoView.title, t.seoView.slug, t.seoView.collection, t.seoView.score]
    const rows: string[][] = []
    for (const conflict of filteredConflicts) {
      for (const page of conflict.pages) {
        rows.push([
          conflict.keyword,
          page.title,
          page.slug,
          page.collection,
          String(page.score),
        ])
      }
    }

    // toCsv neutralizes spreadsheet formulas — see helpers/csv.ts.
    const csv = toCsv([headers, ...rows])

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `seo-cannibalization-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filteredConflicts])

  // Loading state
  if (loading) {
    return (
      <>
        <ViewHeader description={t.cannibalization.subtitle} title={t.cannibalization.title} />
        <ViewBody>
          <LoadingState label={t.cannibalization.loading} />
        </ViewBody>
      </>
    )
  }

  // Error state
  if (error) {
    return (
      <>
        <ViewHeader description={t.cannibalization.subtitle} title={t.cannibalization.title} />
        <ViewBody>
          <Banner type="danger">
            <div className="seo-stack seo-stack--tight">
              <strong>{t.common.loadingError}</strong>
              <span>{error}</span>
            </div>
          </Banner>
          <div>
            <Button buttonStyle="secondary" margin={false} onClick={fetchData}>
              {t.common.retry}
            </Button>
          </div>
        </ViewBody>
      </>
    )
  }

  return (
    <>
      <ViewHeader
        actions={
          <>
            <Button buttonStyle="secondary" icon={<RefreshIcon />} iconPosition="left" margin={false} onClick={fetchData}>
              {t.common.refresh}
            </Button>
            <Button
              buttonStyle="secondary"
              disabled={filteredConflicts.length === 0}
              margin={false}
              onClick={handleExportCsv}
            >
              {t.common.exportCsv}
            </Button>
          </>
        }
        description={t.cannibalization.subtitle}
        title={t.cannibalization.title}
      />
      <ViewBody>
        {stats && (
          <Grid>
            <StatTile
              label={t.cannibalization.conflicts}
              tone={stats.totalConflicts > 0 ? 'danger' : 'success'}
              value={stats.totalConflicts}
            />
            <StatTile label={t.cannibalization.affectedPages} tone="warning" value={stats.totalAffectedPages} />
          </Grid>
        )}

        <input
          aria-label={t.cannibalization.searchPlaceholder}
          className="seo-input seo-cannibalization__search"
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.cannibalization.searchPlaceholder}
          type="text"
          value={search}
        />

        {filteredConflicts.length === 0 && (
          <EmptyState
            description={
              conflicts.length === 0 ? t.cannibalization.noCannibalizationDesc : t.cannibalization.noMatchingConflicts
            }
            title={conflicts.length === 0 ? t.cannibalization.noCannibalization : t.common.noResults}
          />
        )}

        {filteredConflicts.length > 0 && (
          <div className="seo-stack">
            {filteredConflicts.map((conflict) => (
              <KeywordGroup conflict={conflict} key={conflict.keyword} t={t} />
            ))}
          </div>
        )}
      </ViewBody>
    </>
  )
}
