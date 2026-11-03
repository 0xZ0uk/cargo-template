'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Banner, Button, RefreshIcon } from '@payloadcms/ui'
import { Card, Checklist, Grid, LoadingState, StatTile, TonePill, type Tone } from '../ui/index.js'
import { useSeoApi } from '../hooks/useSeoApi.js'

type Severity = 'pass' | 'warning' | 'fail'

interface DocRef {
  id?: string | number
  slug?: string
  title?: string
  collection?: string
  canonical?: string
}
interface IssueBlock {
  severity: Severity
  count: number
  docs?: DocRef[]
}
interface DuplicatedBlock {
  severity: Severity
  docCount: number
  groups: Array<{ canonical: string; count: number; docs: DocRef[] }>
}
interface HygieneResponse {
  summary?: { totalDocs?: number; totalFlagged?: number; overallSeverity?: Severity; capped?: boolean; maxDocs?: number }
  hygiene?: {
    totalDocs: number
    overallSeverity: Severity
    noindex: IssueBlock & { total?: number; pct?: number; massNoindex?: boolean }
    canonical: {
      duplicated: DuplicatedBlock
      missing: IssueBlock
      dangling: IssueBlock
    }
  }
}

const S = {
  fr: {
    title: 'Hygiène d’indexation',
    subtitle: 'Audit cross-page : noindex de masse, canonical cassé / dupliqué / manquant. Le seul « crash » SEO on-page vraiment actionnable.',
    unavailable: 'Audit d’indexation indisponible (réservé aux admins).',
    loading: 'Analyse de l’indexation…',
    clean: 'Indexation saine — aucun problème détecté.',
    refresh: 'Rafraîchir',
    docs: 'documents analysés',
    capped: (n: number) => `limité aux ${n} premiers documents (SEO_AUDIT_MAX_DOCS)`,
    noindex: 'En noindex',
    massNoindex: 'noindex de masse',
    dupCanonical: 'Canonical dupliqués',
    missingCanonical: 'Canonical manquants',
    danglingCanonical: 'Canonical cassés',
    page: 'Page',
    pass: 'OK',
    warning: 'À surveiller',
    fail: 'Critique',
  },
  en: {
    title: 'Indexation hygiene',
    subtitle: 'Cross-page audit: mass noindex, broken / duplicated / missing canonicals. The one truly actionable on-page SEO “crash”.',
    unavailable: 'Indexation audit unavailable (admin only).',
    loading: 'Analyzing indexation…',
    clean: 'Healthy indexation — no issues found.',
    refresh: 'Refresh',
    docs: 'documents analyzed',
    capped: (n: number) => `capped at the first ${n} documents (SEO_AUDIT_MAX_DOCS)`,
    noindex: 'Noindexed',
    massNoindex: 'mass noindex',
    dupCanonical: 'Duplicated canonicals',
    missingCanonical: 'Missing canonicals',
    danglingCanonical: 'Broken canonicals',
    page: 'Page',
    pass: 'OK',
    warning: 'Watch',
    fail: 'Critical',
  },
} as const

function sevTone(sev?: Severity): Tone {
  if (sev === 'fail') return 'danger'
  if (sev === 'warning') return 'warning'
  return 'success'
}

