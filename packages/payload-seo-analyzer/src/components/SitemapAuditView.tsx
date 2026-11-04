'use client'

import React, { useEffect, useState, useMemo, useCallback, useId } from 'react'
import { Button, Banner, CheckIcon, EditIcon, EyeIcon, Pill, RefreshIcon, Tabs, TrashIcon, useConfig } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { useDashboardT, useSeoFeature, useSeoLocale } from '../hooks/useSeoLocale.js'
import { type DashboardTranslations } from '../dashboard-i18n.js'
import { LiveRegion } from './LiveRegion.js'
import { toCsv } from '../helpers/csv.js'
import { classifyLink, countLinkStates, type LinkState } from '../helpers/linkStatus.js'
import {
  Card,
  cx,
  DataTable,
  Dot,
  EmptyState,
  Grid,
  LoadingState,
  ScorePill,
  StatTile,
  type Tone,
  TonePill,
  ViewBody,
  ViewHeader,
} from '../ui/index.js'
import { useSeoApi } from '../hooks/useSeoApi.js'
import './SitemapAuditView.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface OrphanPage {
  id: number | string
  title: string
  slug: string
  collection: string
}

interface WeakPage {
  id: number | string
  title: string
  slug: string
  collection: string
  incomingCount: number
  incomingFrom: Array<{ slug: string; anchorText: string }>
}

interface LinkHub {
  id: number | string
  title: string
  slug: string
  collection: string
  outgoingCount: number
}

interface BrokenLink {
  sourceId: number | string
  sourceTitle: string
  sourceSlug: string
  targetUrl: string
  targetSlug: string
  collection: string
  suggestedSlug: string | null
}

interface SitemapAuditStats {
  totalPages: number
  totalLinks: number
  avgLinksPerPage: number
  orphanCount: number
  weakCount: number
  hubCount: number
  brokenCount: number
}

interface SitemapAuditData {
  orphanPages: OrphanPage[]
  weakPages: WeakPage[]
  linkHubs: LinkHub[]
  brokenLinks: BrokenLink[]
  stats: SitemapAuditStats
}

type TabId = 'orphan' | 'weak' | 'hubs' | 'broken' | 'external' | 'logs404'

// ---------------------------------------------------------------------------
// External Links types
// ---------------------------------------------------------------------------
interface ExternalLinkResult {
  url: string
  status: number
  ok: boolean
  error?: string
  sourcePages: Array<{ title: string; slug: string; collection: string }>
}

/** The scan fields are optional: a result cached by an older version doesn't have them. */
interface ExternalLinksData {
  results: ExternalLinkResult[]
  /** More unique links exist than `maxLinks`: only the first `maxLinks` are checked. */
  capped?: boolean
  totalFound?: number
  maxLinks?: number
  /** Links not checked yet. The scan is partial until this is 0. */
  pending?: number
  partial?: boolean
  stoppedBy?: 'budget' | 'deadline'
}

