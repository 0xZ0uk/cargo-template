/**
 * SEO monitoring & alerts (SEO 2026) — proactive digest for agencies.
 *
 *   GET  /alerts-digest → build and return the current digest (admin) — preview, no send
 *   POST /alerts-run    → build and DELIVER the digest now (admin) — webhook + email
 *
 * Sources (all best-effort, skipped silently if the dataset is absent), read from the
 * plugin's data store (`dataStore` option):
 *   - Score regressions  (seo-score-history): pages whose score dropped ≥ threshold in window
 *   - New 404s           (seo-logs):          404s seen within the window
 *   - Ranking drops      (seo-rank-history):  queries that fell ≥ threshold positions
 *
 * Delivery + thresholds are configured via ENV (consistent with the rest of the plugin —
 * keeps URLs/recipients out of tracked config):
 *   SEO_ALERT_WEBHOOK_URL, SEO_ALERT_EMAIL (comma-separated),
 *   SEO_ALERT_SCORE_DROP (default 10), SEO_ALERT_POSITION_DROP (default 5),
 *   SEO_ALERT_WINDOW_HOURS (default 24)
 *
 * Gated behind `features.alerts` (opt-in). Email uses Payload's configured email adapter.
 */
import type { Payload, PayloadHandler } from 'payload'

import { isSeoAdminRequest as isAdmin } from '../helpers/isAdmin.js'
import { escapeHtml } from '../helpers/escapeHtml.js'
import { requestOrigin } from '../helpers/siteUrl.js'
import { payloadStoreResolver, type RankSnapshot, type ScoreSnapshot, type SeoDataStoreResolver } from '../store/index.js'

export interface AlertConfig {
  webhookUrl: string
  emails: string[]
  scoreDrop: number
  positionDrop: number
  windowHours: number
}