export function IndexationHygienePanel({ locale }: { locale: 'fr' | 'en' }) {
  const seoApi = useSeoApi()
  const s = S[locale] ?? S.fr
  const [data, setData] = useState<HygieneResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The endpoint caches the scan; Refresh asks for a rescan (honoured for SEO admins only).
  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(seoApi(force ? '/indexation-audit?nocache=1' : '/indexation-audit'), {
        credentials: 'include',
        cache: 'no-store',
      })
      if (res.status === 404 || res.status === 403) {
        setUnavailable(true)
        return
      }
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || `Error ${res.status}`)
        return
      }
      setUnavailable(false)
      setData(json as HygieneResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const h = data?.hygiene
  const sevLabel = (sev?: Severity) => (sev === 'fail' ? s.fail : sev === 'warning' ? s.warning : s.pass)

  const counter = (label: string, value: number, tone: Tone) => (
    <StatTile key={label} label={label} tone={tone} value={value} />
  )

  const docList = (docs: DocRef[] | undefined, tone: Tone) =>
    docs && docs.length > 0 ? (
      <Checklist
        items={docs.slice(0, 8).map((d, i) => ({
          id: `${d.slug || d.id || i}`,
          tone,
          content: (
            <span className="seo-text seo-text--small">
              {d.title || d.slug || String(d.id)}
              {d.canonical ? <span className="seo-text--secondary"> → {d.canonical}</span> : null}
            </span>
          ),
        }))}
      />
    ) : null

  const section = (title: string, tone: Tone, body: React.ReactNode) => (
    <section className="seo-stack seo-stack--tight">
      <h4 className={`seo-text seo-text--strong seo-text--${tone}`}>{title}</h4>
      {body}
    </section>
  )

  return (
    <Card
      actions={
        <>
          {h && <TonePill tone={sevTone(h.overallSeverity)}>{sevLabel(h.overallSeverity)}</TonePill>}
          {!unavailable && (
            <Button buttonStyle="secondary" icon={<RefreshIcon />} margin={false} onClick={() => void load(true)} size="medium">
              {s.refresh}
            </Button>
          )}
        </>
      }
      title={s.title}
    >
      <p className="seo-text seo-text--small seo-text--secondary">{s.subtitle}</p>

      {error && (
        <div role="alert">
          <Banner type="danger">{error}</Banner>
        </div>
      )}
      {unavailable && <Banner type="default">{s.unavailable}</Banner>}
      {loading && !unavailable && <LoadingState label={s.loading} />}

      {!loading && !unavailable && h && (
        <>
          <Grid>
            {counter(s.noindex, h.noindex?.count ?? 0, h.noindex?.massNoindex ? 'danger' : 'warning')}
            {counter(s.dupCanonical, h.canonical?.duplicated?.docCount ?? 0, sevTone(h.canonical?.duplicated?.severity))}
            {counter(s.missingCanonical, h.canonical?.missing?.count ?? 0, sevTone(h.canonical?.missing?.severity))}
            {counter(s.danglingCanonical, h.canonical?.dangling?.count ?? 0, sevTone(h.canonical?.dangling?.severity))}
          </Grid>
          <p className="seo-text seo-text--small seo-text--secondary">
            {h.totalDocs} {s.docs}
            {data?.summary?.capped ? ` · ${s.capped(data.summary.maxDocs ?? h.totalDocs)}` : ''}
            {h.noindex?.massNoindex ? ` · ${s.massNoindex} (${Math.round((h.noindex.pct ?? 0) * 100)}%)` : ''}
          </p>

          {(h.canonical?.duplicated?.docCount ?? 0) === 0 &&
          (h.canonical?.missing?.count ?? 0) === 0 &&
          (h.canonical?.dangling?.count ?? 0) === 0 &&
          (h.noindex?.count ?? 0) === 0 ? (
            <Banner type="success">{s.clean}</Banner>
          ) : (
            <div className="seo-stack">
              {(h.canonical?.dangling?.count ?? 0) > 0 &&
                section(s.danglingCanonical, sevTone(h.canonical.dangling.severity), docList(h.canonical.dangling.docs, sevTone(h.canonical.dangling.severity)))}
              {(h.canonical?.duplicated?.docCount ?? 0) > 0 &&
                section(
                  s.dupCanonical,
                  sevTone(h.canonical.duplicated.severity),
                  <Checklist
                    items={(h.canonical.duplicated.groups || []).slice(0, 6).map((g, i) => ({
                      id: `${g.canonical || i}`,
                      tone: sevTone(h.canonical.duplicated.severity),
                      content: (
                        <span className="seo-text seo-text--small">
                          {g.canonical} <span className="seo-text--secondary">— {g.count}</span>
                        </span>
                      ),
                    }))}
                  />,
                )}
              {(h.canonical?.missing?.count ?? 0) > 0 &&
                section(s.missingCanonical, sevTone(h.canonical.missing.severity), docList(h.canonical.missing.docs, sevTone(h.canonical.missing.severity)))}
              {(h.noindex?.count ?? 0) > 0 &&
                section(s.noindex, h.noindex.massNoindex ? 'danger' : 'warning', docList(h.noindex.docs, h.noindex.massNoindex ? 'danger' : 'warning'))}
            </div>
          )}
        </>
      )}
    </Card>
  )
}
