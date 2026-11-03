'use client'

import React, { useEffect, useState, useMemo, useCallback, useId } from 'react'
import {
  Banner,
  Button,
  CheckIcon,
  ChevronIcon,
  EditIcon,
  Link,
  RefreshIcon,
  SearchIcon,
  SortDownIcon,
  SortUpIcon,
  XIcon,
  useConfig,
} from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { ContentDecaySection } from './ContentDecaySection.js'
import { useDashboardT, useSeoLocale } from '../hooks/useSeoLocale.js'
import { escapeHtml } from '../helpers/escapeHtml.js'
import type { DashboardTranslations } from '../dashboard-i18n.js'
import { toCsv } from '../helpers/csv.js'
import { LiveRegion } from './LiveRegion.js'
import {
  DataTable,
  EmptyState,
  Grid,
  LoadingState,
  ScorePill,
  StatTile,
  TonePill,
  ViewBody,
  ViewHeader,
  cx,
  scoreTone,
  type Tone,
} from '../ui/index.js'
import { usePayloadApi, useSeoApi } from '../hooks/useSeoApi.js'
import './SeoView.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AuditItem {
  id: number | string
  collection: string
  title: string
  slug: string
  metaTitle: string
  metaDescription: string
  focusKeyword: string
  focusKeywords: string[]
  hasOgImage: boolean
  wordCount: number
  readingTime: number
  readabilityScore: number
  internalLinkCount: number
  externalLinkCount: number
  headingCount: number
  hasH1: boolean
  h1Count: number
  score: number
  previousScore?: number | null
  aiReadiness?: number | null
  level: string
  status: string
  updatedAt: string
  isCornerstone: boolean
  contentLastReviewed: string
  daysSinceUpdate: number | null
}

interface AuditStats {
  totalPages: number
  avgScore: number
  good: number
  needsWork: number
  critical: number
  noKeyword: number
  noMetaTitle: number
  noMetaDesc: number
  avgWordCount: number
  avgReadability: number
}

type SortKey =
  | 'title'
  | 'score'
  | 'wordCount'
  | 'readabilityScore'
  | 'focusKeyword'
  | 'collection'
  | 'updatedAt'
  | 'h1Count'
  | 'internalLinkCount'

type QuickFilter = 'none' | 'noMeta' | 'noH1' | 'lowReadability'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Text class for a tone (`seo-text--success`…), secondary text for neutral. */
function toneText(tone: Tone): string {
  return tone === 'neutral' ? 'seo-text--secondary' : `seo-text--${tone}`
}

/** Largest page `/audit` serves (its `limit` is clamped to 500). */
const AUDIT_PAGE_LIMIT = 500

interface AuditPage {
  results?: AuditItem[]
  notBuilt?: boolean
  pagination?: { page: number; totalPages: number }
}

/**
 * `/audit` returns one page of results. Fetch the remaining pages of the cached audit
 * (`noBuild=1`: never start a build) and return every result. If the cache is dropped
 * mid-way (a save invalidated it), stop and keep what was loaded.
 */
export async function loadRemainingAuditPages(first: AuditPage, base: string): Promise<AuditItem[]> {
  const items = [...(first.results ?? [])]
  const totalPages = first.pagination?.totalPages ?? 1
  for (let page = (first.pagination?.page ?? 1) + 1; page <= totalPages; page++) {
    const res = await fetch(`${base}&noBuild=1&page=${page}`, { credentials: 'include', cache: 'no-store' })
    if (!res.ok) break
    const data = (await res.json()) as AuditPage
    if (data.notBuilt || !data.results?.length) break
    items.push(...data.results)
  }
  return items
}

function itemKey(item: AuditItem): string {
  return `${item.collection}::${item.id}`
}

/** Number of columns in the audit table (the inline edit row spans all of them). */
const COLUMN_COUNT = 13

// ---------------------------------------------------------------------------
// SortHeader sub-component
// ---------------------------------------------------------------------------
function SortHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
  numeric,
}: {
  label: string
  sortKey: SortKey
  currentSort: SortKey
  currentDir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
  numeric?: boolean
}) {
  const isActive = currentSort === sortKey
  return (
    <th
      aria-sort={isActive ? (currentDir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cx(numeric && 'seo-table__num')}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cx('seo-audit__sort', isActive && 'seo-audit__sort--active')}
      >
        {label}
        {isActive && (currentDir === 'asc' ? <SortUpIcon /> : <SortDownIcon />)}
      </button>
    </th>
  )
}