// ---------------------------------------------------------------------------
// HoverPreview sub-component (C5)
// ---------------------------------------------------------------------------
function HoverPreview({ children, content }: { children: React.ReactNode; content: React.ReactNode }) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  const handleMouseEnter = useCallback(() => setShow(true), [])
  const handleMouseLeave = useCallback(() => setShow(false), [])
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setPos({ x: e.clientX + 12, y: e.clientY + 12 })
  }, [])

  return (
    <span
      className="seo-sitemap__hover"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
    >
      {children}
      {show && (
        <div className="seo-sitemap__hover-card" style={{ left: pos.x, top: pos.y }}>
          {content}
        </div>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// CollectionPill sub-component
// ---------------------------------------------------------------------------
function CollectionPill({ collection, articleLabel }: { collection: string; articleLabel?: string }) {
  const isPages = collection === 'pages'
  return (
    <Pill pillStyle={isPages ? 'light' : 'light-gray'} size="small">
      {isPages ? 'Page' : articleLabel || 'Article'}
    </Pill>
  )
}

// ---------------------------------------------------------------------------
// EditButton sub-component
// ---------------------------------------------------------------------------
function EditButton({ collection, id }: { collection: string; id: number | string }) {
  const t = useDashboardT()
  const {
    config: {
      routes: { admin: adminRoute },
    },
  } = useConfig()
  return (
    <Button
      aria-label={t.common.edit}
      buttonStyle="ghost"
      el="link"
      icon={<EditIcon />}
      margin={false}
      to={formatAdminURL({ adminRoute, path: `/collections/${collection}/${id}` })}
      tooltip={t.common.edit}
    />
  )
}

// ---------------------------------------------------------------------------
// Layout helpers shared by every tab
// ---------------------------------------------------------------------------
/** Visually hidden text for icon-only / checkbox column headers. */
function SrOnly({ children }: { children: React.ReactNode }) {
  return <span className="seo-sitemap__sr-only">{children}</span>
}

/** One card per list: title, count pill, and the content flush against the card edge. */
function ListCard({
  title,
  count,
  flush = true,
  children,
}: {
  title: string
  count?: number
  flush?: boolean
  children: React.ReactNode
}) {
  return (
    <Card
      actions={count !== undefined ? <Pill size="small">{count}</Pill> : undefined}
      flush={flush}
      title={title}
    >
      {children}
    </Card>
  )
}

/** Page title cell: bold truncated title (optionally wrapped), used by every page table. */
function TitleText({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span className="seo-text seo-text--strong seo-truncate seo-sitemap__title" title={title}>
      {children}
    </span>
  )
}

/** Error banner + retry button, for the tabs that fetch their own data. */
function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  const t = useDashboardT()
  return (
    <div className="seo-stack">
      <Banner type="danger">
        {t.common.loadingError}: {error}
      </Banner>
      <div>
        <Button buttonStyle="secondary" margin={false} onClick={onRetry}>
          {t.common.retry}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// OrphanTab (C3: score badge, C5: hover preview)
// ---------------------------------------------------------------------------
function OrphanTab({ pages, scoreMap }: { pages: OrphanPage[]; scoreMap: Map<string, number> }) {
  const t = useDashboardT()
  if (pages.length === 0) {
    return (
      <ListCard count={0} title={t.sitemapAudit.orphanedPages}>
        <EmptyState title={t.sitemapAudit.noOrphanedPages} />
      </ListCard>
    )
  }
  return (
    <ListCard count={pages.length} title={t.sitemapAudit.orphanedPages}>
      <p className="seo-sitemap__intro">{t.sitemapAudit.orphanedPagesDesc}</p>
      <DataTable aria-label={t.sitemapAudit.orphanedPages} bare>
        <thead>
          <tr>
            <th>{t.common.page}</th>
            <th>{t.seoView.collection}</th>
            <th>{t.seoView.slug}</th>
            <th className="seo-table__num">{t.seoView.score}</th>
            <th>
              <SrOnly>{t.sitemapAudit.orphaned}</SrOnly>
            </th>
            <th>
              <SrOnly>{t.redirectManager.actions}</SrOnly>
            </th>
          </tr>
        </thead>
        <tbody>
          {pages.map((page) => {
            const score = scoreMap.get(page.slug)
            return (
              <tr key={`${page.collection}-${page.id}`}>
                <td>
                  <HoverPreview
                    content={
                      <>
                        {page.title}
                        <br />/{page.slug}
                      </>
                    }
                  >
                    <TitleText>{page.title || t.common.noTitle}</TitleText>
                  </HoverPreview>
                </td>
                <td>
                  <CollectionPill articleLabel={t.common.article} collection={page.collection} />
                </td>
                <td>
                  <span className="seo-mono seo-text--secondary">/{page.slug}</span>
                </td>
                <td className="seo-table__num">{score !== undefined && <ScorePill score={score} />}</td>
                <td>
                  <TonePill tone="danger">{t.sitemapAudit.zeroIncomingLinks}</TonePill>
                </td>
                <td className="seo-table__num">
                  <EditButton collection={page.collection} id={page.id} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </DataTable>
    </ListCard>
  )
}

// ---------------------------------------------------------------------------
// WeakTab (C3: score badge, C4: anchor text, C5: hover preview)
// ---------------------------------------------------------------------------
function WeakTab({ pages, scoreMap }: { pages: WeakPage[]; scoreMap: Map<string, number> }) {
  const t = useDashboardT()
  if (pages.length === 0) {
    return (
      <ListCard count={0} title={t.sitemapAudit.fragilePages}>
        <EmptyState title={t.sitemapAudit.noFragilePages} />
      </ListCard>
    )
  }
  return (
    <ListCard count={pages.length} title={t.sitemapAudit.fragilePages}>
      <p className="seo-sitemap__intro">{t.sitemapAudit.fragilePagesDesc}</p>
      <DataTable aria-label={t.sitemapAudit.fragilePages} bare>
        <thead>
          <tr>
            <th>{t.common.page}</th>
            <th>{t.seoView.collection}</th>
            <th>{t.seoView.slug}</th>
            <th className="seo-table__num">{t.seoView.score}</th>
            <th>
              <SrOnly>{t.sitemapAudit.fragile}</SrOnly>
            </th>
            <th>
              <SrOnly>{t.redirectManager.actions}</SrOnly>
            </th>
          </tr>
        </thead>
        <tbody>
          {pages.map((page) => {
            const score = scoreMap.get(page.slug)
            const first = page.incomingFrom && page.incomingFrom.length > 0 ? page.incomingFrom[0] : null
            return (
              <tr key={`${page.collection}-${page.id}`}>
                <td>
                  <TitleText title={page.title}>{page.title || t.common.noTitle}</TitleText>
                </td>
                <td>
                  <CollectionPill articleLabel={t.common.article} collection={page.collection} />
                </td>
                <td>
                  <span className="seo-mono seo-text--secondary">/{page.slug}</span>
                </td>
                <td className="seo-table__num">{score !== undefined && <ScorePill score={score} />}</td>
                <td>
                  <div className="seo-sitemap__cell">
                    <TonePill tone="warning">{t.sitemapAudit.oneIncomingLink}</TonePill>
                    {first && (
                      <span className="seo-text seo-text--small seo-text--secondary">
                        <HoverPreview
                          content={
                            <>
                              <div className="seo-sitemap__hover-strong">/{first.slug}</div>
                              {first.anchorText && (
                                <div className="seo-sitemap__hover-quote">
                                  &laquo; {first.anchorText} &raquo;
                                </div>
                              )}
                            </>
                          }
                        >
                          <span>
                            {t.sitemapAudit.from} /{first.slug}
                          </span>
                        </HoverPreview>
                        {first.anchorText && (
                          <span className="seo-sitemap__anchor">
                            {t.sitemapAudit.anchor} &laquo; {first.anchorText} &raquo;
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </td>
                <td className="seo-table__num">
                  <EditButton collection={page.collection} id={page.id} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </DataTable>
    </ListCard>
  )
}

// ---------------------------------------------------------------------------
// HubsTab
// ---------------------------------------------------------------------------
function HubsTab({ hubs }: { hubs: LinkHub[] }) {
  const t = useDashboardT()
  if (hubs.length === 0) {
    return (
      <ListCard count={0} title={t.sitemapAudit.linkHubs}>
        <EmptyState title={t.sitemapAudit.noLinkHubs} />
      </ListCard>
    )
  }
  return (
    <ListCard count={hubs.length} title={t.sitemapAudit.linkHubs}>
      <p className="seo-sitemap__intro">{t.sitemapAudit.linkHubsDesc}</p>
      <DataTable aria-label={t.sitemapAudit.linkHubs} bare>
        <thead>
          <tr>
            <th>{t.common.page}</th>
            <th>{t.seoView.collection}</th>
            <th>{t.seoView.slug}</th>
            <th className="seo-table__num">{t.sitemapAudit.links}</th>
            <th>
              <SrOnly>{t.redirectManager.actions}</SrOnly>
            </th>
          </tr>
        </thead>
        <tbody>
          {hubs.map((hub) => (
            <tr key={`${hub.collection}-${hub.id}`}>
              <td>
                <TitleText title={hub.title}>{hub.title || t.common.noTitle}</TitleText>
              </td>
              <td>
                <CollectionPill articleLabel={t.common.article} collection={hub.collection} />
              </td>
              <td>
                <span className="seo-mono seo-text--secondary">/{hub.slug}</span>
              </td>
              <td className="seo-table__num">
                <TonePill tone="brand">
                  {hub.outgoingCount} {t.sitemapAudit.links}
                </TonePill>
              </td>
              <td className="seo-table__num">
                <EditButton collection={hub.collection} id={hub.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </ListCard>
  )
}

// ---------------------------------------------------------------------------
// BrokenTab (C1: suggestions, C2: redirect button, C5: hover preview, bulk)
// ---------------------------------------------------------------------------
function BrokenTab({ links, onRefresh }: { links: BrokenLink[]; onRefresh: () => void }) {
  const seoApi = useSeoApi()
  const t = useDashboardT()
  const [createdRedirects, setCreatedRedirects] = useState<Set<string>>(new Set())
  const [loadingRedirects, setLoadingRedirects] = useState<Set<string>>(new Set())
  const [manualInputs, setManualInputs] = useState<Record<string, string>>({})
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ created: number; errors: number } | null>(null)

  const handleCreateRedirect = useCallback(async (from: string, to: string) => {
    const key = from
    setLoadingRedirects((prev) => new Set(prev).add(key))
    try {
      const res = await fetch(seoApi('/create-redirect'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `/${from}`, to: `/${to}`, type: '301' }),
      })
      if (res.ok) {
        setCreatedRedirects((prev) => new Set(prev).add(key))
      }
    } catch {
      // Silently fail — button stays in default state
    }
    setLoadingRedirects((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }, [])

  // Bulk create: all selected links with a suggestion or manual input
  const handleBulkCreate = useCallback(async () => {
    const redirects: Array<{ from: string; to: string; type: string }> = []

    for (const link of links) {
      const key = `${link.sourceSlug}::${link.targetSlug}`
      if (!selectedIds.has(key) || createdRedirects.has(link.targetSlug)) continue
      const to = link.suggestedSlug || manualInputs[key]
      if (to) {
        redirects.push({ from: `/${link.targetSlug}`, to: `/${to}`, type: '301' })
      }
    }

    if (redirects.length === 0) return

    setBulkLoading(true)
    setBulkResult(null)
    try {
      const res = await fetch(seoApi('/create-redirect'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirects }),
      })
      if (res.ok) {
        const json = await res.json()
        setBulkResult({ created: json.created || 0, errors: json.errors || 0 })
        // Mark created redirects
        for (const r of redirects) {
          const slug = r.from.replace(/^\/+/, '')
          setCreatedRedirects((prev) => new Set(prev).add(slug))
        }
        setSelectedIds(new Set())
        // Auto-refresh data after bulk creation
        setTimeout(() => onRefresh(), 1000)
      }
    } catch {
      setBulkResult({ created: 0, errors: redirects.length })
    }
    setBulkLoading(false)
  }, [links, selectedIds, createdRedirects, manualInputs, onRefresh])

  // Bulk create ALL with suggestions (no selection needed)
  const handleBulkCreateAll = useCallback(async () => {
    const redirects: Array<{ from: string; to: string; type: string }> = []

    for (const link of links) {
      if (createdRedirects.has(link.targetSlug)) continue
      const inputKey = `${link.sourceSlug}::${link.targetSlug}`
      const to = link.suggestedSlug || manualInputs[inputKey]
      if (to) {
        redirects.push({ from: `/${link.targetSlug}`, to: `/${to}`, type: '301' })
      }
    }

    if (redirects.length === 0) return

    setBulkLoading(true)
    setBulkResult(null)
    try {
      const res = await fetch(seoApi('/create-redirect'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirects }),
      })
      if (res.ok) {
        const json = await res.json()
        setBulkResult({ created: json.created || 0, errors: json.errors || 0 })
        for (const r of redirects) {
          const slug = r.from.replace(/^\/+/, '')
          setCreatedRedirects((prev) => new Set(prev).add(slug))
        }
        // Auto-refresh data after bulk creation
        setTimeout(() => onRefresh(), 1000)
      }
    } catch {
      setBulkResult({ created: 0, errors: redirects.length })
    }
    setBulkLoading(false)
  }, [links, createdRedirects, manualInputs, onRefresh])

  const toggleSelect = useCallback((key: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === links.length) {
      setSelectedIds(new Set())
    } else {
      const all = new Set(links.map((l) => `${l.sourceSlug}::${l.targetSlug}`))
      setSelectedIds(all)
    }
  }, [links, selectedIds.size])

  // Count links with suggestions (actionable for bulk)
  const withSuggestionCount = useMemo(
    () => links.filter((l) => !createdRedirects.has(l.targetSlug) && (l.suggestedSlug || manualInputs[l.targetSlug])).length,
    [links, createdRedirects, manualInputs],
  )

  const selectedWithSuggestion = useMemo(() => {
    let count = 0
    for (const link of links) {
      const key = `${link.sourceSlug}::${link.targetSlug}`
      if (selectedIds.has(key) && !createdRedirects.has(link.targetSlug) && (link.suggestedSlug || manualInputs[link.targetSlug])) {
        count++
      }
    }
    return count
  }, [links, selectedIds, createdRedirects, manualInputs])

  if (links.length === 0) {
    return (
      <ListCard count={0} title={t.sitemapAudit.brokenLinks}>
        <EmptyState title={t.sitemapAudit.noBrokenLinks} />
      </ListCard>
    )
  }
  return (
    <ListCard count={links.length} title={t.sitemapAudit.brokenLinks}>
      {/* Bulk action bar */}
      <div className="seo-sitemap__toolbar">
        <p className="seo-text seo-text--small seo-text--secondary">{t.sitemapAudit.brokenLinksDesc}</p>
        <div className="seo-row">
          {bulkResult && (
            <TonePill tone={bulkResult.errors > 0 ? 'warning' : 'success'}>
              {bulkResult.created} {t.sitemapAudit.created}
              {bulkResult.errors > 0 ? `, ${bulkResult.errors} ${t.sitemapAudit.errors}` : ''}
            </TonePill>
          )}
          {selectedIds.size > 0 && (
            <Button
              buttonStyle="primary"
              disabled={bulkLoading || selectedWithSuggestion === 0}
              margin={false}
              onClick={handleBulkCreate}
            >
              {bulkLoading ? '...' : `${t.sitemapAudit.redirectSelected} (${selectedWithSuggestion})`}
            </Button>
          )}
          <Button
            buttonStyle="secondary"
            disabled={bulkLoading || withSuggestionCount === 0}
            margin={false}
            onClick={handleBulkCreateAll}
          >
            {bulkLoading ? '...' : `${t.sitemapAudit.redirectAll} (${withSuggestionCount})`}
          </Button>
        </div>
      </div>
      {/* Select all row */}
      <div className="seo-sitemap__toolbar seo-sitemap__toolbar--compact">
        <label className="seo-checkbox seo-text--small seo-text--secondary">
          <input
            type="checkbox"
            aria-label={t.sitemapAudit.selectAll}
            checked={selectedIds.size === links.length && links.length > 0}
            onChange={toggleSelectAll}
          />
          <span>{selectedIds.size > 0 ? `${selectedIds.size} ${t.sitemapAudit.selectedItems}` : t.sitemapAudit.selectAll}</span>
        </label>
      </div>
      <DataTable aria-label={t.sitemapAudit.brokenLinks} bare>
        <thead>
          <tr>
            <th className="seo-sitemap__check">
              <SrOnly>{t.sitemapAudit.selectAll}</SrOnly>
            </th>
            <th>{t.common.page}</th>
            <th>{t.sitemapAudit.brokenLinks}</th>
            <th>{t.sitemapAudit.targetSlug}</th>
            <th>
              <SrOnly>{t.redirectManager.actions}</SrOnly>
            </th>
          </tr>
        </thead>
        <tbody>
          {links.map((link, idx) => {
            const key = `${link.sourceSlug}::${link.targetSlug}`
            const isCreated = createdRedirects.has(link.targetSlug)
            const isLoading = loadingRedirects.has(link.targetSlug)
            const manualTo = manualInputs[key] ?? ''
            const isSelected = selectedIds.has(key)

            return (
              <tr className={isSelected ? 'seo-sitemap__row--selected' : undefined} key={`broken-${idx}`}>
                <td className="seo-sitemap__check">
                  <input
                    type="checkbox"
                    aria-label={`${t.sitemapAudit.brokenLinks}: ${link.sourceSlug} → ${link.targetSlug}`}
                    checked={isSelected}
                    onChange={() => toggleSelect(key)}
                  />
                </td>
                <td>
                  <div className="seo-sitemap__cell">
                    <TitleText title={link.sourceTitle}>{link.sourceTitle || t.common.noTitle}</TitleText>
                    <div className="seo-row seo-row--nowrap">
                      <CollectionPill articleLabel={t.common.article} collection={link.collection} />
                      <span className="seo-mono seo-text--secondary">/{link.sourceSlug}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="seo-sitemap__cell">
                    <span className="seo-row seo-row--nowrap">
                      <Dot tone="danger" />
                      <HoverPreview content={<span className="seo-mono">{link.targetUrl}</span>}>
                        <span className="seo-mono seo-text--danger seo-truncate seo-sitemap__url">{link.targetUrl}</span>
                      </HoverPreview>
                    </span>
                    <span className="seo-text seo-text--small seo-text--secondary">slug: {link.targetSlug}</span>
                    {/* C1: Suggestion display */}
                    {link.suggestedSlug && (
                      <span className="seo-text seo-text--small seo-text--success">
                        {t.sitemapAudit.suggestion} /{link.suggestedSlug}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  {/* C2: Redirect creation */}
                  <div className="seo-sitemap__redirect">
                    {isCreated ? (
                      <Pill alignIcon="left" icon={<CheckIcon />} pillStyle="success" size="small">
                        {t.sitemapAudit.createdLabel}
                      </Pill>
                    ) : (
                      <>
                        {!link.suggestedSlug && (
                          <input
                            type="text"
                            aria-label={`${t.sitemapAudit.targetSlug} — ${link.targetSlug}`}
                            className="seo-input seo-input--inline seo-sitemap__slug-input"
                            placeholder={t.sitemapAudit.targetSlug}
                            value={manualTo}
                            onChange={(e) =>
                              setManualInputs((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                          />
                        )}
                        <Button
                          buttonStyle="secondary"
                          disabled={isLoading || (!link.suggestedSlug && !manualTo)}
                          margin={false}
                          onClick={() => {
                            const to = link.suggestedSlug || manualTo
                            if (to) handleCreateRedirect(link.targetSlug, to)
                          }}
                        >
                          {isLoading ? '...' : '301 →'}
                        </Button>
                      </>
                    )}
                  </div>
                </td>
                <td className="seo-table__num">
                  <EditButton collection={link.collection} id={link.sourceId} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </DataTable>
    </ListCard>
  )
}

// ---------------------------------------------------------------------------
// Logs404Tab sub-component — shows 404 errors from visitors
// ---------------------------------------------------------------------------
interface SeoLog {
  id: number | string
  url: string
  type: string
  count: number
  lastSeen: string
  referrer: string
  ignored: boolean
}

function Logs404Tab() {
  const seoApi = useSeoApi()
  const locale = useSeoLocale()
  const t = useDashboardT()
  const [logs, setLogs] = useState<SeoLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createdRedirects, setCreatedRedirects] = useState<Set<string>>(new Set())
  const [loadingRedirects, setLoadingRedirects] = useState<Set<string>>(new Set())
  const [manualInputs, setManualInputs] = useState<Record<string, string>>({})
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(seoApi('/seo-logs'), { credentials: 'include', cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setLogs(json.logs || [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t.common.loadingError)
    }
    setLoading(false)
  }, [t])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const handleCreateRedirect = useCallback(async (from: string, to: string) => {
    setLoadingRedirects((prev) => new Set(prev).add(from))
    try {
      const res = await fetch(seoApi('/create-redirect'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, type: '301' }),
      })
      if (res.ok) {
        setCreatedRedirects((prev) => new Set(prev).add(from))
      }
    } catch { /* ignore */ }
    setLoadingRedirects((prev) => {
      const next = new Set(prev)
      next.delete(from)
      return next
    })
  }, [])

  const handleIgnore = useCallback(async (id: number | string) => {
    try {
      await fetch(seoApi(`/seo-logs?id=${id}&action=ignore`), {
        method: 'DELETE',
        credentials: 'include',
      })
      setLogs((prev) => prev.filter((l) => l.id !== id))
    } catch { /* ignore */ }
  }, [])

  const handleDelete = useCallback(async (id: number | string) => {
    try {
      await fetch(seoApi(`/seo-logs?id=${id}`), {
        method: 'DELETE',
        credentials: 'include',
      })
      setLogs((prev) => prev.filter((l) => l.id !== id))
    } catch { /* ignore */ }
  }, [])

  const handleBulkRedirect = useCallback(async () => {
    const redirects: Array<{ from: string; to: string; type: string }> = []
    for (const log of logs) {
      if (!selectedIds.has(String(log.id)) || createdRedirects.has(log.url)) continue
      const to = manualInputs[log.url]
      if (to) {
        redirects.push({ from: log.url, to: to.startsWith('/') ? to : `/${to}`, type: '301' })
      }
    }
    if (redirects.length === 0) return

    setBulkLoading(true)
    try {
      const res = await fetch(seoApi('/create-redirect'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirects }),
      })
      if (res.ok) {
        for (const r of redirects) {
          setCreatedRedirects((prev) => new Set(prev).add(r.from))
        }
        setSelectedIds(new Set())
      }
    } catch { /* ignore */ }
    setBulkLoading(false)
  }, [logs, selectedIds, createdRedirects, manualInputs])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === logs.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(logs.map((l) => String(l.id))))
    }
  }, [logs, selectedIds.size])

  if (loading) {
    return (
      <ListCard flush={false} title={t.sitemapAudit.logs404}>
        <LoadingState label={t.sitemapAudit.loading404} />
      </ListCard>
    )
  }

  if (error) {
    return (
      <ListCard flush={false} title={t.sitemapAudit.logs404}>
        <ErrorState error={error} onRetry={fetchLogs} />
      </ListCard>
    )
  }

  if (logs.length === 0) {
    return (
      <ListCard count={0} title={t.sitemapAudit.logs404}>
        <EmptyState title={t.sitemapAudit.no404Errors} />
      </ListCard>
    )
  }

  const selectedWithInput = logs.filter(
    (l) => selectedIds.has(String(l.id)) && !createdRedirects.has(l.url) && manualInputs[l.url],
  ).length

  return (
    <ListCard count={logs.length} title={t.sitemapAudit.logs404}>
      {/* Header */}
      <div className="seo-sitemap__toolbar">
        <p className="seo-text seo-text--small seo-text--secondary">{t.sitemapAudit.pages404Desc}</p>
        <div className="seo-row">
          {selectedIds.size > 0 && selectedWithInput > 0 && (
            <Button buttonStyle="primary" disabled={bulkLoading} margin={false} onClick={handleBulkRedirect}>
              {bulkLoading ? '...' : `301 selection (${selectedWithInput})`}
            </Button>
          )}
          <Button
            buttonStyle="secondary"
            icon={<RefreshIcon />}
            iconPosition="left"
            margin={false}
            onClick={fetchLogs}
          >
            {t.common.refresh}
          </Button>
        </div>
      </div>

      {/* Select all row */}
      <div className="seo-sitemap__toolbar seo-sitemap__toolbar--compact">
        <label className="seo-checkbox seo-text--small seo-text--secondary">
          <input
            type="checkbox"
            aria-label={t.sitemapAudit.selectAll}
            checked={selectedIds.size === logs.length && logs.length > 0}
            onChange={toggleSelectAll}
          />
          <span>{selectedIds.size > 0 ? `${selectedIds.size} ${t.sitemapAudit.selectedItems}` : t.sitemapAudit.selectAll}</span>
        </label>
      </div>

      {/* Log rows */}
      <DataTable aria-label={t.sitemapAudit.logs404} bare>
        <thead>
          <tr>
            <th className="seo-sitemap__check">
              <SrOnly>{t.sitemapAudit.selectAll}</SrOnly>
            </th>
            <th>{t.seoConfig.url}</th>
            <th>{t.sitemapAudit.targetSlug}</th>
            <th>
              <SrOnly>{t.redirectManager.actions}</SrOnly>
            </th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => {
            const isCreated = createdRedirects.has(log.url)
            const isLoading = loadingRedirects.has(log.url)
            const isSelected = selectedIds.has(String(log.id))
            const manualTo = manualInputs[log.url] ?? ''

            return (
              <tr className={isSelected ? 'seo-sitemap__row--selected' : undefined} key={log.id}>
                <td className="seo-sitemap__check">
                  <input
                    type="checkbox"
                    aria-label={log.url}
                    checked={isSelected}
                    onChange={() => toggleSelect(String(log.id))}
                  />
                </td>
                <td>
                  <div className="seo-sitemap__cell">
                    <span className="seo-mono seo-text--danger seo-truncate seo-sitemap__url" title={log.url}>
                      {log.url}
                    </span>
                    <div className="seo-row seo-text seo-text--small seo-text--secondary">
                      <TonePill tone="warning">{log.count}x</TonePill>
                      <span>
                        {t.sitemapAudit.last} {log.lastSeen ? new Date(log.lastSeen).toLocaleDateString(locale) : '?'}
                      </span>
                      {log.referrer && (
                        <span title={log.referrer}>
                          {t.sitemapAudit.ref} {log.referrer.length > 30 ? log.referrer.slice(0, 28) + '...' : log.referrer}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td>
                  <div className="seo-sitemap__redirect">
                    {isCreated ? (
                      <Pill alignIcon="left" icon={<CheckIcon />} pillStyle="success" size="small">
                        301
                      </Pill>
                    ) : (
                      <>
                        <input
                          type="text"
                          aria-label={`${t.sitemapAudit.targetSlug} — ${log.url}`}
                          className="seo-input seo-input--inline seo-sitemap__slug-input"
                          placeholder={t.sitemapAudit.targetSlug}
                          value={manualTo}
                          onChange={(e) =>
                            setManualInputs((prev) => ({ ...prev, [log.url]: e.target.value }))
                          }
                        />
                        <Button
                          buttonStyle="secondary"
                          disabled={isLoading || !manualTo}
                          margin={false}
                          onClick={() => {
                            if (manualTo) {
                              const to = manualTo.startsWith('/') ? manualTo : `/${manualTo}`
                              handleCreateRedirect(log.url, to)
                            }
                          }}
                        >
                          {isLoading ? '...' : '301 →'}
                        </Button>
                      </>
                    )}
                  </div>
                </td>
                <td className="seo-table__num">
                  <div className="seo-row seo-row--nowrap seo-sitemap__actions">
                    <Button
                      aria-label={t.sitemapAudit.ignore}
                      buttonStyle="ghost"
                      icon={<EyeIcon />}
                      margin={false}
                      onClick={() => handleIgnore(log.id)}
                      tooltip={t.sitemapAudit.ignore}
                    />
                    <Button
                      aria-label={t.common.delete}
                      buttonStyle="ghost"
                      icon={<TrashIcon />}
                      margin={false}
                      onClick={() => handleDelete(log.id)}
                      tooltip={t.common.delete}
                    />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </DataTable>
    </ListCard>
  )
}

// ---------------------------------------------------------------------------
// ExternalLinksTab sub-component
// ---------------------------------------------------------------------------
type ExternalFilter = 'all' | 'broken' | 'unverified' | 'ok'

/** Which link states each filter shows. "Couldn't verify" also covers links the guard blocked. */
const FILTER_STATES: Record<Exclude<ExternalFilter, 'all'>, readonly LinkState[]> = {
  broken: ['broken', 'timeout', 'error'],
  unverified: ['unverified', 'blocked'],
  ok: ['ok'],
}

const LINK_STATE_TONE: Record<LinkState, Tone> = {
  ok: 'success',
  broken: 'danger',
  timeout: 'warning',
  error: 'danger',
  blocked: 'warning',
  unverified: 'neutral',
}

/** Stats pills: good first, then each kind of problem (zero counts are hidden except ok and broken). */
const PILL_ORDER: readonly LinkState[] = ['ok', 'broken', 'timeout', 'error', 'blocked', 'unverified']

function ExternalLinksTab() {
  const seoApi = useSeoApi()
  const t = useDashboardT()
  const [data, setData] = useState<ExternalLinksData | null>(null)
  const [loading, setLoading] = useState(false)
  const [continuing, setContinuing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [continueError, setContinueError] = useState<string | null>(null)
  const [filter, setFilter] = useState<ExternalFilter>('all')

  const postScan = useCallback(
    async (forceRefresh: boolean): Promise<ExternalLinksData> => {
      const res = await fetch(seoApi('/external-links'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceRefresh }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as ExternalLinksData
    },
    [seoApi],
  )

  const handleScan = useCallback(
    async (forceRefresh = false) => {
      setLoading(true)
      setError(null)
      setContinueError(null)
      try {
        setData(await postScan(forceRefresh))
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : t.common.loadingError)
      }
      setLoading(false)
    },
    [postScan, t],
  )

  // A partial scan resumes from the checks the server saved: the same request without
  // `forceRefresh` checks the next batch. The results stay on screen meanwhile.
  const handleContinue = useCallback(async () => {
    setContinuing(true)
    setContinueError(null)
    try {
      setData(await postScan(false))
    } catch (e: unknown) {
      setContinueError(e instanceof Error ? e.message : t.common.loadingError)
    }
    setContinuing(false)
  }, [postScan, t])

  // Counted from the results (not read from `data.stats`) so the buckets always add up to
  // `total`, even for a response cached before a bucket existed.
  const classified = useMemo(
    () => (data ? data.results.map((r) => ({ ...r, state: classifyLink(r) })) : []),
    [data],
  )
  const stats = useMemo(() => countLinkStates(classified), [classified])

  const handleExportCSV = useCallback(() => {
    const rows: string[][] = [['URL', 'Status', 'State', 'Error', 'Source pages']]
    for (const r of classified) {
      if (r.state === 'ok') continue
      rows.push([
        r.url,
        String(r.status),
        r.state,
        r.error || '',
        r.sourcePages.map((p) => `/${p.slug} (${p.collection})`).join('; '),
      ])
    }
    // toCsv neutralizes spreadsheet formulas — see helpers/csv.ts.
    const csvContent = toCsv(rows)
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const now = new Date().toISOString().split('T')[0]
    const a = document.createElement('a')
    a.href = url
    a.download = `external-links-broken-${now}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [classified])

  // The "Couldn't verify" filter is hidden when nothing is in it; a selection left over from an
  // earlier scan then falls back to "All" instead of showing an empty table.
  const unverifiableCount = stats.unverified + stats.blocked
  const activeFilter: ExternalFilter = filter === 'unverified' && unverifiableCount === 0 ? 'all' : filter

  const filteredResults = useMemo(() => {
    if (activeFilter === 'all') return classified
    const states = FILTER_STATES[activeFilter]
    return classified.filter((r) => states.includes(r.state))
  }, [classified, activeFilter])

  // Initial state: prompt to scan
  if (!data && !loading && !error) {
    return (
      <ListCard title={t.sitemapAudit.externalLinks}>
        <EmptyState
          action={
            <Button buttonStyle="primary" margin={false} onClick={() => handleScan()}>
              {t.sitemapAudit.scanExternalLinks}
            </Button>
          }
          title={t.sitemapAudit.checkExternalLinksDesc}
        />
      </ListCard>
    )
  }

  // Loading state
  if (loading) {
    return (
      <ListCard flush={false} title={t.sitemapAudit.externalLinks}>
        <LoadingState label={t.sitemapAudit.verificationInProgress} />
      </ListCard>
    )
  }

  // Error state
  if (error) {
    return (
      <ListCard flush={false} title={t.sitemapAudit.externalLinks}>
        <ErrorState error={error} onRetry={() => handleScan()} />
      </ListCard>
    )
  }

  if (!data) return null

  const stateLabel: Record<LinkState, string> = {
    ok: t.common.ok,
    broken: t.sitemapAudit.broken,
    timeout: t.sitemapAudit.timeout,
    error: t.sitemapAudit.unreachable,
    blocked: t.sitemapAudit.blocked,
    unverified: t.sitemapAudit.unverified,
  }
  const pending = data.pending ?? 0
  const partial = data.partial === true || pending > 0
  const checkedOf = stats.total + pending
  const hasNotices = data.capped === true || partial || continueError !== null

  return (
    <ListCard count={data.results.length} title={t.sitemapAudit.externalLinks}>
      {hasNotices && (
        <div className="seo-sitemap__notices">
          {data.capped === true && (
            <Banner type="default">
              {t.sitemapAudit.externalCapped
                .replace('{max}', String(data.maxLinks ?? stats.total + pending))
                .replace('{total}', String(data.totalFound ?? ''))}
            </Banner>
          )}
          {partial && (
            <Banner type="warning">
              <div className="seo-sitemap__notice">
                <span>
                  {t.sitemapAudit.externalPartial
                    .replace('{checked}', String(stats.total))
                    .replace('{total}', String(checkedOf))
                    .replace('{pending}', String(pending))}
                  {data.stoppedBy === 'budget' && ` ${t.sitemapAudit.externalStoppedBudget}`}
                  {data.stoppedBy === 'deadline' && ` ${t.sitemapAudit.externalStoppedDeadline}`}
                </span>
                <Button
                  buttonStyle="secondary"
                  disabled={continuing}
                  icon={<RefreshIcon />}
                  iconPosition="left"
                  margin={false}
                  onClick={handleContinue}
                >
                  {continuing ? t.sitemapAudit.continuingScan : t.sitemapAudit.continueScan}
                </Button>
              </div>
            </Banner>
          )}
          {continueError !== null && (
            <Banner type="danger">
              {t.common.loadingError}: {continueError}
            </Banner>
          )}
        </div>
      )}

      {/* Stats bar: one pill per bucket, so they add up to the total */}
      <div className="seo-sitemap__toolbar">
        <div className="seo-row">
          <Pill size="small">
            {stats.total} {t.sitemapAudit.total}
          </Pill>
          {PILL_ORDER.filter((s) => stats[s] > 0 || s === 'ok' || s === 'broken').map((s) => (
            <TonePill key={s} tone={LINK_STATE_TONE[s]}>
              {stats[s]} {stateLabel[s]}
            </TonePill>
          ))}
        </div>
        <div className="seo-row">
          {/* Filter toggles */}
          {(['all', 'broken', 'unverified', 'ok'] as ExternalFilter[])
            .filter((f) => f !== 'unverified' || unverifiableCount > 0)
            .map((f) => {
              const active = activeFilter === f
              const label =
                f === 'all'
                  ? t.sitemapAudit.all
                  : f === 'broken'
                    ? t.sitemapAudit.brokenLabel
                    : f === 'unverified'
                      ? t.sitemapAudit.unverifiedLabel
                      : t.common.ok
              return (
                <Button
                  aria-pressed={active}
                  buttonStyle="pill"
                  key={f}
                  margin={false}
                  onClick={() => setFilter(f)}
                  selected={active}
                >
                  {label}
                </Button>
              )
            })}
          {/* Export CSV (everything that isn't ok, with its state) */}
          {stats.total - stats.ok > 0 && (
            <Button buttonStyle="secondary" margin={false} onClick={handleExportCSV}>
              {t.common.exportCsv}
            </Button>
          )}
          {/* Rescan */}
          <Button
            buttonStyle="secondary"
            icon={<RefreshIcon />}
            iconPosition="left"
            margin={false}
            onClick={() => handleScan(true)}
            tooltip={t.sitemapAudit.forceNewVerification}
          >
            {t.sitemapAudit.rescan}
          </Button>
        </div>
      </div>
      {stats.unverified > 0 && (
        <p className="seo-text seo-text--small seo-text--secondary seo-sitemap__note">{t.sitemapAudit.unverifiedNote}</p>
      )}

      {/* Results table */}
      {filteredResults.length === 0 ? (
        <EmptyState title={activeFilter === 'broken' ? t.sitemapAudit.noBrokenLinks : t.sitemapAudit.noExternalLinks} />
      ) : (
        <DataTable aria-label={t.sitemapAudit.externalLinks} bare>
          <thead>
            <tr>
              <th>{t.seoConfig.url}</th>
              <th className="seo-table__num">
                <SrOnly>HTTP</SrOnly>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredResults.map((result, idx) => (
              <tr key={`ext-${idx}`}>
                <td>
                  <div className="seo-sitemap__cell">
                    <a
                      className={cx(
                        'seo-link seo-mono seo-truncate seo-sitemap__url',
                        FILTER_STATES.broken.includes(result.state) && 'seo-sitemap__link--broken',
                      )}
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={result.url}
                    >
                      {result.url.length > 60 ? result.url.substring(0, 60) + '...' : result.url}
                    </a>
                    <div className="seo-row seo-text seo-text--small seo-text--secondary">
                      {result.sourcePages.map((p, i) => (
                        <div className="seo-row seo-row--nowrap" key={`src-${i}`}>
                          <CollectionPill articleLabel={t.common.article} collection={p.collection} />
                          <span className="seo-mono">/{p.slug}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </td>
                <td className="seo-table__num">
                  {/* Status badge */}
                  {result.state === 'ok' ? (
                    <Pill alignIcon="left" icon={<CheckIcon />} pillStyle="success" size="small">
                      {result.status}
                    </Pill>
                  ) : (
                    <TonePill tone={LINK_STATE_TONE[result.state]}>
                      {result.state === 'blocked'
                        ? stateLabel.blocked.toUpperCase()
                        : result.error
                          ? result.error.toUpperCase()
                          : result.status}
                    </TonePill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </ListCard>
  )
}

// ---------------------------------------------------------------------------
// Export helpers (C6)
// ---------------------------------------------------------------------------
function exportJSON(data: SitemapAuditData) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const now = new Date().toISOString().split('T')[0]
  const a = document.createElement('a')
  a.href = url
  a.download = `sitemap-audit-${now}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function exportCSV(data: SitemapAuditData, t: DashboardTranslations) {
  const rows: string[][] = [['type', 'slug', 'title', 'collection', 'details']]

  for (const p of data.orphanPages) {
    rows.push(['orphan', p.slug, p.title, p.collection, t.sitemapAudit.zeroIncomingLinks])
  }
  for (const p of data.weakPages) {
    const from = p.incomingFrom?.[0]?.slug || '?'
    rows.push(['weak', p.slug, p.title, p.collection, `${t.sitemapAudit.oneIncomingLink} ${t.sitemapAudit.from} /${from}`])
  }
  for (const h of data.linkHubs) {
    rows.push(['hub', h.slug, h.title, h.collection, `${h.outgoingCount} ${t.sitemapAudit.links}`])
  }
  for (const b of data.brokenLinks) {
    rows.push(['broken-source', b.sourceSlug, b.sourceTitle, b.collection, `${t.sitemapAudit.brokenLinkTo} /${b.targetSlug}`])
  }

  // toCsv neutralizes spreadsheet formulas — see helpers/csv.ts.
  const csvContent = toCsv(rows)

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const now = new Date().toISOString().split('T')[0]
  const a = document.createElement('a')
  a.href = url
  a.download = `sitemap-audit-${now}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Main SitemapAuditView component
// ---------------------------------------------------------------------------
export function SitemapAuditView() {
  const seoApi = useSeoApi()
  // One base id per mount: the tab/panel wiring must not collide if the view
  // is ever mounted twice on the same screen.
  const uid = useId()
  const t = useDashboardT()
  const [data, setData] = useState<SitemapAuditData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('orphan')
  const [search, setSearch] = useState('')
  const [scoreMap, setScoreMap] = useState<Map<string, number>>(new Map())
  const [logs404Count, setLogs404Count] = useState(0)
  // Tabs backed by optional features: hidden (and never fetched) when the flag is off.
  // `undefined` (flags unavailable) keeps them, as before.
  const seoLogsEnabled = useSeoFeature('seoLogs') !== false
  const externalLinksEnabled = useSeoFeature('externalLinks') !== false

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // C3: Parallel fetch for sitemap audit + SEO scores + 404 logs count
      const [sitemapRes, auditRes, logsRes] = await Promise.all([
        fetch(seoApi('/sitemap-audit'), { credentials: 'include', cache: 'no-store' }),
        fetch(seoApi('/audit'), { credentials: 'include', cache: 'no-store' }),
        seoLogsEnabled
          ? fetch(seoApi('/seo-logs'), { credentials: 'include', cache: 'no-store' }).catch(() => null)
          : null,
      ])
      if (!sitemapRes.ok) throw new Error(`HTTP ${sitemapRes.status}`)
      const json = await sitemapRes.json()
      setData(json)

      // Build score map from audit results
      if (auditRes.ok) {
        try {
          const auditJson = await auditRes.json()
          const results = auditJson.results || auditJson
          if (Array.isArray(results)) {
            const map = new Map<string, number>()
            for (const item of results) {
              if (item.slug && typeof item.score === 'number') {
                map.set(item.slug, item.score)
              }
            }
            setScoreMap(map)
          }
        } catch {
          // Non-critical — proceed without scores
        }
      }

      // Fetch 404 logs count
      if (logsRes && logsRes.ok) {
        try {
          const logsJson = await logsRes.json()
          setLogs404Count(logsJson.logs?.length || 0)
        } catch { /* ignore */ }
      }

      // Auto-select the tab with most critical issues
      if (json.stats.brokenCount > 0) setActiveTab('broken')
      else if (json.stats.orphanCount > 0) setActiveTab('orphan')
      else if (json.stats.weakCount > 0) setActiveTab('weak')
      else setActiveTab('hubs')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t.common.loadingError)
    }
    setLoading(false)
  }, [t, seoApi, seoLogsEnabled])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Filter items based on search
  const filtered = useMemo(() => {
    if (!data) return null
    const q = search.toLowerCase().trim()
    if (!q) return data

    return {
      ...data,
      orphanPages: data.orphanPages.filter(
        (p) => p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q),
      ),
      weakPages: data.weakPages.filter(
        (p) => p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q),
      ),
      linkHubs: data.linkHubs.filter(
        (h) => h.title.toLowerCase().includes(q) || h.slug.toLowerCase().includes(q),
      ),
      brokenLinks: data.brokenLinks.filter(
        (l) =>
          l.sourceTitle.toLowerCase().includes(q) ||
          l.sourceSlug.toLowerCase().includes(q) ||
          l.targetSlug.toLowerCase().includes(q) ||
          l.targetUrl.toLowerCase().includes(q),
      ),
    }
  }, [data, search])

  // Loading state
  if (loading) {
    return (
      <>
        <ViewHeader title={t.sitemapAudit.title} />
        <ViewBody>
          <LoadingState label={t.sitemapAudit.analyzingInternal} />
          <LiveRegion message={t.sitemapAudit.analyzingInternal} />
        </ViewBody>
      </>
    )
  }

  // Error state
  if (error) {
    return (
      <>
        <ViewHeader title={t.sitemapAudit.title} />
        <ViewBody>
          <Banner type="danger">
            <div className="seo-stack seo-stack--tight">
              <strong>{t.common.loadingError}</strong>
              <span>{error}</span>
            </div>
          </Banner>
          <LiveRegion assertive message={`${t.common.loadingError}: ${error}`} />
          <div>
            <Button buttonStyle="secondary" margin={false} onClick={fetchData}>
              {t.common.retry}
            </Button>
          </div>
        </ViewBody>
      </>
    )
  }

  if (!data || !filtered) return null

  const { stats } = data

  const tabs: Array<{ value: TabId; label: string; count?: number }> = [
    { value: 'orphan', label: t.sitemapAudit.orphanedPages, count: filtered.orphanPages.length },
    { value: 'weak', label: t.sitemapAudit.fragilePages, count: filtered.weakPages.length },
    { value: 'hubs', label: t.sitemapAudit.linkHubs, count: filtered.linkHubs.length },
    { value: 'broken', label: t.sitemapAudit.brokenLinks, count: filtered.brokenLinks.length },
    ...(seoLogsEnabled ? [{ value: 'logs404' as const, label: t.sitemapAudit.logs404, count: logs404Count }] : []),
    ...(externalLinksEnabled ? [{ value: 'external' as const, label: t.sitemapAudit.externalLinks }] : []),
  ]

  const summary = `${stats.totalPages} ${t.common.page.toLowerCase()}s, ${stats.totalLinks} ${t.sitemapAudit.links}`

  return (
    <>
      <ViewHeader
        actions={
          <>
            {/* C6: Export buttons + Refresh */}
            <Button buttonStyle="secondary" margin={false} onClick={() => exportJSON(data)}>
              {t.common.exportJson}
            </Button>
            <Button buttonStyle="secondary" margin={false} onClick={() => exportCSV(data, t)}>
              {t.common.exportCsv}
            </Button>
            <Button
              buttonStyle="secondary"
              icon={<RefreshIcon />}
              iconPosition="left"
              margin={false}
              onClick={fetchData}
            >
              {t.common.refresh}
            </Button>
          </>
        }
        description={summary}
        title={t.sitemapAudit.title}
      />
      <ViewBody>
        {/* The crawl runs for a while: announce that it is over. */}
        <LiveRegion message={summary} />

        {/* Stats cards */}
        <Grid>
          <StatTile label={t.sitemapAudit.totalPages} value={stats.totalPages} />
          <StatTile label={t.sitemapAudit.internalLinks} value={stats.totalLinks} />
          <StatTile
            hint={t.sitemapAudit.average}
            label={t.sitemapAudit.linksPerPage}
            tone={stats.avgLinksPerPage >= 3 ? 'success' : 'warning'}
            value={stats.avgLinksPerPage}
          />
          <StatTile
            label={t.sitemapAudit.orphaned}
            tone={stats.orphanCount === 0 ? 'success' : 'danger'}
            value={stats.orphanCount}
          />
          <StatTile
            label={t.sitemapAudit.fragile}
            tone={stats.weakCount === 0 ? 'success' : 'warning'}
            value={stats.weakCount}
          />
          <StatTile
            label={t.sitemapAudit.brokenLinks}
            tone={stats.brokenCount === 0 ? 'success' : 'danger'}
            value={stats.brokenCount}
          />
        </Grid>

        {/* Search bar */}
        <input
          type="text"
          aria-label={t.sitemapAudit.searchPlaceholder}
          className="seo-input seo-sitemap__search"
          placeholder={t.sitemapAudit.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* Tabs */}
        <div role="group" aria-label={t.sitemapAudit.title}>
          <Tabs<TabId>
            onChange={setActiveTab}
            tabs={tabs.map((tab) => ({
              id: `${uid}-tab-${tab.value}`,
              panelID: `${uid}-panel-${tab.value}`,
              value: tab.value,
              label: (
                <>
                  {tab.label}
                  {tab.count !== undefined && <Pill size="small">{tab.count}</Pill>}
                </>
              ),
            }))}
            value={activeTab}
          />
        </div>

        {/* Tab content */}
        <div
          role="tabpanel"
          id={`${uid}-panel-${activeTab}`}
          aria-labelledby={`${uid}-tab-${activeTab}`}
          tabIndex={0}
        >
          {activeTab === 'orphan' && <OrphanTab pages={filtered.orphanPages} scoreMap={scoreMap} />}
          {activeTab === 'weak' && <WeakTab pages={filtered.weakPages} scoreMap={scoreMap} />}
          {activeTab === 'hubs' && <HubsTab hubs={filtered.linkHubs} />}
          {activeTab === 'broken' && <BrokenTab links={filtered.brokenLinks} onRefresh={fetchData} />}
          {activeTab === 'logs404' && seoLogsEnabled && <Logs404Tab />}
          {activeTab === 'external' && externalLinksEnabled && <ExternalLinksTab />}
        </div>
      </ViewBody>
    </>
  )
}
