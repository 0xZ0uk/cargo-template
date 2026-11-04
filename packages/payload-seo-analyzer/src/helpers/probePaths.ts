/**
 * Vulnerability-scanner probes, kept out of the 404 log.
 *
 * Bots sweep every public site for `/wp-login.php`, `/.env`, `/.git/config`, `/phpmyadmin` and
 * the like. Those 404s are noise an editor can't act on, and they fill the log's row cap
 * (`SEO_LOGS_MAX_ROWS`, 5k by default) so that real broken links stop being recorded.
 *
 * The filter looks at the PATH only. It never looks at the user agent: search-engine
 * crawlers' 404s are the most valuable rows in the log, and a scanner can claim any user agent
 * anyway.
 *
 * Keep the list conservative: a pattern belongs here only when no real site would link to such
 * a path. A path a migrated site might really have lost (a legacy `.aspx` page, `/old-brochure.pdf`)
 * stays in the log, since that is what the 301 report exists for.
 */

/** A custom pattern: a RegExp tested against the path, or a case-insensitive path prefix. */
export type ProbePathMatcher = string | RegExp

/** The `notFoundProbeFilter` plugin option. */
export type NotFoundProbeFilterOption =
  | boolean
  | {
      /** Patterns added to the built-in list. */
      extra?: ProbePathMatcher[]
    }

/** Archive/backup extensions that scanners request at the site root (`/backup.zip`, `/db.sql`). */
const ROOT_ARCHIVE_EXTENSIONS = 'sql|bak|backup|old|orig|dump|zip|tar|gz|tgz|rar|7z'

/**
 * The built-in probe patterns. Tested against the decoded, lower-cased path without its query
 * string or hash (see `normalizeProbePath`). One entry per family so a failing test names it.
 */
export const PROBE_PATH_PATTERNS: readonly RegExp[] = [
  // PHP entry points: `/wp-login.php`, `/index.php`, `/x/shell.php`, `/a.php/b` (path info).
  /\.php\d?(?:\/|$)/,
  // WordPress, wherever it's mounted (`/wp-admin`, `/blog/wp-includes/x.js`, `/wp-json/`).
  /(?:^|\/)wp-(?:admin|login|content|includes|json|config|cron)(?:[/.]|$)/,
  /^\/xmlrpc/,
  // Dotfiles and VCS/credential folders. `.well-known` is deliberately not in the list.
  /(?:^|\/)\.(?:env|git|svn|hg|aws|ssh|npmrc|htaccess|htpasswd|ds_store)(?:[/.]|$)/,
  /(?:^|\/)cgi-bin(?:\/|$)/,
  /(?:^|\/)vendor\/phpunit/,
  /(?:^|\/)phpmyadmin/,
  // Backups and archives straight under the root: `/backup.zip`, `/db.sql`, `/www.tar.gz`.
  new RegExp(`^\\/[^/]+\\.(?:${ROOT_ARCHIVE_EXTENSIONS})$`),
  // Path traversal, which a browser never sends (it resolves `..` first).
  /(?:^|\/)\.\.(?:\/|$)/,
]

/** Decoded, lower-cased path without query string or hash; `''` for anything unusable. */
export function normalizeProbePath(pathname: string): string {
  const raw = pathname.trim().split('#')[0]!.split('?')[0]!
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    // A malformed escape (`%zz`, a lone `%`) is itself a sign of a probe, but test it as sent.
  }
  // Past a NUL byte (`/x.php%00.jpg`) a C-style server sees nothing: that's what the scanner wants.
  return decoded.split('\0')[0]!.toLowerCase()
}

/** Whether the path matches an `extra` entry: a RegExp as is, a string as a case-insensitive path prefix. */
function matchesExtra(path: string, matcher: ProbePathMatcher): boolean {
  if (typeof matcher === 'string') {
    const prefix = matcher.toLowerCase()
    return prefix.length > 0 && path.startsWith(prefix)
  }
  // A /g or /y RegExp keeps `lastIndex` between calls, which makes `test` flip-flop.
  matcher.lastIndex = 0
  return matcher.test(path)
}

/**
 * Whether a missing path is a scanner probe that should not be logged.
 * `option`: `false` turns the filter off, `{ extra }` adds patterns, anything else uses the
 * built-in list alone.
 */
export function isProbePath(pathname: string, option?: NotFoundProbeFilterOption): boolean {
  if (option === false) return false
  const path = normalizeProbePath(pathname)
  if (!path) return false
  if (PROBE_PATH_PATTERNS.some((pattern) => pattern.test(path))) return true
  const extra = typeof option === 'object' && option !== null ? option.extra : undefined
  return !!extra?.some((matcher) => matchesExtra(path, matcher))
}
