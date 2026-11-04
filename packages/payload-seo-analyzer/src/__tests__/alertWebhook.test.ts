import { describe, expect, it } from 'vitest'
import {
  buildAlertWebhookBody,
  DISCORD_MAX_CONTENT,
  detectAlertWebhookFormat,
  renderAlertMessage,
  resolveAlertWebhookFormat,
  SLACK_MAX_TEXT,
} from '../alertWebhook.js'
import type { AlertDigest } from '../endpoints/alerts.js'

const digest = (over: Partial<AlertDigest> = {}): AlertDigest => {
  const d: AlertDigest = {
    since: '2026-11-03T04:00:00.000Z',
    generatedAt: '2026-11-04T04:00:00.000Z',
    scoreRegressions: [{ documentId: '12', collection: 'pages', from: 88, to: 61, drop: 27 }],
    newNotFound: [{ url: '/gone', count: 4, lastSeen: '2026-11-04' }],
    rankDrops: [{ query: 'plombier paris', from: 4, to: 11.25, drop: 7.25 }],
    totalIssues: 0,
    ...over,
  }
  d.totalIssues = d.scoreRegressions.length + d.newNotFound.length + d.rankDrops.length
  return d
}

const many = (n: number): Partial<AlertDigest> => ({
  newNotFound: Array.from({ length: n }, (_, i) => ({ url: `/missing/page-number-${i}`, count: i + 1, lastSeen: '' })),
  scoreRegressions: Array.from({ length: n }, (_, i) => ({ documentId: String(i), collection: 'pages', from: 90, to: 50, drop: 40 })),
  rankDrops: Array.from({ length: n }, (_, i) => ({ query: `keyword ${i}`, from: 2, to: 9, drop: 7 })),
})

describe('detectAlertWebhookFormat', () => {
  it.each([
    ['https://hooks.slack.com/services/T000/B000/XXXX', 'slack'],
    ['https://HOOKS.SLACK.COM/services/T/B/X', 'slack'],
    ['https://discord.com/api/webhooks/123/abc', 'discord'],
    ['https://discordapp.com/api/webhooks/123/abc', 'discord'],
    ['https://canary.discord.com/api/webhooks/123/abc', 'discord'],
    ['https://discord.com/channels/1/2', 'json'],
    ['https://discord.com/api/v10/webhooks/123/abc', 'json'],
    ['https://example.com/hooks.slack.com', 'json'],
    ['https://hooks.slack.com.evil.test/services/x', 'json'],
    ['https://notdiscord.com/api/webhooks/1/a', 'json'],
    ['https://webhook.site/abc', 'json'],
    ['not a url', 'json'],
    ['', 'json'],
  ])('%s → %s', (url, format) => {
    expect(detectAlertWebhookFormat(url)).toBe(format)
  })
})

describe('resolveAlertWebhookFormat', () => {
  const slackUrl = 'https://hooks.slack.com/services/a/b/c'
  it('auto-detects from the URL when nothing is set', () => {
    expect(resolveAlertWebhookFormat({ url: slackUrl })).toEqual({ format: 'slack' })
    expect(resolveAlertWebhookFormat({ url: 'https://x.test/h' })).toEqual({ format: 'json' })
  })
  it('the plugin option beats detection', () => {
    expect(resolveAlertWebhookFormat({ option: 'json', url: slackUrl })).toEqual({ format: 'json' })
  })
  it('the env var beats the option and detection, case-insensitively', () => {
    expect(resolveAlertWebhookFormat({ env: ' Discord ', option: 'slack', url: slackUrl })).toEqual({ format: 'discord' })
  })
  it('ignores an unknown env value, reports it, and falls back', () => {
    expect(resolveAlertWebhookFormat({ env: 'teams', option: 'discord', url: slackUrl })).toEqual({
      format: 'discord',
      invalidEnv: 'teams',
    })
    expect(resolveAlertWebhookFormat({ env: 'teams', url: slackUrl })).toEqual({ format: 'slack', invalidEnv: 'teams' })
  })
  it('treats an empty env var as unset', () => {
    expect(resolveAlertWebhookFormat({ env: '', url: slackUrl })).toEqual({ format: 'slack' })
  })
})

