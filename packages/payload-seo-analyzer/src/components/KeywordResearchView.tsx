'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Banner, Button, RefreshIcon } from '@payloadcms/ui'
import { useDashboardT, useSeoLocale } from '../hooks/useSeoLocale.js'
import { ContentBriefPanel } from './ContentBriefPanel.js'
import { toCsv } from '../helpers/csv.js'
import {
  DataTable,
  EmptyState,
  Grid,
  LoadingState,
  Meter,
  StatTile,
  TonePill,
  ViewBody,
  ViewHeader,
  type Tone,
} from '../ui/index.js'
import { useSeoApi } from '../hooks/useSeoApi.js'
import './KeywordResearchView.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SuggestionType = 'unused' | 'related' | 'trending' | 'long-tail'
type FilterTab = 'all' | SuggestionType

interface Suggestion {
  keyword: string
  type: SuggestionType
  score: number
  frequency: number
  currentlyUsedBy: string[]
  suggestedFor: string[]
}

interface Stats {
  totalKeywordsAnalyzed: number
  uniqueTerms: number
  suggestionsCount: number
}

// typeConfig and filterTabs are now created inside the component to support i18n

// ---------------------------------------------------------------------------
// ScoreBar sub-component
// ---------------------------------------------------------------------------

function ScoreBar({ score, label }: { score: number; label: string }) {
  const tone: Tone = score >= 70 ? 'success' : score >= 40 ? 'warning' : 'danger'
  return (
    <div className="seo-row seo-row--nowrap">
      <Meter aria-label={label} className="seo-keywords__meter" tone={tone} value={score} />
      <span className="seo-text seo-text--small seo-text--strong seo-keywords__score">{score}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ExpandableList sub-component
// ---------------------------------------------------------------------------

function ExpandableList({ items, label, seeLessLabel }: { items: string[]; label: string; seeLessLabel: string }) {
  const [expanded, setExpanded] = useState(false)

  if (items.length === 0) {
    return <span className="seo-text seo-text--small seo-text--tertiary">--</span>
  }

  const displayed = expanded ? items : items.slice(0, 2)
  const hasMore = items.length > 2

  return (
    <div className="seo-stack seo-stack--tight seo-keywords__list">
      {displayed.map((item, idx) => (
        <div className="seo-text seo-text--small seo-truncate" key={idx} title={item}>
          {item}
        </div>
      ))}
      {hasMore && (
        <button className="seo-keywords__more" onClick={() => setExpanded(!expanded)} type="button">
          {expanded ? seeLessLabel : `+${items.length - 2} ${label}`}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main KeywordResearchView component
// ---------------------------------------------------------------------------

export function KeywordResearchView() {
  const seoApi = useSeoApi()
  const locale = useSeoLocale()
  const t = useDashboardT()

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<FilterTab>('all')

  // i18n-aware type badge config
  const typeConfig: Record<SuggestionType, { label: string; tone: Tone }> = useMemo(() => ({
    unused: { label: t.keywordResearch.unused, tone: 'brand' },
    related: { label: t.keywordResearch.associated, tone: 'warning' },
    trending: { label: t.keywordResearch.trending, tone: 'neutral' },
    'long-tail': { label: t.keywordResearch.longTail, tone: 'success' },
  }), [t])

  // i18n-aware filter tabs
  const filterTabs: { key: FilterTab; label: string }[] = useMemo(() => [
    { key: 'all', label: t.keywordResearch.all },
    { key: 'unused', label: t.keywordResearch.unusedPlural },
    { key: 'related', label: t.keywordResearch.associatedPlural },
    { key: 'trending', label: t.keywordResearch.trendingPlural },
    { key: 'long-tail', label: t.keywordResearch.longTail },
  ], [t])

  // Fetch keyword research data
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(seoApi('/keyword-research'), {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSuggestions(data.suggestions || [])
      setStats(data.stats || null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t.common.loadingError)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Filtered suggestions
  const filteredSuggestions = useMemo(() => {
    let filtered = suggestions

    // Filter by tab
    if (activeTab !== 'all') {
      filtered = filtered.filter((s) => s.type === activeTab)
    }

    // Filter by search
    if (search.trim()) {
      const q = search.toLowerCase()
      filtered = filtered.filter(
        (s) =>
          s.keyword.toLowerCase().includes(q) ||
          s.currentlyUsedBy.some((t) => t.toLowerCase().includes(q)) ||
          s.suggestedFor.some((t) => t.toLowerCase().includes(q)),
      )
    }

    return filtered
  }, [suggestions, activeTab, search])

  // Tab counts
  const tabCounts = useMemo(() => {
    const counts: Record<FilterTab, number> = {
      all: suggestions.length,
      unused: 0,
      related: 0,
      trending: 0,
      'long-tail': 0,
    }
    for (const s of suggestions) {
      counts[s.type]++
    }
    return counts
  }, [suggestions])

  // CSV export
  const handleExportCsv = useCallback(() => {
    const headers = [
      t.keywordResearch.keyword,
      t.keywordResearch.type,
      t.keywordResearch.score,
      t.keywordResearch.frequency,
      t.keywordResearch.usedBy,
      t.keywordResearch.suggestedFor,
    ]
    const rows = filteredSuggestions.map((s) => [
      s.keyword,
      typeConfig[s.type]?.label || s.type,
      String(s.score),
      String(s.frequency),
      s.currentlyUsedBy.join(' | '),
      s.suggestedFor.join(' | '),
    ])

    // toCsv neutralizes spreadsheet formulas — see helpers/csv.ts.
    const csv = toCsv([headers, ...rows])

    const bom = '\uFEFF' // UTF-8 BOM for Excel
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `seo-keywords-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filteredSuggestions])

  // Loading state
  if (loading) {
    return (
      <>
        <ViewHeader description={t.keywordResearch.subtitle} title={t.keywordResearch.title} />
        <ViewBody>
          <LoadingState label={t.keywordResearch.loading} />
        </ViewBody>
      </>
    )
  }

  // Error state
  if (error) {
    return (
      <>
        <ViewHeader description={t.keywordResearch.subtitle} title={t.keywordResearch.title} />
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
              disabled={filteredSuggestions.length === 0}
              margin={false}
              onClick={handleExportCsv}
            >
              {t.common.exportCsv}
            </Button>
          </>
        }
        description={t.keywordResearch.subtitle}
        title={t.keywordResearch.title}
      />
      <ViewBody>
        {stats && (
          <Grid>
            <StatTile label={t.keywordResearch.activeKeywords} value={stats.totalKeywordsAnalyzed} />
            <StatTile label={t.keywordResearch.uniqueTerms} value={stats.uniqueTerms} />
            <StatTile label={t.keywordResearch.suggestions} tone="success" value={stats.suggestionsCount} />
          </Grid>
        )}

        {/* AI content brief (SEO 2026) */}
        <ContentBriefPanel locale={locale} />

        <div className="seo-row">
          {filterTabs.map((tab) => (
            // aria-pressed, not role="tab": these buttons FILTER one table, they
            // do not swap panels. Declaring a tablist with no tabpanel would
            // announce a structure that does not exist.
            <Button
              aria-pressed={activeTab === tab.key}
              buttonStyle="pill"
              key={tab.key}
              margin={false}
              onClick={() => setActiveTab(tab.key)}
              selected={activeTab === tab.key}
            >
              {tab.label} ({tabCounts[tab.key]})
            </Button>
          ))}
        </div>

        <input
          aria-label={t.keywordResearch.searchPlaceholder}
          className="seo-input seo-keywords__search"
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.keywordResearch.searchPlaceholder}
          type="text"
          value={search}
        />

        {filteredSuggestions.length === 0 && (
          <EmptyState
            description={
              suggestions.length === 0 ? t.keywordResearch.noSuggestionsDesc : t.keywordResearch.noMatchingSuggestions
            }
            title={suggestions.length === 0 ? t.keywordResearch.noSuggestions : t.common.noResults}
          />
        )}

        {filteredSuggestions.length > 0 && (
          <DataTable aria-label={t.keywordResearch.title}>
            <thead>
              <tr>
                <th>{t.keywordResearch.keyword}</th>
                <th>{t.keywordResearch.type}</th>
                <th>{t.keywordResearch.score}</th>
                <th className="seo-table__num">{t.keywordResearch.freq}</th>
                <th>{t.keywordResearch.usedBy}</th>
                <th>{t.keywordResearch.suggestedFor}</th>
              </tr>
            </thead>
            <tbody>
              {filteredSuggestions.map((suggestion, idx) => {
                const tc = typeConfig[suggestion.type]

                return (
                  <tr key={idx}>
                    <td>
                      <span
                        className="seo-text seo-text--strong seo-truncate seo-keywords__keyword"
                        title={suggestion.keyword}
                      >
                        {suggestion.keyword}
                      </span>
                    </td>
                    <td>
                      <TonePill tone={tc.tone}>{tc.label}</TonePill>
                    </td>
                    <td>
                      <ScoreBar label={t.keywordResearch.score} score={suggestion.score} />
                    </td>
                    <td className="seo-table__num">{suggestion.frequency}</td>
                    <td>
                      <ExpandableList
                        items={suggestion.currentlyUsedBy}
                        label="page(s)"
                        seeLessLabel={t.keywordResearch.seeLess}
                      />
                    </td>
                    <td>
                      <ExpandableList
                        items={suggestion.suggestedFor}
                        label="page(s)"
                        seeLessLabel={t.keywordResearch.seeLess}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </DataTable>
        )}
      </ViewBody>
    </>
  )
}