// ---------------------------------------------------------------------------
// InlineEditPanel sub-component (B3)
// ---------------------------------------------------------------------------
function InlineEditPanel({
  item,
  onSave,
  onCancel,
  saving,
  t,
}: {
  item: AuditItem
  onSave: (metaTitle: string, metaDescription: string) => void
  onCancel: () => void
  saving: boolean
  t: DashboardTranslations
}) {
  // One panel is rendered per expanded row: literal ids would collide the moment
  // two rows are open at once.
  const uid = useId()
  const titleId = `${uid}-meta-title`
  const descId = `${uid}-meta-desc`
  const [metaTitle, setMetaTitle] = useState(item.metaTitle || '')
  const [metaDescription, setMetaDescription] = useState(item.metaDescription || '')

  const titleLen = metaTitle.length
  const descLen = metaDescription.length
  const titleOk = titleLen > 0 && titleLen <= 60
  const descOk = descLen > 0 && descLen <= 160

  return (
    <tr className="seo-audit__edit-row">
      {/* Span entire row */}
      <td colSpan={COLUMN_COUNT}>
        <div className="seo-stack">
          {/* Meta title */}
          <div className="seo-field">
            <div className="seo-row seo-row--between">
              <label className="seo-field__label" htmlFor={titleId}>
                {t.seoView.metaTitle}
              </label>
              <span className={cx('seo-text seo-text--small seo-text--strong', toneText(titleOk ? 'success' : 'danger'))}>
                {titleLen}/60
              </span>
            </div>
            <input
              id={titleId}
              type="text"
              value={metaTitle}
              onChange={(e) => setMetaTitle(e.target.value)}
              maxLength={70}
              className={cx('seo-input', !titleOk && 'seo-audit__input--invalid')}
            />
          </div>

          {/* Meta description */}
          <div className="seo-field">
            <div className="seo-row seo-row--between">
              <label className="seo-field__label" htmlFor={descId}>
                {t.seoView.metaDesc}
              </label>
              <span className={cx('seo-text seo-text--small seo-text--strong', toneText(descOk ? 'success' : 'danger'))}>
                {descLen}/160
              </span>
            </div>
            <textarea
              id={descId}
              value={metaDescription}
              onChange={(e) => setMetaDescription(e.target.value)}
              maxLength={170}
              rows={2}
              className={cx('seo-textarea', !descOk && 'seo-audit__input--invalid')}
            />
          </div>

          {/* Buttons */}
          <div className="seo-audit__actions">
            <Button buttonStyle="secondary" onClick={onCancel}>
              {t.common.cancel}
            </Button>
            <Button buttonStyle="primary" disabled={saving} onClick={() => onSave(metaTitle, metaDescription)}>
              {saving ? t.common.saving : t.common.save}
            </Button>
          </div>
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// TableRow sub-component
// ---------------------------------------------------------------------------
function TableRow({
  item,
  selected,
  onToggle,
  expanded,
  onRowClick,
  t,
  locale,
  adminRoute,
}: {
  item: AuditItem
  selected: boolean
  onToggle: () => void
  expanded: boolean
  onRowClick: () => void
  t: DashboardTranslations
  locale: string
  adminRoute: string
}) {
  // A2: Meta missing badges
  const missingMeta = !item.metaTitle || !item.metaDescription
  const editHref = formatAdminURL({
    adminRoute,
    path: `/collections/${item.collection}/${item.id}` as `/${string}`,
  })

  return (
    <tr
      onClick={(e) => {
        // B3: Don't toggle expand when clicking checkbox or edit
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.closest('[data-edit-link]')) return
        onRowClick()
      }}
      className={cx('seo-audit__row', expanded && 'seo-audit__row--expanded')}
    >
      {/* B1: Checkbox */}
      <td className="cell-_select" onClick={(e) => e.stopPropagation()}>
        <div className="select-row">
          <input
            type="checkbox"
            aria-label={item.title || item.slug}
            checked={selected}
            onChange={onToggle}
            className="seo-audit__check"
          />
        </div>
      </td>

      {/* Title + slug + A2 meta badges.
          The row keeps its click handler as a mouse convenience, but the
          title is a real <button>: it is what makes the expand/collapse
          reachable from the keyboard. The row itself must NOT become a button —
          it already contains a checkbox and an edit link, and interactive
          elements cannot nest. */}
      <td className="seo-audit__page">
        <div className="seo-audit__title-row">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRowClick()
            }}
            aria-expanded={expanded}
            className="cell-link seo-audit__title"
          >
            {item.title || t.common.noTitle}
          </button>
          {item.isCornerstone && <TonePill tone="brand">{t.seoView.cornerstone}</TonePill>}
        </div>
        <div className="seo-row seo-row--nowrap seo-text seo-text--small seo-text--secondary">
          <TonePill tone="neutral">{item.collection === 'pages' ? t.common.page : t.common.article}</TonePill>
          <span className="seo-truncate">/{item.slug}</span>
        </div>
        {/* A2: Missing meta badges */}
        {missingMeta && (
          <div className="seo-row seo-audit__missing">
            {!item.metaTitle && <TonePill tone="danger">{t.seoView.metaTitle}</TonePill>}
            {!item.metaDescription && <TonePill tone="danger">{t.seoView.metaDesc}</TonePill>}
          </div>
        )}
      </td>

      {/* Collection */}
      <td className="seo-text--secondary">{item.collection}</td>

      {/* Score + A6 trend */}
      <td>
        <div className="seo-row seo-row--nowrap">
          <ScorePill score={item.score} />
          {/* A6: Score trend indicator */}
          {item.previousScore != null && item.previousScore !== item.score && (
            <span
              title={`${t.seoView.previousLabel} ${item.previousScore}`}
              className={cx('seo-text--strong', toneText(item.score > item.previousScore ? 'success' : 'danger'))}
            >
              {item.score > item.previousScore ? '\u2191' : '\u2193'}
            </span>
          )}
          {/* AI-readiness sub-score (SEO 2026) */}
          {item.aiReadiness != null && (
            <span
              title={t.seoAnalyzer.aiReadinessTooltip}
              className={cx('seo-text--small seo-text--strong seo-audit__nowrap', toneText(scoreTone(item.aiReadiness)))}
            >
              {t.seoAnalyzer.aiReadiness} {item.aiReadiness}
            </span>
          )}
        </div>
      </td>

      {/* Focus keyword + A5 multi-keyword */}
      <td className="seo-audit__keyword">
        <div className={cx('seo-truncate', item.focusKeyword ? 'seo-text--strong' : 'seo-text--danger')}>
          {item.focusKeyword || t.common.none}
        </div>
        {/* A5: Secondary keywords */}
        {item.focusKeywords && item.focusKeywords.length > 0 && (
          <div>
            {item.focusKeywords.map((kw, i) => (
              <div className="seo-truncate seo-text seo-text--small seo-text--secondary" key={i}>
                +{kw}
              </div>
            ))}
          </div>
        )}
      </td>

      {/* A1: H1 count */}
      <td>
        <TonePill tone={item.h1Count === 1 ? 'success' : 'danger'}>{item.h1Count}</TonePill>
      </td>

      {/* A1: OG image */}
      <td>
        {item.hasOgImage ? (
          <span className={toneText('success')}>
            <CheckIcon size={16} />
          </span>
        ) : (
          <span className={toneText('danger')}>
            <XIcon size={16} />
          </span>
        )}
      </td>

      {/* A1: Internal links */}
      <td className="seo-table__num seo-text--secondary">{item.internalLinkCount}</td>

      {/* A1: External links */}
      <td className="seo-table__num seo-text--secondary">{item.externalLinkCount}</td>

      {/* Word count */}
      <td className="seo-table__num seo-text--secondary">{item.wordCount}</td>

      {/* Readability */}
      <td
        className={cx(
          'seo-table__num seo-text--strong',
          toneText(scoreTone(item.readabilityScore, { good: 60, ok: 40 })),
        )}
      >
        {item.readabilityScore > 0 ? item.readabilityScore : '-'}
      </td>

      {/* Updated at */}
      <td className="seo-table__num seo-text--secondary">
        {item.updatedAt ? new Date(item.updatedAt).toLocaleDateString(locale) : '-'}
      </td>

      {/* Edit link */}
      <td data-edit-link>
        {/* A real link (<a href>): it restores keyboard activation, middle-click,
            "open in new tab" and the status bar. */}
        <Link
          href={editHref}
          title={t.common.edit}
          aria-label={`${t.common.edit} — ${item.title || item.slug}`}
          onClick={(e) => e.stopPropagation()}
          className="seo-audit__edit"
        >
          <EditIcon />
        </Link>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Bulk AI optimize — one preview row (before → after)
interface BulkPreviewRow {
  collection: string
  id: string
  title: string
  before: { metaTitle: string; metaDescription: string; focusKeyword: string }
  after: { metaTitle: string; metaDescription: string; focusKeyword: string }
  changed: boolean
  applied: boolean
  error?: string
}

// BulkActionBar sub-component (B2)
// ---------------------------------------------------------------------------
function BulkActionBar({
  count,
  onDeselectAll,
  onExportCsv,
  onMarkCornerstone,
  onUnmarkCornerstone,
  onOptimizeMeta,
  optimizing,
  t,
}: {
  count: number
  onDeselectAll: () => void
  onExportCsv: () => void
  onMarkCornerstone: () => void
  onUnmarkCornerstone: () => void
  onOptimizeMeta: () => void
  optimizing: boolean
  t: DashboardTranslations
}) {
  if (count === 0) return null

  return (
    <div className="seo-audit__bulk">
      <div className="seo-row">
        <span className="seo-text seo-text--strong">
          {count} {t.common.selected}{count > 1 ? 's' : ''}
        </span>
        <Button buttonStyle="secondary" onClick={onDeselectAll}>
          {t.common.deselectAll}
        </Button>
      </div>
      <div className="seo-row">
        <Button buttonStyle="secondary" onClick={onExportCsv}>
          {t.common.exportCsv}
        </Button>
        <Button
          buttonStyle="primary"
          disabled={optimizing}
          onClick={() => { if (!optimizing) onOptimizeMeta() }}
        >
          {optimizing ? t.seoView.bulkOptimizing : t.seoView.bulkOptimizeMeta}
        </Button>
        <Button buttonStyle="secondary" onClick={onMarkCornerstone}>
          {t.seoView.markCornerstone}
        </Button>
        <Button buttonStyle="secondary" onClick={onUnmarkCornerstone}>
          {t.seoView.unmarkCornerstone}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main SeoView component
// ---------------------------------------------------------------------------
export function SeoView() {
  const payloadApi = usePayloadApi()
  const seoApi = useSeoApi()
  const locale = useSeoLocale()
  const t = useDashboardT()
  const {
    config: {
      routes: { admin: adminRoute },
    },
  } = useConfig()
  const [items, setItems] = useState<AuditItem[]>([])
  const [stats, setStats] = useState<AuditStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [building, setBuilding] = useState(false)
  const [notBuilt, setNotBuilt] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [scoreFilter, setScoreFilter] = useState<'all' | 'good' | 'needsWork' | 'critical'>('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [currentPage, setCurrentPage] = useState(1)
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('none')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [bulkOptimizing, setBulkOptimizing] = useState(false)
  const [bulkApplying, setBulkApplying] = useState(false)
  const [bulkApplied, setBulkApplied] = useState(false)
  const [bulkPreview, setBulkPreview] = useState<{ results: BulkPreviewRow[]; capped: boolean; total: number } | null>(null)
  const PAGE_SIZE = 50

  // mode: 'peek' reads the cache WITHOUT triggering a build (dashboard open — never auto-builds,
  //       which is heavy on large/rich sites); 'run' triggers the throttled background build and
  //       polls; 'refresh' drops the cache and rebuilds.
  const fetchAudit = useCallback(async (mode: 'peek' | 'run' | 'refresh' = 'run') => {
    setLoading(true)
    setError(null)
    setBuilding(false)
    setNotBuilt(false)
    try {
      // The endpoint pages its results (max 500 per request); the first request asks for the
      // largest page, and `loadRemainingAuditPages` fetches the rest so filters, counts and
      // exports cover every analyzed page.
      const base = seoApi(`/audit?limit=${AUDIT_PAGE_LIMIT}`)
      const firstUrl =
        mode === 'peek' ? `${base}&noBuild=1` : mode === 'refresh' ? `${base}&nocache=1` : base
      let res = await fetch(firstUrl, { credentials: 'include', cache: 'no-store' })

      // Peek (dashboard open) never triggers a build: show the "run" CTA when nothing is cached
      // yet. (If a build is already running, the server returns 202 → fall through and poll it.)
      if (mode === 'peek' && res.status === 200) {
        const data = await res.json()
        if (data.notBuilt) setNotBuilt(true)
        else {
          setItems(await loadRemainingAuditPages(data, base))
          setStats(data.stats || null)
        }
        setLoading(false)
        return
      }

      let attempts = 0
      const MAX_POLLS = 90 // ~4.5 min at 3s — enough for very large sites
      // While building, the server returns 202. A transient 429 (rate limit) during a long build
      // is also non-fatal — back off and keep polling rather than surfacing an error.
      while ((res.status === 202 || res.status === 429) && attempts < MAX_POLLS) {
        setBuilding(true)
        await new Promise((r) => setTimeout(r, res.status === 429 ? 6000 : 3000))
        res = await fetch(base, { credentials: 'include', cache: 'no-store' })
        attempts++
      }
      if (res.status === 202 || res.status === 429) throw new Error(t.seoView.buildTimeout)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setItems(await loadRemainingAuditPages(data, base))
      setStats(data.stats || null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t.common.loadingError)
    }
    setBuilding(false)
    setLoading(false)
  }, [t])

  useEffect(() => {
    // Dashboard open = peek only (no auto-build).
    fetchAudit('peek')
  }, [fetchAudit])

  const collections = useMemo(() => {
    const set = new Set(items.map((i) => i.collection))
    return Array.from(set).sort()
  }, [items])

  // A4: Quick filter counts
  const quickFilterCounts = useMemo(() => {
    return {
      noMeta: items.filter((i) => !i.metaTitle || !i.metaDescription).length,
      noH1: items.filter((i) => i.h1Count !== 1).length,
      lowReadability: items.filter((i) => i.readabilityScore > 0 && i.readabilityScore < 40).length,
    }
  }, [items])

  const filteredItems = useMemo(() => {
    let result = [...items]

    if (filter !== 'all') {
      result = result.filter((i) => i.collection === filter)
    }
    if (scoreFilter === 'good') result = result.filter((i) => i.score >= 80)
    else if (scoreFilter === 'needsWork')
      result = result.filter((i) => i.score >= 50 && i.score < 80)
    else if (scoreFilter === 'critical') result = result.filter((i) => i.score < 50)

    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.slug.toLowerCase().includes(q) ||
          i.focusKeyword.toLowerCase().includes(q),
      )
    }

    // A4: Apply quick filter
    if (quickFilter === 'noMeta') {
      result = result.filter((i) => !i.metaTitle || !i.metaDescription)
    } else if (quickFilter === 'noH1') {
      result = result.filter((i) => i.h1Count !== 1)
    } else if (quickFilter === 'lowReadability') {
      result = result.filter((i) => i.readabilityScore > 0 && i.readabilityScore < 40)
    }

    result.sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'title':
          cmp = a.title.localeCompare(b.title)
          break
        case 'score':
          cmp = a.score - b.score
          break
        case 'wordCount':
          cmp = a.wordCount - b.wordCount
          break
        case 'readabilityScore':
          cmp = a.readabilityScore - b.readabilityScore
          break
        case 'focusKeyword':
          cmp = a.focusKeyword.localeCompare(b.focusKeyword)
          break
        case 'collection':
          cmp = a.collection.localeCompare(b.collection)
          break
        case 'updatedAt':
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
          break
        case 'h1Count':
          cmp = a.h1Count - b.h1Count
          break
        case 'internalLinkCount':
          cmp = a.internalLinkCount - b.internalLinkCount
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [items, filter, scoreFilter, search, sortBy, sortDir, quickFilter])

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [filter, scoreFilter, search, sortBy, sortDir, quickFilter])

  // Paginated view
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE))
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredItems.slice(start, start + PAGE_SIZE)
  }, [filteredItems, currentPage])

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      else {
        setSortBy(key)
        setSortDir('asc')
      }
    },
    [sortBy],
  )

  // B1: Select all on current page
  const handleSelectAll = useCallback(() => {
    const pageKeys = paginatedItems.map(itemKey)
    const allSelected = pageKeys.every((k) => selectedIds.has(k))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        pageKeys.forEach((k) => next.delete(k))
      } else {
        pageKeys.forEach((k) => next.add(k))
      }
      return next
    })
  }, [paginatedItems, selectedIds])

  const allPageSelected = useMemo(() => {
    if (paginatedItems.length === 0) return false
    return paginatedItems.every((item) => selectedIds.has(itemKey(item)))
  }, [paginatedItems, selectedIds])

  // CSV export (shared between header and bulk)
  const buildCsv = useCallback(
    (itemList: AuditItem[]) => {
      const headers = [
        'Title',
        'Slug',
        'Collection',
        'Score',
        'Level',
        'Keyword',
        'Meta Title',
        'Meta Description',
        'Words',
        'Readability',
        'Internal Links',
        'External Links',
        'H1 Count',
        'Headings',
        'OG Image',
        'Cornerstone',
        'Reading Time',
        'Updated',
      ]
      const rows = itemList.map((i) => [
        i.title,
        i.slug,
        i.collection,
        i.score,
        i.level || '',
        i.focusKeyword,
        i.metaTitle,
        i.metaDescription,
        i.wordCount,
        i.readabilityScore,
        i.internalLinkCount,
        i.externalLinkCount,
        i.h1Count,
        i.headingCount,
        i.hasOgImage ? 'Yes' : 'No',
        i.isCornerstone ? 'Yes' : 'No',
        i.readingTime,
        i.updatedAt ? new Date(i.updatedAt).toLocaleDateString(locale) : '',
      ])
      // toCsv neutralizes spreadsheet formulas — these cells carry editor-written
      // titles and meta values, opened later by an admin in Excel. See helpers/csv.ts.
      const csv = toCsv([headers, ...rows])

      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `seo-audit-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    },
    [],
  )

  const handleExportCsv = useCallback(() => {
    buildCsv(filteredItems)
  }, [filteredItems, buildCsv])

  // B2: Bulk export CSV (selected only)
  const handleBulkExportCsv = useCallback(() => {
    const selected = items.filter((i) => selectedIds.has(itemKey(i)))
    buildCsv(selected)
  }, [items, selectedIds, buildCsv])

  // B2: Bulk mark/unmark cornerstone
  const handleBulkCornerstone = useCallback(
    async (value: boolean) => {
      for (const key of selectedIds) {
        const [collection, id] = key.split('::')
        try {
          await fetch(payloadApi(`/${collection}/${id}`), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ isCornerstone: value }),
          })
        } catch {
          /* skip */
        }
      }
      setSelectedIds(new Set())
      fetchAudit()
    },
    [selectedIds, fetchAudit],
  )

  // Bulk AI meta optimization — DRY-RUN first: ask the server to propose meta for a set of pages
  // (one batch call), then show a before→after preview the editor can export/review before
  // anything is written. Meta-only (SEO 2026 anti-roadmap: no body content rewriting).
  const runBulkPreview = useCallback(async (ids: string[]) => {
    const clean = ids.filter((k) => !k.startsWith('global:'))
    if (clean.length === 0) return
    setBulkOptimizing(true)
    setBulkPreview(null)
    try {
      const res = await fetch(seoApi('/ai-optimize-bulk'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids: clean, apply: false, limit: 100 }),
      })
      if (res.ok) {
        const data = await res.json()
        const changed = ((data.results || []) as BulkPreviewRow[]).filter((r) => r.changed && !r.error)
        setBulkPreview({ results: changed, capped: !!data.capped, total: data.processed || 0 })
      }
    } catch {
      /* ignore */
    }
    setBulkOptimizing(false)
  }, [])

  // Selection-driven bulk optimize.
  const handleBulkOptimizeMeta = useCallback(
    () => runBulkPreview(Array.from(selectedIds)),
    [selectedIds, runBulkPreview],
  )

  // One-click "optimize the whole site" — auto-targets pages that actually need meta work
  // (missing meta title/description, missing focus keyword, or a low score), capped to 100.
  // Minimal interaction: one click → preview → apply.
  const handleOptimizeSite = useCallback(() => {
    const targets = items
      .filter((i) => !i.collection.startsWith('global:'))
      .filter((i) => !i.metaTitle || !i.metaDescription || !i.focusKeyword || i.score < 70)
      .slice(0, 100)
      .map(itemKey)
    runBulkPreview(targets)
  }, [items, runBulkPreview])

  // Apply the REVIEWED corrections (no second LLM call — server writes the previewed values).
  const handleBulkApplyPreview = useCallback(async () => {
    if (!bulkPreview || bulkPreview.results.length === 0) return
    setBulkApplying(true)
    const corrections = bulkPreview.results.map((r) => ({
      collection: r.collection,
      id: r.id,
      metaTitle: r.after.metaTitle,
      metaDescription: r.after.metaDescription,
      focusKeyword: r.after.focusKeyword,
    }))
    try {
      await fetch(seoApi('/ai-optimize-bulk'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ corrections, apply: true, limit: 100 }),
      })
    } catch {
      /* ignore */
    }
    setBulkApplying(false)
    setBulkPreview(null)
    setSelectedIds(new Set())
    // Do NOT auto-rebuild the audit here: on a large/constrained site, forcing a full rebuild after
    // every applied batch is what saturates the server. The changes are written; the user refreshes
    // once (via "Rafraîchir") when done with all batches.
    setBulkApplied(true)
  }, [bulkPreview])

  // Export the proposed before→after corrections as CSV (review offline before applying).
  const handleExportBulkPreviewCsv = useCallback(() => {
    if (!bulkPreview) return
    const header = [
      'collection',
      'id',
      'title',
      'before_title',
      'after_title',
      'before_description',
      'after_description',
      'before_keyword',
      'after_keyword',
    ]
    const rows = bulkPreview.results.map((r) => [
      r.collection,
      r.id,
      r.title,
      r.before.metaTitle,
      r.after.metaTitle,
      r.before.metaDescription,
      r.after.metaDescription,
      r.before.focusKeyword,
      r.after.focusKeyword,
    ])
    // toCsv neutralizes spreadsheet formulas — see helpers/csv.ts.
    const csv = toCsv([header, ...rows])
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `seo-bulk-optimize-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [bulkPreview])

  // B3: Inline save handler
  const handleInlineSave = useCallback(
    async (item: AuditItem, metaTitle: string, metaDescription: string) => {
      setSaving(true)
      setSaveError(null)
      try {
        const res = await fetch(payloadApi(`/${item.collection}/${item.id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ meta: { title: metaTitle, description: metaDescription } }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setExpandedId(null)
        fetchAudit()
      } catch (e) {
        setSaveError(e instanceof Error ? `${t.seoView.errorSaving}: ${e.message}` : t.seoView.errorSaving)
      }
      setSaving(false)
    },
    [fetchAudit, t],
  )

  // Fetch site name from settings for branded PDF
  const [siteName, setSiteName] = useState<string>('')
  useEffect(() => {
    fetch(seoApi('/settings'), { credentials: 'include', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.siteName) setSiteName(data.siteName)
      })
      .catch(() => {
        // Non-critical — fallback to empty
      })
  }, [])

  const handleExportPdf = useCallback(() => {
    const today = new Date().toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    const avgScore = stats?.avgScore ?? 0
    const totalAnalyzed = stats?.totalPages ?? 0
    const goodCount = stats?.good ?? 0
    const needsWorkCount = stats?.needsWork ?? 0
    const criticalCount = stats?.critical ?? 0
    const noKwCount = stats?.noKeyword ?? 0
    const avgWords = stats?.avgWordCount ?? 0
    const avgReadability = stats?.avgReadability ?? 0

    function pdfScoreColor(score: number): string {
      if (score >= 80) return '#22c55e'
      if (score >= 50) return '#f59e0b'
      return '#ef4444'
    }

    // Top 5 priority pages (lowest scores with issues)
    const sortedByScore = [...filteredItems].sort((a, b) => a.score - b.score)
    const top5Priority = sortedByScore.slice(0, 5)

    const priorityRows = top5Priority
      .map((i) => {
        const issues: string[] = []
        if (!i.metaTitle) issues.push(t.seoView.missingMetaTitle)
        if (!i.metaDescription) issues.push(t.seoView.missingMetaDescription)
        if (!i.focusKeyword) issues.push(t.seoView.missingKeyword)
        if (i.h1Count !== 1) issues.push(i.h1Count === 0 ? t.seoView.missingH1 : `${i.h1Count} H1`)
        if (i.wordCount < 300) issues.push(`${t.seoView.shortContent} (${i.wordCount})`)
        if (i.readabilityScore > 0 && i.readabilityScore < 40) issues.push(t.seoView.lowReadabilityIssue)
        if (!i.hasOgImage) issues.push(t.seoView.missingOgImage)
        if (i.internalLinkCount === 0) issues.push(t.seoView.noInternalLinks)
        if (issues.length === 0) issues.push(t.seoView.lowOverallScore)

        return `<tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;font-weight:700;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(i.title || t.common.noTitle)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:800;font-size:13px;color:${pdfScoreColor(i.score)};">${i.score}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:10px;color:#6b7280;line-height:1.5;">${issues.map(escapeHtml).join('<br>')}</td>
        </tr>`
      })
      .join('')

    // Per-page detail rows (sorted by score ascending)
    const detailRows = sortedByScore
      .map((i) => {
        const issues: string[] = []
        if (!i.metaTitle) issues.push(t.seoView.missingMetaTitle)
        else if (i.metaTitle.length < 30) issues.push(`${t.seoView.shortMetaTitle} (${i.metaTitle.length})`)
        else if (i.metaTitle.length > 60) issues.push(`${t.seoView.longMetaTitle} (${i.metaTitle.length})`)
        if (!i.metaDescription) issues.push(t.seoView.missingMetaDescription)
        else if (i.metaDescription.length < 120) issues.push(`${t.seoView.shortMetaDesc} (${i.metaDescription.length})`)
        else if (i.metaDescription.length > 160) issues.push(`${t.seoView.longMetaDesc} (${i.metaDescription.length})`)
        if (!i.focusKeyword) issues.push(t.seoView.missingKeyword)
        if (i.h1Count !== 1) issues.push(i.h1Count === 0 ? t.seoView.missingH1 : `${i.h1Count} H1`)
        if (i.wordCount < 300) issues.push(`${t.seoView.shortContent} (${i.wordCount})`)
        if (i.readabilityScore > 0 && i.readabilityScore < 40) issues.push(`${t.seoView.lowReadabilityIssue} (${i.readabilityScore})`)
        if (!i.hasOgImage) issues.push(t.seoView.missingOgImage)
        if (i.internalLinkCount === 0) issues.push(t.seoView.noInternalLinks)

        const issuesHtml = issues.length > 0
          ? issues.map((iss) => `<span style="display:inline-block;margin:1px 3px 1px 0;padding:1px 6px;border-radius:3px;font-size:9px;background:rgba(239,68,68,0.08);color:#dc2626;">${escapeHtml(iss)}</span>`).join('')
          : '<span style="font-size:9px;color:#22c55e;font-weight:700;">OK</span>'

        return `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:11px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">${escapeHtml(i.title || t.common.noTitle)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:10px;color:#6b7280;">/${escapeHtml(i.slug)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:800;font-size:12px;color:${pdfScoreColor(i.score)};">${i.score}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:10px;${i.focusKeyword ? '' : 'color:#ef4444;font-style:italic;'}">${escapeHtml(i.focusKeyword || t.common.none)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:10px;">${issuesHtml}</td>
        </tr>`
      })
      .join('')

    const brandingTitle = siteName ? `${t.seoView.seoReport} — ${escapeHtml(siteName)}` : t.seoView.seoReport

    const html = `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <title>${brandingTitle} - ${today}</title>
  <style>
    @media print {
      body { margin: 0; padding: 16px; }
      .no-print { display: none; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; }
      .section { page-break-inside: avoid; }
      .page-break { page-break-before: always; }
    }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; padding: 30px; max-width: 1100px; margin: 0 auto; font-size: 12px; }
    h1 { font-size: 24px; font-weight: 800; margin: 0 0 2px; }
    h2 { font-size: 16px; font-weight: 800; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #e5e7eb; color: #1a1a1a; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 3px solid #1a1a1a; }
    .header-right { text-align: right; font-size: 11px; color: #6b7280; }
    .subtitle { font-size: 12px; color: #6b7280; margin-top: 4px; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 8px; }
    .stats-grid-2 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 24px; }
    .stat-card { padding: 14px 16px; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb; }
    .stat-value { font-size: 24px; font-weight: 800; line-height: 1; margin-bottom: 4px; }
    .stat-label { font-size: 9px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.4px; }
    table { width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; margin-bottom: 8px; }
    thead th { padding: 8px 8px; background: #f9fafb; border-bottom: 2px solid #e5e7eb; font-size: 9px; font-weight: 700; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; text-align: left; }
    tbody tr:nth-child(even) { background: #fafafa; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 2px solid #e5e7eb; font-size: 10px; color: #9ca3af; text-align: center; }
    .score-gauge { display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 50%; font-weight: 800; font-size: 18px; }
    .priority-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: 700; text-transform: uppercase; }
  </style>
</head>
<body>
  <!-- Header with branding -->
  <div class="header">
    <div>
      <h1>${brandingTitle}</h1>
      <div class="subtitle">${totalAnalyzed} ${t.seoView.pagesAnalyzed} — ${filteredItems.length} ${t.seoView.resultsDisplayed}</div>
    </div>
    <div class="header-right">
      <div style="font-weight:700;font-size:12px;color:#1a1a1a;">${today}</div>
      <div style="margin-top:2px;">${t.seoView.generatedBy}</div>
    </div>
  </div>

  <!-- Summary stats -->
  <h2>${t.seoView.overview}</h2>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value" style="color:${pdfScoreColor(avgScore)}">${avgScore}<span style="font-size:12px;font-weight:600;color:#6b7280;">/100</span></div>
      <div class="stat-label">${t.seoView.averageScore}</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:#22c55e">${goodCount}</div>
      <div class="stat-label">${t.seoView.goodLabel}</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:#f59e0b">${needsWorkCount}</div>
      <div class="stat-label">${t.seoView.needsWorkLabel}</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:#ef4444">${criticalCount}</div>
      <div class="stat-label">${t.seoView.criticalLabel}</div>
    </div>
  </div>
  <div class="stats-grid-2">
    <div class="stat-card">
      <div class="stat-value" style="color:#f97316">${noKwCount}</div>
      <div class="stat-label">${t.seoView.noKeywordLabel}</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:#3b82f6">${avgWords}</div>
      <div class="stat-label">${t.seoView.wordsAverage}</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:${avgReadability >= 60 ? '#22c55e' : avgReadability >= 40 ? '#f59e0b' : '#ef4444'}">${avgReadability}</div>
      <div class="stat-label">${t.seoView.readabilityAvg}</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:#6b7280">${stats?.noMetaTitle ?? 0} / ${stats?.noMetaDesc ?? 0}</div>
      <div class="stat-label">${t.seoView.noTitleDesc}</div>
    </div>
  </div>

  <!-- Top 5 priority actions -->
  ${top5Priority.length > 0 ? `
  <h2>${t.seoView.top5PriorityActions}</h2>
  <table>
    <thead>
      <tr>
        <th style="width:35%;">${t.common.page}</th>
        <th style="text-align:center;width:12%;">${t.seoView.score}</th>
        <th>${t.seoView.identifiedIssues}</th>
      </tr>
    </thead>
    <tbody>
      ${priorityRows}
    </tbody>
  </table>
  ` : ''}

  <!-- Per-page details -->
  <h2>${t.seoView.perPageDetails}</h2>
  <table>
    <thead>
      <tr>
        <th style="width:22%;">${t.seoView.title}</th>
        <th style="width:15%;">${t.seoView.slug}</th>
        <th style="text-align:center;width:8%;">${t.seoView.score}</th>
        <th style="width:15%;">${t.seoView.keyword}</th>
        <th>${t.seoView.issues}</th>
      </tr>
    </thead>
    <tbody>
      ${detailRows}
    </tbody>
  </table>

  <!-- Score distribution summary -->
  <div style="margin-top:20px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#6b7280;margin-bottom:8px;">${t.seoView.scoreDistribution}</div>
    <div style="display:flex;gap:4px;height:16px;border-radius:4px;overflow:hidden;">
      ${goodCount > 0 ? `<div style="flex:${goodCount};background:#22c55e;" title="${goodCount} ${t.seoView.good}"></div>` : ''}
      ${needsWorkCount > 0 ? `<div style="flex:${needsWorkCount};background:#f59e0b;" title="${needsWorkCount} ${t.seoView.needsWorkLabel}"></div>` : ''}
      ${criticalCount > 0 ? `<div style="flex:${criticalCount};background:#ef4444;" title="${criticalCount} ${t.seoView.critical}"></div>` : ''}
    </div>
    <div style="display:flex;gap:16px;margin-top:6px;font-size:9px;color:#6b7280;">
      <span><span style="display:inline-block;width:8px;height:8px;background:#22c55e;border-radius:2px;margin-right:3px;vertical-align:middle;"></span>${goodCount} ${t.seoView.good} (${totalAnalyzed > 0 ? Math.round((goodCount / totalAnalyzed) * 100) : 0}%)</span>
      <span><span style="display:inline-block;width:8px;height:8px;background:#f59e0b;border-radius:2px;margin-right:3px;vertical-align:middle;"></span>${needsWorkCount} ${t.seoView.needsWorkLabel} (${totalAnalyzed > 0 ? Math.round((needsWorkCount / totalAnalyzed) * 100) : 0}%)</span>
      <span><span style="display:inline-block;width:8px;height:8px;background:#ef4444;border-radius:2px;margin-right:3px;vertical-align:middle;"></span>${criticalCount} ${t.seoView.critical} (${totalAnalyzed > 0 ? Math.round((criticalCount / totalAnalyzed) * 100) : 0}%)</span>
    </div>
  </div>

  <div class="footer">
    ${t.seoView.generatedBy} &mdash; ${today}${siteName ? ` &mdash; ${escapeHtml(siteName)}` : ''}
  </div>

  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`

    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(html)
      printWindow.document.close()
    }
  }, [filteredItems, stats, siteName, locale, t])

  // Loading state
  if (loading) {
    const loadingMessage = building ? t.seoView.buildingAudit : t.seoView.loadingAudit
    return (
      <>
        <ViewHeader title={t.seoView.auditTitle} />
        <ViewBody>
          <LoadingState label={loadingMessage} />
          <LiveRegion message={loadingMessage} />
        </ViewBody>
      </>
    )
  }

  // Opt-in: the audit hasn't been built yet — don't auto-run it (heavy on large/rich sites).
  if (notBuilt) {
    return (
      <>
        <ViewHeader title={t.seoView.auditTitle} />
        <ViewBody>
          <div className="seo-empty">
            <p className="seo-text seo-text--secondary seo-audit__intro">{t.seoView.auditNotRun}</p>
            <Button buttonStyle="primary" onClick={() => fetchAudit('run')}>
              {t.seoView.runAudit}
            </Button>
          </div>
        </ViewBody>
      </>
    )
  }

  // Error state
  if (error) {
    return (
      <>
        <ViewHeader title={t.seoView.auditTitle} />
        <ViewBody>
          <Banner type="danger">
            <div className="seo-stack seo-stack--tight">
              <strong>{t.common.loadingError}</strong>
              <span>{error}</span>
            </div>
          </Banner>
          <LiveRegion assertive message={`${t.common.loadingError}: ${error}`} />
          <div>
            <Button buttonStyle="secondary" onClick={() => fetchAudit('refresh')}>
              {t.common.retry}
            </Button>
          </div>
        </ViewBody>
      </>
    )
  }

  const quickFilters: Array<{ key: QuickFilter; label: string; count: number; tone: Tone }> = [
    { key: 'noMeta', label: t.seoView.missingMeta, count: quickFilterCounts.noMeta, tone: 'danger' },
    { key: 'noH1', label: t.seoView.missingH1, count: quickFilterCounts.noH1, tone: 'warning' },
    { key: 'lowReadability', label: t.seoView.lowReadability, count: quickFilterCounts.lowReadability, tone: 'warning' },
  ]

  return (
    <>
      <ViewHeader
        actions={
          <>
            <Button
              buttonStyle="primary"
              disabled={bulkOptimizing || items.length === 0}
              onClick={handleOptimizeSite}
              tooltip={t.seoView.optimizeSiteHint}
            >
              {bulkOptimizing ? t.seoView.bulkOptimizing : t.seoView.optimizeSite}
            </Button>
            <Button buttonStyle="secondary" icon={<RefreshIcon />} iconPosition="left" onClick={() => fetchAudit('refresh')}>
              {t.common.refresh}
            </Button>
            <Button buttonStyle="secondary" onClick={handleExportCsv}>
              {t.common.exportCsv}
            </Button>
            <Button buttonStyle="secondary" onClick={handleExportPdf}>
              {t.common.exportPdf}
            </Button>
          </>
        }
        description={`${stats?.totalPages || 0} ${t.seoView.pagesAnalyzed}`}
        title={t.seoView.auditTitle}
      />
      <ViewBody>
        {/* The audit can run for minutes; without this the only signal that it
            finished is a visual one. */}
        <LiveRegion message={`${stats?.totalPages || 0} ${t.seoView.pagesAnalyzed}`} />

        {/* Bulk apply confirmation — avoids an auto-rebuild; user refreshes once when done */}
        {bulkApplied && (
          <Banner type="success">
            <div className="seo-row seo-row--between seo-audit__banner">
              <span>{t.seoView.bulkAppliedNote}</span>
              <Button
                buttonStyle="secondary"
                icon={<RefreshIcon />}
                iconPosition="left"
                onClick={() => {
                  setBulkApplied(false)
                  fetchAudit('refresh')
                }}
              >
                {t.common.refresh}
              </Button>
            </div>
          </Banner>
        )}

        {/* Stats cards */}
        {stats && (
          <Grid>
            <StatTile label={t.seoView.averageScore} tone={scoreTone(stats.avgScore)} value={stats.avgScore} />
            <StatTile label={t.seoView.goodLabel} tone="success" value={stats.good} />
            <StatTile label={t.seoView.needsWorkLabel} tone="warning" value={stats.needsWork} />
            <StatTile label={t.seoView.criticalLabel} tone="danger" value={stats.critical} />
            <StatTile label={t.seoView.noKeyword} tone="warning" value={stats.noKeyword} />
            <StatTile label={t.seoView.wordsAvg} value={stats.avgWordCount} />
          </Grid>
        )}

        {/* Content Decay */}
        <ContentDecaySection items={items as AuditItem[]} />

        {/* Filters */}
        <div className="seo-audit__toolbar">
          <div className="seo-audit__search">
            <SearchIcon className="seo-audit__search-icon" />
            <input
              type="text"
              aria-label={t.seoView.searchPlaceholder}
              placeholder={t.seoView.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="seo-input"
            />
          </div>
          <select
            aria-label={t.seoView.allCollections}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="seo-select seo-select--inline"
          >
            <option value="all">{t.seoView.allCollections}</option>
            {collections.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            aria-label={t.seoView.allScores}
            value={scoreFilter}
            onChange={(e) => setScoreFilter(e.target.value as typeof scoreFilter)}
            className="seo-select seo-select--inline"
          >
            <option value="all">{t.seoView.allScores}</option>
            <option value="good">{t.seoView.goodScores}</option>
            <option value="needsWork">{t.seoView.needsWork}</option>
            <option value="critical">{t.seoView.criticalScores}</option>
          </select>
          <span className="seo-text seo-text--small seo-text--secondary">
            {filteredItems.length} {t.seoView.resultsDisplayed}
          </span>
        </div>

        {/* A4: Quick filter buttons */}
        <div className="seo-row">
          {quickFilters.map((qf) => {
            const isActive = quickFilter === qf.key
            return (
              <Button
                aria-pressed={isActive}
                buttonStyle="pill"
                key={qf.key}
                onClick={() => setQuickFilter(isActive ? 'none' : qf.key)}
                selected={isActive}
              >
                {qf.label}
                <TonePill tone={isActive ? qf.tone : 'neutral'}>{qf.count}</TonePill>
              </Button>
            )
          })}
        </div>

        {/* Table */}
        <DataTable aria-label={t.seoView.auditTitle} className="seo-audit__table">
          {/* A3: Sticky table header */}
          <thead>
            <tr>
              {/* B1: Select all checkbox */}
              <th className="heading-_select">
                <input
                  type="checkbox"
                  aria-label={allPageSelected ? t.common.deselectAll : t.sitemapAudit.selectAll}
                  checked={allPageSelected}
                  onChange={handleSelectAll}
                  className="seo-audit__check"
                />
              </th>
              <SortHeader
                label={t.common.page}
                sortKey="title"
                currentSort={sortBy}
                currentDir={sortDir}
                onSort={handleSort}
              />
              <SortHeader
                label={t.seoView.collection}
                sortKey="collection"
                currentSort={sortBy}
                currentDir={sortDir}
                onSort={handleSort}
              />
              <SortHeader
                label={t.seoView.score}
                sortKey="score"
                currentSort={sortBy}
                currentDir={sortDir}
                onSort={handleSort}
              />
              <SortHeader
                label={t.seoView.keyword}
                sortKey="focusKeyword"
                currentSort={sortBy}
                currentDir={sortDir}
                onSort={handleSort}
              />
              {/* A1: H1 — sortable */}
              <SortHeader
                label={t.seoView.h1}
                sortKey="h1Count"
                currentSort={sortBy}
                currentDir={sortDir}
                onSort={handleSort}
              />
              {/* A1: OG — not sortable */}
              <th>{t.seoView.og}</th>
              {/* A1: Internal links — sortable */}
              <SortHeader
                label={t.seoView.internal}
                sortKey="internalLinkCount"
                currentSort={sortBy}
                currentDir={sortDir}
                onSort={handleSort}
                numeric
              />
              {/* A1: External links — not sortable */}
              <th className="seo-table__num">{t.seoView.external}</th>
              <SortHeader
                label={t.seoView.words}
                sortKey="wordCount"
                currentSort={sortBy}
                currentDir={sortDir}
                onSort={handleSort}
                numeric
              />
              <SortHeader
                label={t.seoView.readability}
                sortKey="readabilityScore"
                currentSort={sortBy}
                currentDir={sortDir}
                onSort={handleSort}
                numeric
              />
              <SortHeader
                label={t.seoView.updated}
                sortKey="updatedAt"
                currentSort={sortBy}
                currentDir={sortDir}
                onSort={handleSort}
                numeric
              />
              <th />
            </tr>
          </thead>

          {/* A3: Scrollable table body */}
          <tbody>
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={COLUMN_COUNT}>
                  <EmptyState title={t.common.noResults} />
                </td>
              </tr>
            ) : (
              paginatedItems.map((item) => {
                const key = itemKey(item)
                const isExpanded = expandedId === key
                return (
                  <React.Fragment key={`${item.collection}-${item.id}`}>
                    <TableRow
                      item={item}
                      selected={selectedIds.has(key)}
                      onToggle={() => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev)
                          if (next.has(key)) next.delete(key)
                          else next.add(key)
                          return next
                        })
                      }}
                      expanded={isExpanded}
                      onRowClick={() => setExpandedId(isExpanded ? null : key)}
                      t={t}
                      locale={locale}
                      adminRoute={adminRoute}
                    />
                    {/* B3: Inline edit panel */}
                    {isExpanded && (
                      <>
                        <InlineEditPanel
                          item={item}
                          saving={saving}
                          onCancel={() => setExpandedId(null)}
                          onSave={(title, desc) => handleInlineSave(item, title, desc)}
                          t={t}
                        />
                        {saveError && (
                          <tr>
                            <td colSpan={COLUMN_COUNT}>
                              <Banner type="danger">{saveError}</Banner>
                            </td>
                          </tr>
                        )}
                      </>
                    )}
                  </React.Fragment>
                )
              })
            )}
          </tbody>
        </DataTable>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="seo-row seo-audit__pagination">
            <Button
              buttonStyle="secondary"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(1)}
            >
              &laquo;
            </Button>
            <Button
              buttonStyle="secondary"
              disabled={currentPage === 1}
              icon={<ChevronIcon direction="left" />}
              iconPosition="left"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              {t.common.previous}
            </Button>
            <span className="seo-text seo-text--secondary seo-text--strong">
              {t.common.page} {currentPage} / {totalPages}
            </span>
            <Button
              buttonStyle="secondary"
              disabled={currentPage === totalPages}
              icon={<ChevronIcon direction="right" />}
              iconPosition="right"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            >
              {t.common.next}
            </Button>
            <Button
              buttonStyle="secondary"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(totalPages)}
            >
              &raquo;
            </Button>
          </div>
        )}

        {/* B2: Bulk action bar */}
        <BulkActionBar
          count={selectedIds.size}
          onDeselectAll={() => setSelectedIds(new Set())}
          onExportCsv={handleBulkExportCsv}
          onMarkCornerstone={() => handleBulkCornerstone(true)}
          onUnmarkCornerstone={() => handleBulkCornerstone(false)}
          onOptimizeMeta={handleBulkOptimizeMeta}
          optimizing={bulkOptimizing}
          t={t}
        />

        {/* Bulk AI optimize — before → after preview (review + export before writing) */}
        {bulkPreview && (
          <div
            className="seo-audit__overlay"
            onClick={() => { if (!bulkApplying) setBulkPreview(null) }}
          >
            <div className="seo-audit__modal" onClick={(e) => e.stopPropagation()}>
              <div className="seo-audit__modal-header">
                <h2 className="seo-heading">{t.seoView.bulkPreviewTitle}</h2>
                <p className="seo-text seo-text--small seo-text--secondary">
                  {bulkPreview.results.length} / {bulkPreview.total}
                  {bulkPreview.capped ? ` · ${t.seoView.bulkCappedNote}` : ''}
                </p>
              </div>

              <div className="seo-audit__modal-body">
                {bulkPreview.results.length === 0 && <EmptyState title={t.seoView.bulkNoChanges} />}
                {bulkPreview.results.map((r) => {
                  const fields: Array<{ label: string; before: string; after: string }> = []
                  if (r.before.metaTitle !== r.after.metaTitle) fields.push({ label: 'Title', before: r.before.metaTitle, after: r.after.metaTitle })
                  if (r.before.metaDescription !== r.after.metaDescription) fields.push({ label: 'Description', before: r.before.metaDescription, after: r.after.metaDescription })
                  if (r.before.focusKeyword !== r.after.focusKeyword) fields.push({ label: 'Keyword', before: r.before.focusKeyword, after: r.after.focusKeyword })
                  return (
                    <div className="seo-audit__change" key={`${r.collection}::${r.id}`}>
                      <div className="seo-text seo-text--strong">
                        {r.title || `${r.collection}/${r.id}`}{' '}
                        <span className="seo-text--small seo-text--secondary">{r.collection}</span>
                      </div>
                      {fields.map((f, i) => (
                        <div className="seo-stack seo-stack--tight" key={i}>
                          <span className="seo-field__label">{f.label}</span>
                          <div className={cx('seo-text seo-text--danger', f.before && 'seo-audit__before')}>
                            {f.before || t.seoAnalyzer.emptyValue}
                          </div>
                          <div className="seo-text seo-text--success seo-text--strong">{f.after || t.seoAnalyzer.emptyValue}</div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>

              <div className="seo-audit__modal-footer">
                <Button
                  buttonStyle="secondary"
                  disabled={bulkPreview.results.length === 0}
                  onClick={handleExportBulkPreviewCsv}
                >
                  {t.seoView.bulkExport}
                </Button>
                <div className="seo-row">
                  <Button buttonStyle="secondary" disabled={bulkApplying} onClick={() => setBulkPreview(null)}>
                    {t.seoView.bulkCancel}
                  </Button>
                  <Button
                    buttonStyle="primary"
                    disabled={bulkApplying || bulkPreview.results.length === 0}
                    onClick={handleBulkApplyPreview}
                  >
                    {bulkApplying ? t.seoView.bulkApplying : `${t.seoView.bulkApply} (${bulkPreview.results.length})`}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </ViewBody>
    </>
  )
}
