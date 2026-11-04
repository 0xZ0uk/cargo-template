import { describe, expect, it, vi } from 'vitest'
import { createSeoLogsHandler, recordSeoNotFound } from '../endpoints/seoLogs.js'
import { isProbePath, normalizeProbePath, PROBE_PATH_PATTERNS } from '../helpers/probePaths.js'
import { createSqlSeoDataStore } from '../store/index.js'
import { nodeSqliteD1 } from './helpers/nodeSqliteD1.js'

const PROBES = [
  '/wp-login.php',
  '/wp-admin',
  '/wp-admin/admin-ajax.php',
  '/blog/wp-content/plugins/x/readme.txt',
  '/wp-includes/js/jquery.js',
  '/wp-json/wp/v2/users',
  '/wordpress/wp-login.php',
  '/xmlrpc.php',
  '/xmlrpc',
  '/index.php',
  '/shell.php',
  '/a/b/c.PHP',
  '/index.php/admin',
  '/x.php7',
  '/.env',
  '/.env.production',
  '/app/.env',
  '/.git/config',
  '/.git/HEAD',
  '/.svn/entries',
  '/.aws/credentials',
  '/.DS_Store',
  '/.htaccess',
  '/cgi-bin/luci',
  '/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php',
  '/phpmyadmin/',
  '/phpMyAdmin/index.php',
  '/backup.zip',
  '/db.sql',
  '/site.tar.gz',
  '/www.rar',
  '/dump.bak',
  '/a/../../etc/passwd',
  '/%2e%2e/%2e%2e/etc/passwd',
  '/%2eenv',
  '/x.php%00.jpg',
  '/wp-login.php?redirect_to=%2F',
  '/.env#x',
]

const REAL = [
  '/',
  '/about',
  '/blog/my-post',
  '/old-brochure.pdf',
  '/files/backup.zip', // archives only count at the root
  '/legacy/page.aspx', // a lost legacy URL is what the 301 report is for
  '/.well-known/security.txt',
  '/.github/workflows',
  '/phpstorm-tips', // not phpmyadmin
  '/php-tutorials', // `php` without the extension
  '/blog/php-vs-node',
  '/environment',
  '/gitlab-vs-github',
  '/sql-basics',
  '/wp-theme-ideas',
  '/product%zz', // malformed escape: kept, nothing matches
]

describe('PROBE_PATH_PATTERNS / isProbePath', () => {
  it.each(PROBES)('drops the scanner probe %s', (path) => {
    expect(isProbePath(path)).toBe(true)
  })

  it.each(REAL)('keeps the real missing page %s', (path) => {
    expect(isProbePath(path)).toBe(false)
  })

  it('exports the patterns as a frozen-by-contract list of RegExps', () => {
    expect(PROBE_PATH_PATTERNS.length).toBeGreaterThan(5)
    for (const p of PROBE_PATH_PATTERNS) expect(p).toBeInstanceOf(RegExp)
    // A /g or /y flag would make `test` stateful across calls.
    for (const p of PROBE_PATH_PATTERNS) expect(p.global || p.sticky).toBe(false)
  })

  it('normalizes query, hash, case and escapes', () => {
    expect(normalizeProbePath(' /WP-Login.php?x=1#y ')).toBe('/wp-login.php')
    expect(normalizeProbePath('/%2Eenv')).toBe('/.env')
    expect(normalizeProbePath('/%zz')).toBe('/%zz')
  })

  it('is off with `false`', () => {
    expect(isProbePath('/wp-login.php', false)).toBe(false)
  })

  it('uses the built-in list with `true`, `{}` and no option', () => {
    expect(isProbePath('/wp-login.php', true)).toBe(true)
    expect(isProbePath('/wp-login.php', {})).toBe(true)
    expect(isProbePath('/wp-login.php')).toBe(true)
  })

  it('extends the list with prefixes (case-insensitive) and RegExps, keeping the built-ins', () => {
    const option = { extra: ['/Admin-Panel', /\.cfm$/g] }
    expect(isProbePath('/admin-panel/login', option)).toBe(true)
    expect(isProbePath('/x/y.cfm', option)).toBe(true)
    // the /g RegExp's lastIndex is reset between calls
    expect(isProbePath('/x/y.cfm', option)).toBe(true)
    expect(isProbePath('/wp-login.php', option)).toBe(true)
    expect(isProbePath('/about', option)).toBe(false)
    expect(isProbePath('/anything', { extra: [''] })).toBe(false)
  })
})

describe('the 404 log drops probes', () => {
  const setup = (notFoundProbeFilter?: unknown) => {
    const store = createSqlSeoDataStore(nodeSqliteD1())
    const payload = {
      config: { custom: { seoAnalyzer: { store: { resolveStore: () => store, enabled: ['seo-logs'], notFoundProbeFilter } } } },
      logger: { warn: vi.fn(), error: vi.fn() },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    return { store, payload }
  }

  it('recordSeoNotFound skips probes and records real pages, whatever the user agent', async () => {
    const { store, payload } = setup()
    expect(await recordSeoNotFound(payload, { url: '/wp-login.php', userAgent: 'curl/8' })).toBeNull()
    expect(await recordSeoNotFound(payload, { url: '/.env', userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)' })).toBeNull()
    expect(await recordSeoNotFound(payload, { url: '/gone', userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)' })).toBe('created')
    expect(await recordSeoNotFound(payload, { url: '/gone-too', userAgent: 'zgrab/0.x' })).toBe('created')
    const rows = await store.notFound.list({ limit: 10 })
    expect(rows.map((r) => r.url).sort()).toEqual(['/gone', '/gone-too'])
  })

  it('records probes when the filter is off', async () => {
    const { store, payload } = setup(false)
    expect(await recordSeoNotFound(payload, { url: '/wp-login.php' })).toBe('created')
    expect((await store.notFound.list({ limit: 10 })).map((r) => r.url)).toEqual(['/wp-login.php'])
  })

  it('applies the extra patterns from the plugin option', async () => {
    const { payload } = setup({ extra: ['/secret-scan'] })
    expect(await recordSeoNotFound(payload, { url: '/secret-scan/x' })).toBeNull()
    expect(await recordSeoNotFound(payload, { url: '/wp-admin' })).toBeNull()
    expect(await recordSeoNotFound(payload, { url: '/real' })).toBe('created')
  })

  it('POST /seo-logs ignores probes too', async () => {
    const { store, payload } = setup()
    const handler = createSeoLogsHandler(undefined, undefined, () => store)
    const post = (url: string) =>
      handler({
        user: { id: 1, collection: 'users', role: 'admin' },
        method: 'POST',
        url: 'http://localhost/api/seo-plugin/seo-logs',
        headers: new Headers(),
        json: async () => ({ url }),
        payload: { ...payload, config: { ...payload.config, admin: { user: 'users' } } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
    expect(await (await post('/xmlrpc.php')).json()).toEqual({ success: true, action: 'ignored' })
    expect(await (await post('/missing')).json()).toEqual({ success: true, action: 'created' })
    expect((await store.notFound.list({ limit: 10 })).map((r) => r.url)).toEqual(['/missing'])
  })
})
