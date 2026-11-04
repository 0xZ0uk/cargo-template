/**
 * Webhook payloads for the alerts digest.
 *
 * `json` is the plugin's own payload (`{ type, siteUrl, digest }`). Slack and Discord incoming
 * webhooks reject that: they want `text` / `content`, so those formats render the digest as a
 * readable message instead.
 *
 * The digest holds values an anonymous visitor controls (the 404 path) or Search Console does
 * (the query), and the message lands in a team channel. They always go in a code span with
 * backticks and control characters removed, Slack's `& < >` are escaped (so no `<!channel>`
 * or `<url|label>` can be injected), and the Discord payload turns off every mention.
 */
import type { AlertDigest } from './endpoints/alerts.js'

export const ALERT_WEBHOOK_FORMATS = ['json', 'slack', 'discord'] as const
export type AlertWebhookFormat = (typeof ALERT_WEBHOOK_FORMATS)[number]

/** Discord rejects `content` over 2000 characters. */
export const DISCORD_MAX_CONTENT = 2000
/**
 * Slack accepts far more in `text` (about 40,000), but it collapses messages past ~4,000 characters
 * behind a "show more", which defeats a digest. Keep it to one screen.
 */
export const SLACK_MAX_TEXT = 3500

/** Longest item (a path, a query) shown before it's cut with an ellipsis. */
const MAX_ITEM_CHARS = 100
/** Most items listed per section, before the size limit trims further. */
const MAX_ITEMS_PER_SECTION = 10

export function isAlertWebhookFormat(value: unknown): value is AlertWebhookFormat {
  return typeof value === 'string' && (ALERT_WEBHOOK_FORMATS as readonly string[]).includes(value)
}

/** Guess the format from the webhook URL's host (`json` for anything else, or an invalid URL). */
export function detectAlertWebhookFormat(webhookUrl: string): AlertWebhookFormat {
  let url: URL
  try {
    url = new URL(webhookUrl)
  } catch {
    return 'json'
  }
  const host = url.hostname.toLowerCase()
  if (host === 'hooks.slack.com') return 'slack'
  if ((host === 'discord.com' || host === 'discordapp.com' || host.endsWith('.discord.com') || host.endsWith('.discordapp.com')) && url.pathname.startsWith('/api/webhooks/')) {
    return 'discord'
  }
  return 'json'
}

/**
 * The format to send: the `SEO_ALERT_WEBHOOK_FORMAT` value, else the plugin option, else the one
 * the URL's host implies. An env value that isn't a format is ignored (and reported via `invalidEnv`).
 */
export function resolveAlertWebhookFormat(args: {
  env?: string
  option?: AlertWebhookFormat
  url: string
}): { format: AlertWebhookFormat; invalidEnv?: string } {
  const env = args.env?.trim().toLowerCase()
  const invalidEnv = env && !isAlertWebhookFormat(env) ? args.env!.trim() : undefined
  if (env && isAlertWebhookFormat(env)) return { format: env }
  const format = isAlertWebhookFormat(args.option) ? args.option : detectAlertWebhookFormat(args.url)
  return invalidEnv ? { format, invalidEnv } : { format }
}

type Flavor = 'slack' | 'discord'

const round1 = (n: number) => Math.round(n * 10) / 10

/** One line of plain text: no control characters, no backticks (they'd end a code span). */
function plain(value: unknown): string {
  return String(value)
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/`/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** Slack control characters; the only escaping its `text` field needs. */
function slackEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** An untrusted value as an inline code span. */
function code(flavor: Flavor, value: unknown): string {
  const text = clip(plain(value) || '(empty)', MAX_ITEM_CHARS)
  return `\`${flavor === 'slack' ? slackEscape(text) : text}\``
}

function bold(flavor: Flavor, text: string): string {
  return flavor === 'slack' ? `*${text}*` : `**${text}**`
}

/** `2026-11-04 04:00 UTC`, independent of the server's locale and time zone. */
function utc(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? plain(iso) : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** The site's `/admin/performance` URL, or `undefined` unless `siteUrl` is a plain http(s) URL. */
function performanceUrl(siteUrl?: string): string | undefined {
  if (!siteUrl) return undefined
  try {
    const url = new URL(siteUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    // Link by origin plus any base path, never carrying a query, hash or credentials.
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}/admin/performance`
  } catch {
    return undefined
  }
}

function renderMessage(flavor: Flavor, digest: AlertDigest, siteUrl: string | undefined, maxItems: number): string {
  const adminUrl = performanceUrl(siteUrl)
  const site = adminUrl ? new URL(adminUrl).host : undefined
  const lines: string[] = [
    `${bold(flavor, 'SEO alert digest')}${site ? ` — ${flavor === 'slack' ? slackEscape(site) : site}` : ''}`,
    `${digest.totalIssues} issue${digest.totalIssues === 1 ? '' : 's'} since ${utc(digest.since)}`,
  ]

  const section = <T>(title: string, rows: T[], line: (row: T) => string) => {
    if (rows.length === 0) return
    lines.push('', `${bold(flavor, title)} (${rows.length})`)
    for (const row of rows.slice(0, maxItems)) lines.push(`• ${line(row)}`)
    if (rows.length > maxItems) lines.push(`• …and ${rows.length - maxItems} more`)
  }

  section('📉 Score regressions', digest.scoreRegressions, (r) =>
    `${code(flavor, `${r.collection}/${r.documentId}`)} score ${r.from} → ${r.to} (−${r.drop})`,
  )
  section('🔗 New 404s', digest.newNotFound, (n) => `${code(flavor, n.url)} — ${n.count}×`)
  section('🔻 Ranking drops', digest.rankDrops, (d) =>
    `${code(flavor, d.query)} #${round1(d.from)} → #${round1(d.to)} (▼${round1(d.drop)})`,
  )

  if (adminUrl) {
    // Discord: `<…>` keeps the link from unfurling into a preview card.
    lines.push('', flavor === 'slack' ? `<${adminUrl}|Open the SEO dashboard>` : `[Open the SEO dashboard](<${adminUrl}>)`)
  }
  return lines.join('\n')
}

/** Render the digest, listing fewer items per section until it fits `limit` characters. */
export function renderAlertMessage(
  flavor: Flavor,
  digest: AlertDigest,
  siteUrl: string | undefined,
  limit: number,
): string {
  let message = ''
  for (let items = MAX_ITEMS_PER_SECTION; items >= 0; items--) {
    message = renderMessage(flavor, digest, siteUrl, items)
    if (message.length <= limit) return message
  }
  // Even the counts alone don't fit (an absurdly long site URL): cut, as a last resort.
  return `${message.slice(0, limit - 1)}…`
}

/** The JSON body to POST for a format. */
export function buildAlertWebhookBody(format: AlertWebhookFormat, digest: AlertDigest, siteUrl?: string): unknown {
  if (format === 'slack') return { text: renderAlertMessage('slack', digest, siteUrl, SLACK_MAX_TEXT) }
  if (format === 'discord') {
    return {
      content: renderAlertMessage('discord', digest, siteUrl, DISCORD_MAX_CONTENT),
      // A 404 path or query can spell `@everyone`; nothing in a digest may ping anyone.
      allowed_mentions: { parse: [] },
    }
  }
  return { type: 'seo-alert-digest', siteUrl, digest }
}
