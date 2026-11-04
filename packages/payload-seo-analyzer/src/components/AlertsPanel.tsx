'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Banner, Button } from '@payloadcms/ui'
import { useSeoFeature } from '../hooks/useSeoLocale.js'
import { Card, Checklist, EmptyState, LoadingState, TonePill, type Tone } from '../ui/index.js'
import { useSeoApi } from '../hooks/useSeoApi.js'

const s = {
  title: 'Monitoring & alerts',
  subtitle: 'Periodic digest: score regressions, new 404s, ranking drops (webhook / email).',
  notConfigured:
    'No channel configured. Set SEO_ALERT_WEBHOOK_URL and/or SEO_ALERT_EMAIL on the server, then enable features.alerts.',
  noChannel: 'No channel configured, so the digest goes nowhere. Set SEO_ALERT_WEBHOOK_URL and/or SEO_ALERT_EMAIL on the server.',
  webhook: 'Webhook',
  email: 'Email',
  configured: 'configured',
  missing: 'missing',
  preview: 'Preview',
  sendNow: 'Send now',
  sending: 'Sending…',
  loading: 'Loading…',
  noIssues: 'No issues for the period.',
  scoreReg: 'Score regressions',
  notFound: 'New 404s',
  rankDrops: 'Ranking drops',
  sent: 'Digest sent',
  nothingToSend: 'Nothing to send (no issues).',
  deliveryFailed: 'Delivery failed: check the webhook URL or the email adapter (details in the logs).',
  issues: 'issue(s)',
} as const

interface Digest {
  since: string
  totalIssues: number
  scoreRegressions: Array<{ documentId: string; collection: string; from: number; to: number; drop: number }>
  newNotFound: Array<{ url: string; count: number; lastSeen: string }>
  rankDrops: Array<{ query: string; from: number; to: number; drop: number }>
}
interface Config {
  webhookConfigured: boolean
  emailConfigured: boolean
  scoreDrop: number
  positionDrop: number
  windowHours: number
}

export function AlertsPanel() {
  const seoApi = useSeoApi()
  const alertsEnabled = useSeoFeature('alerts')
  const [digest, setDigest] = useState<Digest | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (alertsEnabled === false) {
        // features.alerts is off, so the endpoint is not registered: calling it
        // would only make the browser log a 404 on every visit. Same state as a 404.
        setConfig({ webhookConfigured: false, emailConfigured: false, scoreDrop: 0, positionDrop: 0, windowHours: 0 })
        setDigest(null)
        return
      }
      const res = await fetch(seoApi('/alerts-digest'), { credentials: 'include', cache: 'no-store' })
      if (res.status === 404 || res.status === 403) {
        // Feature not enabled (features.alerts) or insufficient rights — show the hint, not an error.
        setConfig({ webhookConfigured: false, emailConfigured: false, scoreDrop: 0, positionDrop: 0, windowHours: 0 })
        setDigest(null)
        return
      }
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || `Error ${res.status}`)
        return
      }
      setDigest(json.digest as Digest)
      setConfig(json.config as Config)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [alertsEnabled])

  useEffect(() => {
    void load()
  }, [load])

  const sendNow = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(seoApi('/alerts-run'), { method: 'POST', credentials: 'include' })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || `Error ${res.status}`)
        return
      }
      if (json.delivery?.reason === 'delivery_failed') setError(s.deliveryFailed)
      else setNotice(json.delivery?.sent ? s.sent : s.nothingToSend)
      if (json.digest) setDigest(json.digest as Digest)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  const hasChannel = config && (config.webhookConfigured || config.emailConfigured)

  const list = (title: string, rows: string[], tone: Tone) =>
    rows.length ? (
      <section className="seo-stack seo-stack--tight">
        <h4 className="seo-row seo-text seo-text--strong">
          {title}
          <TonePill tone={tone}>{rows.length}</TonePill>
        </h4>
        <Checklist
          items={rows.slice(0, 8).map((r, i) => ({
            id: String(i),
            tone,
            content: <span className="seo-text seo-text--small">{r}</span>,
          }))}
        />
      </section>
    ) : null

  return (
    <Card
      actions={
        hasChannel ? (
          <Button buttonStyle="secondary" disabled={busy} margin={false} onClick={sendNow} size="medium">
            {busy ? s.sending : s.sendNow}
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
      {notice && (
        <div role="status">
          <Banner type="success">{notice}</Banner>
        </div>
      )}

      {config && (
        <div className="seo-row">
          <TonePill tone={config.webhookConfigured ? 'success' : 'neutral'}>
            {s.webhook}: {config.webhookConfigured ? s.configured : s.missing}
          </TonePill>
          <TonePill tone={config.emailConfigured ? 'success' : 'neutral'}>
            {s.email}: {config.emailConfigured ? s.configured : s.missing}
          </TonePill>
        </div>
      )}

      {/* A digest means the endpoint answered, so the feature is on: only the channel is missing. */}
      {!loading && !hasChannel && <Banner type="default">{digest ? s.noChannel : s.notConfigured}</Banner>}

      {loading && <LoadingState label={s.loading} />}

      {digest && (
        <div className="seo-stack">
          <p className="seo-text seo-text--small seo-text--secondary">
            {digest.totalIssues} {s.issues}
          </p>
          {digest.totalIssues === 0 && <EmptyState title={s.noIssues} />}
          {list(
            s.scoreReg,
            digest.scoreRegressions.map((r) => `${r.collection}/${r.documentId} — ${r.from} → ${r.to} (−${r.drop})`),
            'danger',
          )}
          {list(s.notFound, digest.newNotFound.map((n) => `${n.url} — ${n.count}×`), 'warning')}
          {list(s.rankDrops, digest.rankDrops.map((d) => `“${d.query}” — #${d.from} → #${d.to} (−${d.drop})`), 'danger')}
        </div>
      )}
    </Card>
  )
}