describe('buildAlertWebhookBody', () => {
  it('json is the plugin payload, unchanged', () => {
    const d = digest()
    expect(buildAlertWebhookBody('json', d, 'https://site.test')).toEqual({
      type: 'seo-alert-digest',
      siteUrl: 'https://site.test',
      digest: d,
    })
  })

  it('slack renders a `text` message with mrkdwn and a link to /admin/performance', () => {
    const body = buildAlertWebhookBody('slack', digest(), 'https://site.test/') as { text: string }
    expect(Object.keys(body)).toEqual(['text'])
    expect(body.text).toBe(
      [
        '*SEO alert digest* — site.test',
        '3 issues since 2026-11-03 04:00 UTC',
        '',
        '*📉 Score regressions* (1)',
        '• `pages/12` score 88 → 61 (−27)',
        '',
        '*🔗 New 404s* (1)',
        '• `/gone` — 4×',
        '',
        '*🔻 Ranking drops* (1)',
        '• `plombier paris` #4 → #11.3 (▼7.3)',
        '',
        '<https://site.test/admin/performance|Open the SEO dashboard>',
      ].join('\n'),
    )
  })

  it('discord renders `content` with markdown, an unfurl-free link, and no mentions', () => {
    const body = buildAlertWebhookBody('discord', digest(), 'https://site.test') as {
      content: string
      allowed_mentions: unknown
      flags: number
    }
    expect(body.allowed_mentions).toEqual({ parse: [] })
    // SUPPRESS_EMBEDS keeps the dashboard link from unfurling into a card.
    expect(body.flags).toBe(4)
    expect(body.content).toContain('**SEO alert digest** — site.test')
    expect(body.content).toContain('**🔗 New 404s** (1)')
    expect(body.content).toContain('• `/gone` — 4×')
    expect(body.content.endsWith('[Open the SEO dashboard](https://site.test/admin/performance)')).toBe(true)
  })

  it("links under the host's admin route and percent-encodes the path", () => {
    const { text } = buildAlertWebhookBody('slack', digest(), 'https://site.test', '/cms/') as { text: string }
    expect(text).toContain('<https://site.test/cms/performance|')
    const { content } = buildAlertWebhookBody('discord', digest(), 'https://site.test/my site)', '/admin') as { content: string }
    expect(content).toContain('(https://site.test/my%20site%29/admin/performance)')
  })

  it('leaves out the link and the host when the site URL is unknown or not http(s)', () => {
    for (const siteUrl of [undefined, '', 'not a url', 'javascript:alert(1)', 'ftp://x.test']) {
      const { text } = buildAlertWebhookBody('slack', digest(), siteUrl) as { text: string }
      expect(text).not.toContain('admin/performance')
      expect(text.startsWith('*SEO alert digest*\n')).toBe(true)
    }
  })

  it('keeps a base path and drops query, hash and credentials from the link', () => {
    const { text } = buildAlertWebhookBody('slack', digest(), 'https://u:p@site.test/sub/?a=1#h') as { text: string }
    expect(text).toContain('<https://site.test/sub/admin/performance|')
    expect(text).not.toContain('u:p')
  })

  it('uses the singular for one issue', () => {
    const d = digest({ scoreRegressions: [], rankDrops: [] })
    expect((buildAlertWebhookBody('slack', d) as { text: string }).text).toContain('1 issue since')
  })
})