export function getAlertConfig(): AlertConfig {
  return {
    webhookUrl: process.env.SEO_ALERT_WEBHOOK_URL || '',
    emails: (process.env.SEO_ALERT_EMAIL || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    scoreDrop: parseInt(process.env.SEO_ALERT_SCORE_DROP || '10', 10) || 10,
    positionDrop: parseInt(process.env.SEO_ALERT_POSITION_DROP || '5', 10) || 5,
    windowHours: Math.max(1, parseInt(process.env.SEO_ALERT_WINDOW_HOURS || '24', 10) || 24),
  }
}

export interface AlertDigest {
  since: string
  generatedAt: string
  scoreRegressions: Array<{ documentId: string; collection: string; from: number; to: number; drop: number }>
  newNotFound: Array<{ url: string; count: number; lastSeen: string }>
  rankDrops: Array<{ query: string; from: number; to: number; drop: number }>
  totalIssues: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

export async function buildAlertDigest(
  payload: Payload,
  cfg: AlertConfig,
  resolveStore: SeoDataStoreResolver = payloadStoreResolver,
): Promise<AlertDigest> {
  const store = resolveStore(payload)
  const now = Date.now()
  const since = new Date(now - cfg.windowHours * 3_600_000).toISOString()

  // --- Score regressions (compare latest vs oldest snapshot within a 14-day window) ---
  const scoreRegressions: AlertDigest['scoreRegressions'] = []
  try {
    const hist = await store.scoreHistory.list({
      since: new Date(now - 14 * 86_400_000).toISOString(),
      limit: 5000,
    })
    const byDoc = new Map<string, ScoreSnapshot[]>()
    for (const h of hist) {
      const key = `${h.documentId}::${h.collection}`
      const arr = byDoc.get(key)
      if (arr) arr.push(h)
      else byDoc.set(key, [h])
    }
    for (const [key, snaps] of byDoc) {
      const latest = snaps[0]! // newest (global desc sort)
      const oldest = snaps[snaps.length - 1]!
      const drop = oldest.score - latest.score
      if (drop >= cfg.scoreDrop) {
        const [documentId, collection] = key.split('::')
        scoreRegressions.push({
          documentId: documentId!,
          collection: collection!,
          from: oldest.score,
          to: latest.score,
          drop,
        })
      }
    }
    scoreRegressions.sort((a, b) => b.drop - a.drop)
  } catch {
    // collection absent — skip
  }

  // --- New 404s within the window ---
  const newNotFound: AlertDigest['newNotFound'] = []
  try {
    const logs = await store.notFound.list({ seenSince: since, limit: 50 })
    for (const l of logs) {
      newNotFound.push({ url: l.url || '', count: l.count || 1, lastSeen: l.lastSeen || '' })
    }
  } catch {
    // collection absent — skip
  }

  // --- Ranking drops (latest vs previous distinct day) ---
  const rankDrops: AlertDigest['rankDrops'] = []
  try {
    const ranks = await store.rankHistory.list({
      since: new Date(now - 35 * 86_400_000).toISOString(),
      limit: 5000,
    })
    const byQuery = new Map<string, RankSnapshot[]>()
    for (const r of ranks) {
      const q = r.query
      const arr = byQuery.get(q)
      if (arr) arr.push(r)
      else byQuery.set(q, [r])
    }
    for (const [query, snaps] of byQuery) {
      const latest = snaps[0]!
      const previous = snaps.find((s) => s.dateKey !== latest.dateKey)
      if (!previous) continue
      // position is "lower is better" — a drop means latest position is larger than previous.
      const drop = round1(latest.position - previous.position)
      if (drop >= cfg.positionDrop) {
        rankDrops.push({ query, from: previous.position, to: latest.position, drop })
      }
    }
    rankDrops.sort((a, b) => b.drop - a.drop)
  } catch {
    // collection absent — skip
  }

  const totalIssues = scoreRegressions.length + newNotFound.length + rankDrops.length
  return {
    since,
    generatedAt: new Date().toISOString(),
    scoreRegressions,
    newNotFound,
    rankDrops,
    totalIssues,
  }
}

/**
 * The digest is emailed to administrators, and several of its values come from
 * untrusted sources: `newNotFound.url` is a 404 path logged from an anonymous
 * visitor and `rankDrops.query` comes from Search Console. Interpolated raw,
 * they let anyone inject markup — typically a phishing link — into a mail that
 * legitimately originates from the CMS. Everything non-numeric is escaped.
 */
function digestToHtml(digest: AlertDigest, siteUrl?: string): string {
  const section = (title: string, rows: string[]) =>
    rows.length
      ? `<h3 style="margin:18px 0 6px">${title}</h3><ul style="margin:0;padding-left:18px">${rows.join('')}</ul>`
      : ''

  const reg = digest.scoreRegressions
    .slice(0, 20)
    .map(
      (r) =>
        `<li>${escapeHtml(String(r.collection))}/${escapeHtml(String(r.documentId))} — score ${r.from} → <b>${r.to}</b> (−${r.drop})</li>`,
    )
  const nf = digest.newNotFound
    .slice(0, 20)
    .map((n) => `<li><code>${escapeHtml(String(n.url))}</code> — ${n.count}×</li>`)
  const rd = digest.rankDrops
    .slice(0, 20)
    .map(
      (d) =>
        `<li>“${escapeHtml(String(d.query))}” — #${round1(d.from)} → <b>#${round1(d.to)}</b> (▼${d.drop})</li>`,
    )

  return `<div style="font-family:system-ui;max-width:640px">
  <h2>SEO alert digest${siteUrl ? ` — ${escapeHtml(siteUrl)}` : ''}</h2>
  <p style="color:#6b7280;font-size:13px">${digest.totalIssues} issue(s) since ${new Date(digest.since).toLocaleString()}</p>
  ${section('📉 Score regressions', reg)}
  ${section('🔗 New 404s', nf)}
  ${section('🔻 Ranking drops', rd)}
  ${digest.totalIssues === 0 ? '<p>No issues to report. 🎉</p>' : ''}
</div>`
}

/** A webhook that hasn't answered by then counts as failed (a scheduled run must not hang). */
const WEBHOOK_TIMEOUT_MS = 10_000

export interface DeliveryResult {
  sent: boolean
  reason?: string
  channels: { webhook: boolean; email: boolean }
}

export async function deliverAlertDigest(
  payload: Payload,
  digest: AlertDigest,
  cfg: AlertConfig,
  siteUrl?: string,
): Promise<DeliveryResult> {
  const channels = { webhook: false, email: false }

  if (digest.totalIssues === 0) {
    return { sent: false, reason: 'nothing_to_report', channels }
  }

  if (cfg.webhookUrl) {
    try {
      const res = await fetch(cfg.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'seo-alert-digest', siteUrl, digest }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      })
      // A 4xx/5xx (revoked hook, wrong URL, payload rejected) is a failed delivery, not a sent one.
      if (res.ok) channels.webhook = true
      else payload.logger.warn(`[seo] alerts: webhook delivery failed: HTTP ${res.status}`)
      // Release the connection; the body is never used.
      await res.body?.cancel().catch(() => {})
    } catch (e) {
      payload.logger.warn(`[seo] alerts: webhook delivery failed: ${e instanceof Error ? e.message : 'error'}`)
    }
  }

  if (cfg.emails.length > 0) {
    const p = payload as unknown as { email?: { name?: string }; sendEmail?: (opts: unknown) => Promise<unknown> }
    const send = p.sendEmail
    // Without `config.email`, Payload installs its `console` adapter, whose sendEmail only logs
    // and resolves: counting that as delivered would be a false success, so it counts as none.
    if (typeof send === 'function' && p.email?.name !== 'console') {
      try {
        await send({
          to: cfg.emails,
          subject: `SEO alert digest — ${digest.totalIssues} issue(s)`,
          html: digestToHtml(digest, siteUrl),
        })
        channels.email = true
      } catch (e) {
        payload.logger.warn(`[seo] alerts: email delivery failed: ${e instanceof Error ? e.message : 'error'}`)
      }
    } else {
      payload.logger.warn('[seo] alerts: SEO_ALERT_EMAIL is set but Payload has no email adapter')
    }
  }

  const sent = channels.webhook || channels.email
  const configured = !!cfg.webhookUrl || cfg.emails.length > 0
  return { sent, reason: sent ? undefined : configured ? 'delivery_failed' : 'no_channel_configured', channels }
}

