'use client'

import React, { useEffect, useState, useMemo, useCallback, useRef, useId } from 'react'
import { Banner, Button, CheckIcon, ChevronIcon, EditIcon, RefreshIcon, TrashIcon, XIcon } from '@payloadcms/ui'
import { useDashboardT, useSeoLocale } from '../hooks/useSeoLocale.js'
import { toCsv } from '../helpers/csv.js'
import { Card, DataTable, EmptyState, Field, Grid, LoadingState, StatTile, TonePill, ViewBody, ViewHeader, type Tone } from '../ui/index.js'
import './RedirectManagerView.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Redirect {
  id: string
  from: string
  to: string
  type: string
  createdAt: string
  updatedAt: string
}

interface PaginatedResponse {
  docs: Redirect[]
  totalDocs: number
  totalPages: number
  page: number
  limit: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

// ---------------------------------------------------------------------------
// Toast sub-component
// ---------------------------------------------------------------------------
function Toast({
  message,
  type,
  onClose,
}: {
  message: string
  type: 'success' | 'error' | 'info'
  onClose: () => void
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    // A toast that is only painted is invisible to a screen reader: the user
    // fires an import and never learns it finished. `alert` interrupts for a
    // failure, `status` waits for a pause for a success.
    <div
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      className="seo-redirects__toast"
      role={type === 'error' ? 'alert' : 'status'}
    >
      <Banner type={type === 'success' ? 'success' : type === 'error' ? 'danger' : 'default'}>{message}</Banner>
    </div>
  )
}

/** Tone of the redirect status code pill. */
function typeTone(type: string): Tone {
  return type === '301' ? 'success' : type === '302' ? 'warning' : 'neutral'
}

// ---------------------------------------------------------------------------
// Main RedirectManagerView component
// ---------------------------------------------------------------------------
export function RedirectManagerView() {
  const locale = useSeoLocale()
  const t = useDashboardT()
  // useId(), never a literal: duplicate ids would break the very association
  // they create if the view is ever mounted twice.
  const uid = useId()
  const newFromId = `${uid}-new-from`
  const newToId = `${uid}-new-to`
  const newTypeId = `${uid}-new-type`

  const [redirects, setRedirects] = useState<Redirect[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalDocs, setTotalDocs] = useState(0)
  const PAGE_SIZE = 50

  // Search
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')

  // Add form
  const [newFrom, setNewFrom] = useState('')
  const [newTo, setNewTo] = useState('')
  const [newType, setNewType] = useState('301')
  const [adding, setAdding] = useState(false)

  // Inline edit
  const [editId, setEditId] = useState<string | null>(null)
  const [editFrom, setEditFrom] = useState('')
  const [editTo, setEditTo] = useState('')
  const [editType, setEditType] = useState('301')
  const [saving, setSaving] = useState(false)

  // Selection for bulk delete
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Test URL
  const [testUrl, setTestUrl] = useState('')
  const [testResult, setTestResult] = useState<{
    matched: boolean
    redirect?: Redirect
  } | null>(null)

  // CSV import
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchDebounced(search)
      setCurrentPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  // Fetch redirects
  const fetchRedirects = useCallback(
    async (page = 1) => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(PAGE_SIZE),
        })
        if (searchDebounced) params.set('search', searchDebounced)

