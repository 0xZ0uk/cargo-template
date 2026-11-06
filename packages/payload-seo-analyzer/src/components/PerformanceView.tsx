'use client'

import React, { useCallback, useEffect, useMemo, useState, useId } from 'react'
import { Banner, Button, RefreshIcon, SortDownIcon, SortUpIcon, Tabs } from '@payloadcms/ui'
import { useDashboardT } from '../hooks/useSeoLocale.js'
import { Card, DataTable, EmptyState, Field, Grid, LoadingState, StatTile, ViewBody, ViewHeader, scoreTone, type Tone } from '../ui/index.js'
import { CoreWebVitalsPanel } from './CoreWebVitalsPanel.js'
import { HealthPanel } from './HealthPanel.js'
import { IndexationHygienePanel } from './IndexationHygienePanel.js'
import { ContentGradePanel } from './ContentGradePanel.js'
import { GscPanel } from './GscPanel.js'
import { RankTrackingPanel } from './RankTrackingPanel.js'
import { CtrOpportunitiesPanel } from './CtrOpportunitiesPanel.js'
import { AlertsPanel } from './AlertsPanel.js'
import { AltTextPanel } from './AltTextPanel.js'
import { toCsv } from '../helpers/csv.js'
import { useSeoApi } from '../hooks/useSeoApi.js'
import './PerformanceView.css'

// NOTE: xlsx (SheetJS) is loaded dynamically on the client side only.
// Known CVEs: CVE-2023-30533 (Prototype Pollution), CVE-2024-22363 (ReDoS).
// Risk is mitigated because parsing happens entirely in the browser (no server-side usage).
// The xlsx package is an optional peerDependency — users must install it separately
// to enable XLSX import functionality.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XLSXModule = any

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period = '7d' | '30d' | '90d'
type SortField = 'clicks' | 'impressions' | 'ctr' | 'position'
type SortDir = 'asc' | 'desc'