// ---------------------------------------------------------------------------
// GET /alerts-digest — preview (admin)
// ---------------------------------------------------------------------------
export function createAlertsDigestHandler(resolveStore: SeoDataStoreResolver = payloadStoreResolver): PayloadHandler {
  return async (req) => {
    try {
      if (!isAdmin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const cfg = getAlertConfig()
      const digest = await buildAlertDigest(req.payload, cfg, resolveStore)
      return Response.json(
        {
          digest,
          config: {
            webhookConfigured: !!cfg.webhookUrl,
            emailConfigured: cfg.emails.length > 0,
            scoreDrop: cfg.scoreDrop,
            positionDrop: cfg.positionDrop,
            windowHours: cfg.windowHours,
          },
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[seo] alerts-digest error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}

// ---------------------------------------------------------------------------
// POST /alerts-run — build + deliver now (admin)
// ---------------------------------------------------------------------------
export function createAlertsRunHandler(
  siteUrl?: string,
  resolveStore: SeoDataStoreResolver = payloadStoreResolver,
): PayloadHandler {
  return async (req) => {
    try {
      if (!isAdmin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const cfg = getAlertConfig()
      const digest = await buildAlertDigest(req.payload, cfg, resolveStore)
      // A configured site URL wins; otherwise the request's origin, so the receiver can tell
      // which site sent it. (The scheduled digest has no request: it needs `siteUrl` / SITE_URL.)
      const delivery = await deliverAlertDigest(req.payload, digest, cfg, siteUrl || requestOrigin(req))
      return Response.json({ digest, delivery }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[seo] alerts-run error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