        const res = await fetch(`/api/seo-plugin/redirects?${params.toString()}`, {
          credentials: 'include',
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: PaginatedResponse = await res.json()
        setRedirects(data.docs || [])
        setTotalPages(data.totalPages || 1)
        setTotalDocs(data.totalDocs || 0)
        setCurrentPage(data.page || 1)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : t.common.loadingError)
      }
      setLoading(false)
    },
    [searchDebounced],
  )

  useEffect(() => {
    fetchRedirects(currentPage)
  }, [fetchRedirects, currentPage])

  // Stats
  const stats = useMemo(() => {
    const count301 = redirects.filter((r) => r.type === '301').length
    const count302 = redirects.filter((r) => r.type === '302').length
    return { total: totalDocs, count301, count302 }
  }, [redirects, totalDocs])

  // Add redirect
  const handleAdd = useCallback(async () => {
    if (!newFrom.trim() || !newTo.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/seo-plugin/create-redirect', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: newFrom.trim(),
          to: newTo.trim(),
          type: newType,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.success) {
        setNewFrom('')
        setNewTo('')
        setNewType('301')
        setToast({ message: t.redirectManager.redirectCreated, type: 'success' })
        fetchRedirects(currentPage)
      } else {
        throw new Error(data.error || t.common.serverError)
      }
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : t.common.serverError, type: 'error' })
    }
    setAdding(false)
  }, [newFrom, newTo, newType, currentPage, fetchRedirects, t])

  // Delete single
  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const res = await fetch('/api/seo-plugin/redirects', {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setToast({ message: t.redirectManager.redirectDeleted, type: 'success' })
        fetchRedirects(currentPage)
      } catch (e: unknown) {
        setToast({ message: e instanceof Error ? e.message : t.common.serverError, type: 'error' })
      }
    },
    [currentPage, fetchRedirects, t],
  )

  // Bulk delete
  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return
    const ids = Array.from(selectedIds)
    try {
      const res = await fetch('/api/seo-plugin/redirects', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSelectedIds(new Set())
      setToast({
        message: `${data.deletedCount || ids.length} ${t.redirectManager.redirectsDeleted}`,
        type: 'success',
      })
      fetchRedirects(currentPage)
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : t.common.serverError, type: 'error' })
    }
  }, [selectedIds, currentPage, fetchRedirects, t])

  // Inline edit — start
  const startEdit = useCallback((r: Redirect) => {
    setEditId(r.id)
    setEditFrom(r.from)
    setEditTo(r.to)
    setEditType(r.type)
  }, [])

  // Inline edit — save
  const handleEditSave = useCallback(async () => {
    if (!editId || !editFrom.trim() || !editTo.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/seo-plugin/redirects', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editId,
          from: editFrom.trim(),
          to: editTo.trim(),
          type: editType,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setEditId(null)
      setToast({ message: t.redirectManager.redirectModified, type: 'success' })
      fetchRedirects(currentPage)
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : t.common.serverError, type: 'error' })
    }
    setSaving(false)
  }, [editId, editFrom, editTo, editType, currentPage, fetchRedirects, t])

  // CSV import
  const handleCsvImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      const text = await file.text()
      const lines = text.split('\n').filter((l) => l.trim())

      // Detect if first line is a header
      const firstLine = lines[0]?.toLowerCase() || ''
      const startIdx = firstLine.includes('from') && firstLine.includes('to') ? 1 : 0

      const parsed: Array<{ from: string; to: string; type: string }> = []
      for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        // Handle CSV with or without quotes
        const parts = line.match(/(?:"([^"]*(?:""[^"]*)*)"|([^,]+))/g)
        if (!parts || parts.length < 2) continue

        const cleanPart = (p: string) => p.replace(/^"|"$/g, '').replace(/""/g, '"').trim()
        const from = cleanPart(parts[0])
        const to = cleanPart(parts[1])
        const type = parts[2] ? cleanPart(parts[2]) : '301'

        if (from && to) {
          parsed.push({ from, to, type: type === '302' ? '302' : '301' })
        }
      }

      if (parsed.length === 0) {
        setToast({ message: t.redirectManager.noValidCsvRedirects, type: 'error' })
        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }

      try {
        const res = await fetch('/api/seo-plugin/redirects', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ redirects: parsed }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setToast({
          message: `Import: ${data.created} ${t.redirectManager.createdCount}, ${data.skipped || 0} ${t.redirectManager.duplicatesCount}, ${data.errors || 0} ${t.redirectManager.errorsCount}`,
          type: data.created > 0 ? 'success' : 'info',
        })
        fetchRedirects(1)
        setCurrentPage(1)
      } catch (err: unknown) {
        setToast({ message: err instanceof Error ? err.message : t.redirectManager.exportError, type: 'error' })
      }

      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [fetchRedirects],
  )

  // CSV export
  const handleExportCsv = useCallback(async () => {
    try {
      // Fetch all redirects (no pagination limit)
      const res = await fetch('/api/seo-plugin/redirects?limit=10000', {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: PaginatedResponse = await res.json()
      const allRedirects = data.docs || []

      const headers = ['from', 'to', 'type', 'createdAt']
      const rows = allRedirects.map((r) => [
        r.from,
        r.to,
        r.type,
        r.createdAt ? new Date(r.createdAt).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US') : '',
      ])

      // toCsv neutralizes spreadsheet formulas — see helpers/csv.ts.
      const csv = toCsv([headers, ...rows])

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `redirects-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)

      setToast({ message: `${allRedirects.length} ${t.redirectManager.redirectsExported}`, type: 'success' })
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : t.redirectManager.exportError, type: 'error' })
    }
  }, [])

  // Test URL
  const handleTestUrl = useCallback(() => {
    const urlToTest = testUrl.trim()
    if (!urlToTest) {
      setTestResult(null)
      return
    }

    const normalized = urlToTest.startsWith('/') ? urlToTest : `/${urlToTest}`
    const match = redirects.find((r) => r.from === normalized)

    setTestResult(match ? { matched: true, redirect: match } : { matched: false })
  }, [testUrl, redirects])

  // Select all on current page
  const allPageSelected = useMemo(() => {
    if (redirects.length === 0) return false
    return redirects.every((r) => selectedIds.has(r.id))
  }, [redirects, selectedIds])

  const handleSelectAll = useCallback(() => {
    const pageIds = redirects.map((r) => r.id)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allPageSelected) {
        pageIds.forEach((id) => next.delete(id))
      } else {
        pageIds.forEach((id) => next.add(id))
      }
      return next
    })
  }, [redirects, allPageSelected])

  // Loading state
  if (loading && redirects.length === 0) {
    return (
      <>
        <ViewHeader title={t.redirectManager.title} />
        <ViewBody>
          <LoadingState label={t.redirectManager.loading} />
        </ViewBody>
      </>
    )
  }

  // Error state
  if (error && redirects.length === 0) {
    return (
      <>
        <ViewHeader title={t.redirectManager.title} />
        <ViewBody>
          <Banner type="danger">
            <div className="seo-stack seo-stack--tight">
              <strong>{t.common.loadingError}</strong>
              <span>{error}</span>
            </div>
          </Banner>
          <div>
            <Button buttonStyle="secondary" margin={false} onClick={() => fetchRedirects(1)}>
              {t.common.retry}
            </Button>
          </div>
        </ViewBody>
      </>
    )
  }

  const canAdd = !adding && newFrom.trim().length > 0 && newTo.trim().length > 0

  return (
    <>
      <ViewHeader
        actions={
          <>
            <Button
              buttonStyle="secondary"
              icon={<RefreshIcon />}
              iconPosition="left"
              margin={false}
              onClick={() => fetchRedirects(currentPage)}
            >
              {t.common.refresh}
            </Button>
            <Button buttonStyle="secondary" margin={false} onClick={handleExportCsv}>
              {t.common.exportCsv}
            </Button>
            <Button buttonStyle="secondary" margin={false} onClick={() => fileInputRef.current?.click()}>
              {t.redirectManager.importCsv}
            </Button>
            <input
              accept=".csv"
              aria-label={t.redirectManager.importCsv}
              hidden
              onChange={handleCsvImport}
              ref={fileInputRef}
              type="file"
            />
          </>
        }
        description={`${totalDocs} ${t.redirectManager.totalRedirects}`}
        title={t.redirectManager.title}
      />
      <ViewBody>
        <Grid>
          <StatTile label={t.redirectManager.total} value={stats.total} />
          <StatTile label={t.redirectManager.permanent301} tone="success" value={stats.count301} />
          <StatTile label={t.redirectManager.temporary302} tone="warning" value={stats.count302} />
        </Grid>

        {/* Add form */}
        <Card title={t.redirectManager.addRedirect}>
          <div className="seo-redirects__form">
            <Field label={t.redirectManager.sourceUrl}>
              <input
                className="seo-input"
                id={newFromId}
                onChange={(e) => setNewFrom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd()
                }}
                placeholder={t.redirectManager.sourceUrlPlaceholder}
                type="text"
                value={newFrom}
              />
            </Field>
            <Field label={t.redirectManager.destinationUrl}>
              <input
                className="seo-input"
                id={newToId}
                onChange={(e) => setNewTo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd()
                }}
                placeholder={t.redirectManager.destinationUrlPlaceholder}
                type="text"
                value={newTo}
              />
            </Field>
            <Field label={t.redirectManager.type}>
              <select className="seo-select" id={newTypeId} onChange={(e) => setNewType(e.target.value)} value={newType}>
                <option value="301">301</option>
                <option value="302">302</option>
              </select>
            </Field>
            <Button buttonStyle="primary" disabled={!canAdd} margin={false} onClick={handleAdd}>
              {adding ? t.redirectManager.adding : t.common.add}
            </Button>
          </div>
        </Card>

        {/* Search + Test URL */}
        <div className="seo-redirects__toolbar">
          <input
            aria-label={t.redirectManager.searchPlaceholder}
            className="seo-input seo-redirects__search"
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.redirectManager.searchPlaceholder}
            type="text"
            value={search}
          />

          <div className="seo-row seo-row--nowrap">
            <input
              aria-label={`${t.redirectManager.test} — ${t.redirectManager.sourceUrl}`}
              className="seo-input seo-redirects__test-input"
              onChange={(e) => {
                setTestUrl(e.target.value)
                setTestResult(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTestUrl()
              }}
              placeholder={t.redirectManager.urlToTestPlaceholder}
              type="text"
              value={testUrl}
            />
            <Button buttonStyle="secondary" disabled={!testUrl.trim()} margin={false} onClick={handleTestUrl}>
              {t.redirectManager.test}
            </Button>
            {testResult && (
              <TonePill tone={testResult.matched ? 'success' : 'danger'}>
                {testResult.matched
                  ? `${testResult.redirect?.type} → ${testResult.redirect?.to}`
                  : t.redirectManager.noMatch}
              </TonePill>
            )}
          </div>
        </div>

        {/* Table */}
        {redirects.length === 0 ? (
          <Card>
            <EmptyState title={search ? t.redirectManager.noMatchingRedirects : t.redirectManager.noRedirects} />
          </Card>
        ) : (
          <DataTable aria-label={t.redirectManager.title} className="seo-redirects__table">
            <thead>
              <tr>
                <th className="heading-_select">
                  <span className="seo-checkbox">
                    <input
                      aria-label={allPageSelected ? t.common.deselectAll : t.sitemapAudit.selectAll}
                      checked={allPageSelected}
                      onChange={handleSelectAll}
                      type="checkbox"
                    />
                  </span>
                </th>
                <th>{t.redirectManager.sourceFrom}</th>
                <th>{t.redirectManager.destinationTo}</th>
                <th>{t.redirectManager.type}</th>
                <th className="seo-table__num">{t.redirectManager.date}</th>
                <th className="seo-redirects__actions-col">{t.redirectManager.actions}</th>
              </tr>
            </thead>
            <tbody>
              {redirects.map((r) => {
                const isEditing = editId === r.id
                const isSelected = selectedIds.has(r.id)

                if (isEditing) {
                  // Inline edit row
                  return (
                    <tr className="seo-redirects__row--editing" key={r.id}>
                      <td className="cell-_select" />
                      <td>
                        <input
                          aria-label={t.redirectManager.sourceFrom}
                          className="seo-input"
                          onChange={(e) => setEditFrom(e.target.value)}
                          type="text"
                          value={editFrom}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={t.redirectManager.destinationTo}
                          className="seo-input"
                          onChange={(e) => setEditTo(e.target.value)}
                          type="text"
                          value={editTo}
                        />
                      </td>
                      <td>
                        <select
                          aria-label={t.redirectManager.type}
                          className="seo-select"
                          onChange={(e) => setEditType(e.target.value)}
                          value={editType}
                        >
                          <option value="301">301</option>
                          <option value="302">302</option>
                        </select>
                      </td>
                      <td />
                      <td>
                        <div className="seo-row seo-row--nowrap seo-redirects__actions">
                          <Button
                            aria-label={t.common.save}
                            buttonStyle="primary"
                            icon={<CheckIcon />}
                            loading={saving}
                            margin={false}
                            onClick={handleEditSave}
                            tooltip={t.common.save}
                          />
                          <Button
                            aria-label={t.common.cancel}
                            buttonStyle="secondary"
                            icon={<XIcon />}
                            margin={false}
                            onClick={() => setEditId(null)}
                            tooltip={t.common.cancel}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                }

                // Normal row
                return (
                  <tr className={isSelected ? 'seo-redirects__row--selected' : undefined} key={r.id}>
                    <td className="cell-_select">
                      <span className="seo-checkbox">
                        <input
                          aria-label={`${t.redirectManager.sourceFrom}: ${r.from}`}
                          checked={isSelected}
                          onChange={() => {
                            setSelectedIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(r.id)) next.delete(r.id)
                              else next.add(r.id)
                              return next
                            })
                          }}
                          type="checkbox"
                        />
                      </span>
                    </td>
                    <td>
                      <span className="seo-mono seo-truncate seo-redirects__url" title={r.from}>
                        {r.from}
                      </span>
                    </td>
                    <td>
                      <span className="seo-mono seo-truncate seo-redirects__url" title={r.to}>
                        {r.to}
                      </span>
                    </td>
                    <td>
                      <TonePill tone={typeTone(r.type)}>{r.type}</TonePill>
                    </td>
                    <td className="seo-table__num seo-text--secondary">
                      {r.createdAt
                        ? new Date(r.createdAt).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US')
                        : '-'}
                    </td>
                    <td>
                      <div className="seo-row seo-row--nowrap seo-redirects__actions">
                        <Button
                          aria-label={`${t.common.modify} — ${r.from}`}
                          buttonStyle="ghost"
                          icon={<EditIcon />}
                          margin={false}
                          onClick={() => startEdit(r)}
                          tooltip={t.common.modify}
                        />
                        <Button
                          aria-label={`${t.common.delete} — ${r.from}`}
                          buttonStyle="ghost"
                          icon={<TrashIcon />}
                          margin={false}
                          onClick={() => handleDelete(r.id)}
                          tooltip={t.common.delete}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </DataTable>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <nav aria-label={t.common.page} className="seo-row seo-redirects__pagination">
            <Button
              buttonStyle="secondary"
              disabled={currentPage === 1}
              margin={false}
              onClick={() => setCurrentPage(1)}
            >
              &laquo;
            </Button>
            <Button
              buttonStyle="secondary"
              disabled={currentPage === 1}
              icon={<ChevronIcon direction="left" />}
              iconPosition="left"
              margin={false}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              {t.common.previous}
            </Button>
            <span className="seo-text seo-text--secondary">
              {t.common.page} {currentPage} / {totalPages}
            </span>
            <Button
              buttonStyle="secondary"
              disabled={currentPage === totalPages}
              icon={<ChevronIcon direction="right" />}
              iconPosition="right"
              margin={false}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            >
              {t.common.next}
            </Button>
            <Button
              buttonStyle="secondary"
              disabled={currentPage === totalPages}
              margin={false}
              onClick={() => setCurrentPage(totalPages)}
            >
              &raquo;
            </Button>
          </nav>
        )}

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="seo-redirects__bulk">
            <div className="seo-row">
              <span className="seo-text seo-text--strong">
                {selectedIds.size} {t.common.selected}
                {selectedIds.size > 1 ? 's' : ''}
              </span>
              <Button buttonStyle="secondary" margin={false} onClick={() => setSelectedIds(new Set())}>
                {t.common.deselectAll}
              </Button>
            </div>
            <Button buttonStyle="destructive" margin={false} onClick={handleBulkDelete}>
              {t.common.delete} ({selectedIds.size})
            </Button>
          </div>
        )}

        {/* Toast notification */}
        {toast && <Toast message={toast.message} onClose={() => setToast(null)} type={toast.type} />}
      </ViewBody>
    </>
  )
}