interface TopPage {
  url: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface TopQuery {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface Summary {
  totalClicks: number
  totalImpressions: number
  avgCtr: number
  avgPosition: number
}

interface ImportResult {
  imported: number
  updated: number
  errors: number
}

// ---------------------------------------------------------------------------
// Helper: sort array by field
// ---------------------------------------------------------------------------

function sortBy<T>(arr: T[], field: keyof T, dir: SortDir): T[] {
  return [...arr].sort((a, b) => {
    const va = a[field] as number
    const vb = b[field] as number
    return dir === 'asc' ? va - vb : vb - va
  })
}

// ---------------------------------------------------------------------------
// Tones for table cells and summary tiles
// ---------------------------------------------------------------------------

/** CTR (%) at or above 5 is good, at or above 2 is fair. */
const ctrTone = (ctr: number): Tone => scoreTone(ctr, { good: 5, ok: 2 })

/** Lower is better: top 10 is good, top 30 is fair. */
const positionTone = (position: number): Tone => (position <= 10 ? 'success' : position <= 30 ? 'warning' : 'danger')

const toneText = (tone: Tone) => `seo-text--${tone}`

// ---------------------------------------------------------------------------
// SortableTable header cell
// ---------------------------------------------------------------------------

function SortTh({
  label,
  field,
  currentSort,
  currentDir,
  onSort,
}: {
  label: string
  field: SortField
  currentSort: SortField
  currentDir: SortDir
  onSort: (f: SortField) => void
}) {
  const isActive = currentSort === field
  return (
    // aria-sort on the <th>, the click target as a real <button> INSIDE it:
    // moving the handler onto the cell itself would have cost the column
    // header its semantics for assistive technology.
    <th
      scope="col"
      aria-sort={isActive ? (currentDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className="seo-table__num"
    >
      <button type="button" onClick={() => onSort(field)}>
        {label}
        {isActive && (
          <span aria-hidden="true" className="seo-perf__sort">
            {currentDir === 'asc' ? <SortUpIcon /> : <SortDownIcon />}
          </span>
        )}
      </button>
    </th>
  )
}

// ---------------------------------------------------------------------------
// Main PerformanceView component
// ---------------------------------------------------------------------------

export function PerformanceView() {
  const seoApi = useSeoApi()
  const t = useDashboardT()
  const uid = useId()
  const fileId = `${uid}-import-file`
  const csvId = `${uid}-import-csv`
  const jsonId = `${uid}-import-json`
  const [period, setPeriod] = useState<Period>('30d')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [topPages, setTopPages] = useState<TopPage[]>([])
  const [topQueries, setTopQueries] = useState<TopQuery[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Import state
  const [csvText, setCsvText] = useState('')
  const [jsonText, setJsonText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)

  // Sort state for tables
  const [pageSortField, setPageSortField] = useState<SortField>('clicks')
  const [pageSortDir, setPageSortDir] = useState<SortDir>('desc')
  const [querySortField, setQuerySortField] = useState<SortField>('clicks')
  const [querySortDir, setQuerySortDir] = useState<SortDir>('desc')

  // Fetch performance data
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(seoApi(`/performance?period=${period}`), {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSummary(data.summary || null)
      setTopPages(data.topPages || [])
      setTopQueries(data.topQueries || [])
      setTruncated(data.truncated === true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t.common.loadingError)
    }
    setLoading(false)
  }, [period])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Handle file upload (CSV or XLSX)
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const isXlsx = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')

    if (isXlsx) {
      // Parse XLSX with SheetJS (dynamic import — client-side only)
      const reader = new FileReader()
      reader.onload = async (evt) => {
        try {
          // xlsx is an optional dependency the host may not install, so no bundler may
          // resolve it at build time: Vite fails the whole admin client bundle on an
          // unresolvable literal import. A plain `const` is not enough, because Vite's
          // dependency optimizer folds it back into a literal and drops the ignore hint;
          // the specifier is assembled at runtime instead. In the browser the import only
          // succeeds if the host maps `xlsx` (e.g. an import map); otherwise it throws and
          // the catch below resets the form.
          const xlsxSpecifier = ['xl', 'sx'].join('')
          const xlsxMod: XLSXModule = await import(
            /* @vite-ignore */ /* webpackIgnore: true */ xlsxSpecifier
          )
          const data = new Uint8Array(evt.target?.result as ArrayBuffer)
          const workbook = xlsxMod.read(data, { type: 'array' })

          const todayISO = new Date().toISOString().split('T')[0]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const allEntries: any[] = []

          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName]
            const rows = xlsxMod.utils.sheet_to_json(sheet) as Record<string, any>[]

            for (const row of rows) {
              // Normalize header keys to lowercase
              const normalized: Record<string, string> = {}
              for (const [k, v] of Object.entries(row)) {
                normalized[k.toLowerCase().trim()] = String(v ?? '').trim()
              }

              // Extract URL from various header formats
              const urlVal = normalized.url || normalized.page || normalized.pages || ''
              // Extract query
              const queryVal = normalized.query || normalized.queries
                || normalized['top queries'] || ''
              // Extract date
              const dateVal = normalized.date || ''

              // Need at least a URL or query
              if (!urlVal && !queryVal) continue

              // Parse CTR (remove % sign)
              const ctrRaw = normalized.ctr || '0'
              const ctr = parseFloat(ctrRaw.replace('%', '').replace(',', '.')) || 0

              allEntries.push({
                url: urlVal || '/',
                query: queryVal || undefined,
                clicks: parseFloat(normalized.clicks || '0') || 0,
                impressions: parseFloat(normalized.impressions || '0') || 0,
                ctr,
                position: parseFloat((normalized.position || '0').replace(',', '.')) || 0,
                date: dateVal || todayISO,
              })
            }
          }

          if (allEntries.length > 0) {
            // Set as JSON entries for import
            setJsonText(JSON.stringify(allEntries))
            setCsvText('')
          } else {
            setCsvText('')
            setJsonText('')
          }
        } catch {
          setCsvText('')
          setJsonText('')
        }
      }
      reader.readAsArrayBuffer(file)
    } else {
      // CSV/TSV — read as text
      const reader = new FileReader()
      reader.onload = (evt) => {
        setCsvText(evt.target?.result as string || '')
      }
      reader.readAsText(file, 'utf-8')
    }
  }, [])