describe('untrusted values in the message', () => {
  const hostile = digest({
    newNotFound: [
      { url: '/<!channel> `x` &amp; <https://evil.test|click>\nsecond line', count: 1, lastSeen: '' },
      { url: '/@everyone', count: 1, lastSeen: '' },
    ],
    rankDrops: [{ query: '**bold** [a](https://evil.test)`', from: 1, to: 9, drop: 8 }],
    scoreRegressions: [],
  })

  it('slack: escapes & < >, strips backticks and newlines, keeps values in code spans', () => {
    const { text } = buildAlertWebhookBody('slack', hostile, 'https://site.test') as { text: string }
    expect(text).not.toContain('<!channel>')
    expect(text).not.toContain('<https://evil.test|click>')
    expect(text).toContain('`/&lt;!channel&gt; \'x\' &amp;amp; &lt;https://evil.test|click&gt; second line`')
    expect(text).toContain('`**bold** [a](https://evil.test)\'`')
    // the only angle-bracket link is ours
    expect(text.match(/<[^>]*>/g)).toEqual(['<https://site.test/admin/performance|Open the SEO dashboard>'])
  })

  it('discord: values are code spans and mentions are disabled', () => {
    const body = buildAlertWebhookBody('discord', hostile, 'https://site.test') as { content: string; allowed_mentions: { parse: string[] } }
    expect(body.content).toContain('• `/@everyone` — 1×')
    expect(body.content).not.toMatch(/\n[^•\n].*second line/)
    expect(body.allowed_mentions.parse).toEqual([])
  })

  it('cuts one long value', () => {
    const d = digest({ newNotFound: [{ url: `/${'a'.repeat(400)}`, count: 1, lastSeen: '' }], scoreRegressions: [], rankDrops: [] })
    const { content } = buildAlertWebhookBody('discord', d) as { content: string }
    expect(content).toContain(`\`/${'a'.repeat(98)}…\``)
  })
})

describe('size limits', () => {
  it('lists up to 10 per section with "and N more" when everything fits', () => {
    const d = digest({ ...many(12), scoreRegressions: [], rankDrops: [] })
    const text = renderAlertMessage('slack', d, undefined, 100_000)
    expect(text).toContain('*🔗 New 404s* (12)')
    expect(text.match(/^• `\/missing/gm)).toHaveLength(10)
    expect(text).toContain('• …and 2 more')
  })

  it('discord content never exceeds 2000 characters, and still says how many it left out', () => {
    for (const n of [1, 5, 10, 11, 50, 5000]) {
      const d = digest(many(n))
      const { content } = buildAlertWebhookBody('discord', d, 'https://site.test') as { content: string }
      expect(content.length).toBeLessThanOrEqual(DISCORD_MAX_CONTENT)
      // every section's real count survives the trimming
      expect(content).toContain(`**🔗 New 404s** (${n})`)
      expect(content).toContain(`**📉 Score regressions** (${n})`)
      expect(content).toContain(`**🔻 Ranking drops** (${n})`)
      expect(content).toContain('Open the SEO dashboard')
    }
  })

  it('discord lists fewer items per section when long rows would overflow, and says "and N more"', () => {
    const long = (i: number) => `${'long-path-segment/'.repeat(6)}${i}`
    const d = digest({
      scoreRegressions: Array.from({ length: 40 }, (_, i) => ({ documentId: long(i), collection: 'pages', from: 90, to: 50, drop: 40 })),
      rankDrops: Array.from({ length: 40 }, (_, i) => ({ query: long(i), from: 2, to: 9, drop: 7 })),
      newNotFound: Array.from({ length: 40 }, (_, i) => ({ url: `/${long(i)}`, count: 1, lastSeen: '' })),
    })
    const { content } = buildAlertWebhookBody('discord', d, 'https://site.test') as { content: string }
    expect(content.length).toBeLessThanOrEqual(DISCORD_MAX_CONTENT)
    const listed = content.match(/^• `/gm)!.length
    expect(listed).toBeGreaterThan(0)
    expect(listed).toBeLessThan(30)
    expect(content).toMatch(/…and \d+ more/)
  })

  it('slack text stays under its limit with huge digests', () => {
    const { text } = buildAlertWebhookBody('slack', digest(many(5000)), 'https://site.test') as { text: string }
    expect(text.length).toBeLessThanOrEqual(SLACK_MAX_TEXT)
    expect(text).toMatch(/…and \d+ more/)
  })

  it('cuts as a last resort when even the counts do not fit', () => {
    const text = renderAlertMessage('discord', digest(), 'https://site.test', 60)
    expect(text.length).toBeLessThanOrEqual(60)
  })
})