  // Handle import
  const handleImport = useCallback(async () => {
    setImporting(true)
    setImportResult(null)
    setImportError(null)

    try {
      const body: Record<string, unknown> = {}

      if (csvText.trim()) {
        body.csv = csvText
      } else if (jsonText.trim()) {
        try {
          const parsed = JSON.parse(jsonText)
          if (Array.isArray(parsed)) {
            body.entries = parsed
          } else if (parsed.entries) {
            body.entries = parsed.entries
          }
        } catch {
          setImportError('Invalid JSON')
          setImporting(false)
          return
        }
      } else {
        setImportError(t.performance.noData)
        setImporting(false)
        return
      }

      const res = await fetch(seoApi('/performance'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      const result = await res.json()
      setImportResult(result)
      setCsvText('')
      setJsonText('')

      // Refresh data after import
      await fetchData()
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : t.common.loadingError)
    }
    setImporting(false)
  }, [csvText, jsonText, fetchData])

  // Sort handlers
  const handlePageSort = useCallback(
    (field: SortField) => {
      if (pageSortField === field) {
        setPageSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setPageSortField(field)
        setPageSortDir('desc')
      }
    },
    [pageSortField],
  )

  const handleQuerySort = useCallback(
    (field: SortField) => {
      if (querySortField === field) {
        setQuerySortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setQuerySortField(field)
        setQuerySortDir('desc')
      }
    },
    [querySortField],
  )

  // Sorted data
  const sortedPages = useMemo(
    () => sortBy(topPages, pageSortField, pageSortDir),
    [topPages, pageSortField, pageSortDir],
  )

  const sortedQueries = useMemo(
    () => sortBy(topQueries, querySortField, querySortDir),
    [topQueries, querySortField, querySortDir],
  )

  // Export CSV
  const handleExportCsv = useCallback(() => {
    const headers = ['URL', t.performance.clicks, t.performance.impressions, t.performance.ctrPercent, t.performance.position]
    const rows = sortedPages.map((p) => [p.url, p.clicks, p.impressions, p.ctr, p.position])

    // toCsv neutralizes spreadsheet formulas — see helpers/csv.ts.
    const csv = toCsv([headers, ...rows])

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `seo-performance-${period}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [sortedPages, period])

  // Has data?
  const hasData = topPages.length > 0 || topQueries.length > 0

  // Period labels
  const periodLabels: Record<Period, string> = {
    '7d': t.performance.days7,
    '30d': t.performance.days30,
    '90d': t.performance.days90,
  }

  const header = (actions?: React.ReactNode) => (
    <ViewHeader actions={actions} description={t.performance.subtitle} title={t.performance.title} />
  )

  // Loading state
  if (loading) {
    return (
      <>
        {header()}
        <ViewBody>
          <LoadingState label={t.performance.loading} />
        </ViewBody>
      </>
    )
  }

  // Error state
  if (error) {
    return (
      <>
        {header()}
        <ViewBody>
          <div role="alert">
            <Banner type="danger">
              <div className="seo-row seo-row--between">
                <div className="seo-stack seo-stack--tight">
                  <strong>{t.common.loadingError}</strong>
                  <span>{error}</span>
                </div>
                <Button buttonStyle="secondary" margin={false} onClick={fetchData} size="medium">
                  {t.common.retry}
                </Button>
              </div>
            </Banner>
          </div>
        </ViewBody>
      </>
    )
  }

  const canImport = !importing && Boolean(csvText.trim() || jsonText.trim())

  return (
    <>
      {header(
        <>
          <Button
            aria-expanded={showImport}
            buttonStyle="secondary"
            margin={false}
            onClick={() => setShowImport(!showImport)}
            size="medium"
          >
            {showImport ? t.performance.closeImport : t.performance.import}
          </Button>
          <Button buttonStyle="secondary" icon={<RefreshIcon />} margin={false} onClick={fetchData} size="medium">
            {t.common.refresh}
          </Button>
          {hasData && (
            <Button buttonStyle="secondary" margin={false} onClick={handleExportCsv} size="medium">
              {t.common.exportCsv}
            </Button>
          )}
        </>,
      )}

      <ViewBody>
        {truncated && (
          <div role="status">
            <Banner type="warning">{t.performance.truncatedNotice}</Banner>
          </div>
        )}

        {/* Period selector */}
        <Tabs<Period>
          onChange={setPeriod}
          tabs={(['7d', '30d', '90d'] as Period[]).map((p) => ({ label: periodLabels[p], value: p }))}
          value={period}
        />

        {/* SEO 2026 — module health, Core Web Vitals (PageSpeed), Google Search Console, rank tracking */}
        <HealthPanel />
        <IndexationHygienePanel />
        <CoreWebVitalsPanel />
        <GscPanel />
        <RankTrackingPanel />
        <CtrOpportunitiesPanel />
        <ContentGradePanel />
        <AlertsPanel />
        <AltTextPanel />

        {/* Import section */}
        {showImport && (
          <Card title={t.performance.importGscData}>
            <p className="seo-text seo-text--small seo-text--secondary">{t.performance.noDataDesc}</p>

            {/* File picker (CSV or XLSX) */}
            <Field label={t.performance.fileType}>
              <input
                id={fileId}
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls"
                onChange={handleFileUpload}
                className="seo-input"
              />
            </Field>

            {/* CSV textarea preview */}
            {csvText && (
              <Field label={`CSV (${csvText.split('\n').length} lines)`}>
                <textarea
                  id={csvId}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  rows={5}
                  className="seo-textarea seo-mono"
                />
              </Field>
            )}

            {/* XLSX parsed preview */}
            {!csvText && jsonText && (() => {
              try {
                const parsed = JSON.parse(jsonText)
                if (Array.isArray(parsed) && parsed.length > 0) {
                  const withUrl = parsed.filter((e: { url?: string }) => e.url && e.url !== '/')
                  const withQuery = parsed.filter((e: { query?: string }) => e.query)
                  return (
                    <Banner type="success">
                      <strong>{parsed.length}</strong> {t.performance.xlsxEntriesLoaded}
                      {withUrl.length > 0 && <span> &mdash; {withUrl.length} {t.performance.pages}</span>}
                      {withQuery.length > 0 && <span> &mdash; {withQuery.length} {t.performance.queries}</span>}
                    </Banner>
                  )
                }
              } catch { /* ignore */ }
              return null
            })()}

            {/* JSON textarea (alternative) */}
            {!csvText && !jsonText && (
              <Field label={t.performance.pasteJsonHint}>
                <textarea
                  id={jsonId}
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  placeholder={'[\n  { "url": "/page", "query": "your keyword", "clicks": 10, "impressions": 100, "ctr": 10, "position": 3.5, "date": "2025-01-15" }\n]'}
                  rows={4}
                  className="seo-textarea seo-mono"
                />
              </Field>
            )}

            {/* Import button */}
            <div className="seo-row">
              <Button buttonStyle="primary" disabled={!canImport} margin={false} onClick={handleImport} size="medium">
                {importing ? t.performance.importing : t.performance.import}
              </Button>
            </div>

            {/* Import result feedback */}
            {importResult && (
              <div role="status">
                <Banner type={importResult.errors > 0 ? 'warning' : 'success'}>
                  {importResult.imported} {t.performance.importedCount}, {importResult.updated} {t.performance.updatedCount}
                  {importResult.errors > 0 && (
                    <span>, {importResult.errors} {t.sitemapAudit.errors}</span>
                  )}
                </Banner>
              </div>
            )}
            {importError && (
              <div role="alert">
                <Banner type="danger">{importError}</Banner>
              </div>
            )}
          </Card>
        )}

        {/* No data empty state */}
        {!hasData && !showImport && (
          <Card>
            <EmptyState
              action={
                <Button buttonStyle="primary" margin={false} onClick={() => setShowImport(true)} size="medium">
                  {t.performance.importData}
                </Button>
              }
              description={t.performance.noDataDesc}
              title={t.performance.noData}
            />
          </Card>
        )}

        {/* Summary cards */}
        {hasData && summary && (
          <Grid>
            <StatTile label={t.performance.totalClicks} value={summary.totalClicks.toLocaleString('en-US')} />
            <StatTile label={t.performance.totalImpressions} value={summary.totalImpressions.toLocaleString('en-US')} />
            <StatTile label={t.performance.averageCtr} tone={ctrTone(summary.avgCtr)} value={`${summary.avgCtr}%`} />
            <StatTile label={t.performance.averagePosition} tone={positionTone(summary.avgPosition)} value={summary.avgPosition} />
          </Grid>
        )}

        {/* Top pages table */}
        {hasData && sortedPages.length > 0 && (
          <Card flush title={`${t.performance.topPages} (${sortedPages.length})`}>
            <DataTable aria-label={t.performance.topPages} bare>
              <thead>
                <tr>
                  <th scope="col">URL</th>
                  <SortTh
                    label={t.performance.clicks}
                    field="clicks"
                    currentSort={pageSortField}
                    currentDir={pageSortDir}
                    onSort={handlePageSort}
                  />
                  <SortTh
                    label={t.performance.impressions}
                    field="impressions"
                    currentSort={pageSortField}
                    currentDir={pageSortDir}
                    onSort={handlePageSort}
                  />
                  <SortTh
                    label={t.performance.ctrPercent}
                    field="ctr"
                    currentSort={pageSortField}
                    currentDir={pageSortDir}
                    onSort={handlePageSort}
                  />
                  <SortTh
                    label={t.performance.position}
                    field="position"
                    currentSort={pageSortField}
                    currentDir={pageSortDir}
                    onSort={handlePageSort}
                  />
                </tr>
              </thead>
              <tbody>
                {sortedPages.map((page, idx) => (
                  <tr key={idx}>
                    <td className="seo-perf__key seo-text--strong" title={page.url}>
                      {page.url}
                    </td>
                    <td className="seo-table__num seo-text--strong">{page.clicks.toLocaleString('en-US')}</td>
                    <td className="seo-table__num">{page.impressions.toLocaleString('en-US')}</td>
                    <td className={`seo-table__num seo-text--strong ${toneText(ctrTone(page.ctr))}`}>{page.ctr}%</td>
                    <td className={`seo-table__num seo-text--strong ${toneText(positionTone(page.position))}`}>{page.position}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Card>
        )}

        {/* Top queries table */}
        {hasData && sortedQueries.length > 0 && (
          <Card flush title={`${t.performance.topQueries} (${sortedQueries.length})`}>
            <DataTable aria-label={t.performance.topQueries} bare>
              <thead>
                <tr>
                  <th scope="col">{t.performance.query}</th>
                  <SortTh
                    label={t.performance.clicks}
                    field="clicks"
                    currentSort={querySortField}
                    currentDir={querySortDir}
                    onSort={handleQuerySort}
                  />
                  <SortTh
                    label={t.performance.impressions}
                    field="impressions"
                    currentSort={querySortField}
                    currentDir={querySortDir}
                    onSort={handleQuerySort}
                  />
                  <SortTh
                    label={t.performance.ctrPercent}
                    field="ctr"
                    currentSort={querySortField}
                    currentDir={querySortDir}
                    onSort={handleQuerySort}
                  />
                  <SortTh
                    label={t.performance.position}
                    field="position"
                    currentSort={querySortField}
                    currentDir={querySortDir}
                    onSort={handleQuerySort}
                  />
                </tr>
              </thead>
              <tbody>
                {sortedQueries.map((q, idx) => (
                  <tr key={idx}>
                    <td className="seo-perf__key seo-text--strong" title={q.query}>
                      {q.query}
                    </td>
                    <td className="seo-table__num seo-text--strong">{q.clicks.toLocaleString('en-US')}</td>
                    <td className="seo-table__num">{q.impressions.toLocaleString('en-US')}</td>
                    <td className={`seo-table__num seo-text--strong ${toneText(ctrTone(q.ctr))}`}>{q.ctr}%</td>
                    <td className={`seo-table__num seo-text--strong ${toneText(positionTone(q.position))}`}>{q.position}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Card>
        )}
      </ViewBody>
    </>
  )
}
