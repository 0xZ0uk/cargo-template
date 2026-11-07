/**
 * Cache keys for the SEO endpoints: one function, `keyFor`, one policy table.
 *
 * Every endpoint that caches a result names its base and what the result depends on; this
 * module decides what goes into the key, so two requests that must get different results
 * never share one, and the endpoints stop agreeing on a convention by hand.
 *
 *     <base>[:l-<locale>][:i-<sha256 of the inputs>][:c-<sha256 of the persisted config>]
 *
 * - **Version.** `CACHE_KEY_POLICY[base].v`. It is part of the config digest, so bumping it
 *   rebuilds the persisted entries of that base once. In-memory entries live as long as the
 *   process and never need it.
 * - **Locale.** Per base, `scoped` or `none` (table below). A scoped locale comes from
 *   `safeCacheLocale` (below): only a code the host declares can scope a key, so a caller
 *   can't mint keys with `?locale=a1`, `a2`…
 * - **Inputs.** What the result depends on besides the config: collections, a request-derived
 *   URL, a threshold. Always hashed, so the key stays within the store's `[a-z0-9:/._-]`
 *   whatever it holds (uppercase host, query string…). Object key order doesn't matter,
 *   array order does.
 * - **Config.** Persisted entries outlive deploys, so with a `cacheStore` the key also carries
 *   a digest of the version, the config the endpoint passes (the same hashing as the inputs:
 *   functions such as `excludeDocs` count by source) and, for bases that read documents'
 *   content, the fingerprint of the `extractContent` extractors. The extractors are read from
 *   `req.payload.config.custom.seoAnalyzer`, the one place they live, so they never travel
 *   through `SeoConfig`. A base that isn't persisted gets no config segment.
 * - **Characters.** Every segment is `[a-z0-9._-]` and the separator is `:`; a locale is
 *   escaped injectively (below). Segments carry a tag (`l-`, `i-`, `c-`), so a locale can
 *   never be read as an input or config digest.
 *
 * ## Policy per base
 *
 * | base                                                   | locale | inputs                          | config passed                                | extractors | persisted |
 * | ------------------------------------------------------ | ------ | ------------------------------- | -------------------------------------------- | ---------- | --------- |
 * | `audit`                                                | none   | –                               | collections, globals, seoConfig              | yes        | yes       |
 * | `indexation-audit`                                     | scoped | –                               | collections, globals, seoConfig              | yes        | yes       |
 * | `sitemap-audit`                                        | scoped | –                               | collections, redirects slug, routes, exclusion | yes      | yes       |
 * | `redirect-chains`                                      | none   | –                               | redirects slug                               | no         | yes       |
 * | `external-links`                                       | scoped | –                               | collections, globals, seoConfig              | yes        | yes       |
 * | `core-web-vitals`                                      | none   | strategy, target URL            | –                                            | no         | yes       |
 * | `sitemap-xml`, `sitemap-news/images/video`, `llms-txt` | none   | collections, site URL           | seoConfig                                    | yes        | yes       |
 * | `cannibalization`, `keyword-research`, `link-graph`    | scoped | –                               | –                                            | –          | no        |
 * | `duplicate-content`                                    | scoped | similarity threshold            | –                                            | –          | no        |
 * | `suggest-links-index`                                  | scoped | –                               | –                                            | –          | no        |
 *
 * The audit has no locale because it never passes one to `payload.find` (c299e11): every
 * locale would build the same result. The same is true of the other scoped bases today (none
 * of them reads a locale either), so their locale segment only splits identical entries; it is
 * kept, as it was before this module, and turning a base into `none` is a one-word change.
 * The persisted `redirect-chains` and `core-web-vitals` entries don't read documents' content,
 * so their keys carry no extractor fingerprint.
 */

import { PERSISTENT_CACHE_BASES } from './cache.js'
import { contentExtractorsOf, fingerprintContentExtractors } from './helpers/contentExtractor.js'
import { sha256Hex } from './helpers/sha256.js'

interface BasePolicy {
  /** Bump to rebuild the persisted entries of the base once. */
  v: number
  /** `scoped`: the (safe) request locale is part of the key. `none`: one entry for every locale. */
  locale: 'scoped' | 'none'
  /** The result depends on how documents' content is extracted (`extractContent`). */
  extractors: boolean
}

export const CACHE_KEY_POLICY = {
  // v3 was the last key before this module; each persisted key changed shape with it.
  audit: { v: 4, locale: 'none', extractors: true },
  'indexation-audit': { v: 2, locale: 'scoped', extractors: true },
  'sitemap-audit': { v: 2, locale: 'scoped', extractors: true },
  'redirect-chains': { v: 2, locale: 'none', extractors: false },
  'external-links': { v: 2, locale: 'scoped', extractors: true },
  'core-web-vitals': { v: 2, locale: 'none', extractors: false },
  'sitemap-xml': { v: 2, locale: 'none', extractors: true },
  'sitemap-news': { v: 2, locale: 'none', extractors: true },
  'sitemap-images': { v: 2, locale: 'none', extractors: true },
  'sitemap-video': { v: 2, locale: 'none', extractors: true },
  'llms-txt': { v: 2, locale: 'none', extractors: true },
  cannibalization: { v: 1, locale: 'scoped', extractors: false },
  'keyword-research': { v: 1, locale: 'scoped', extractors: false },
  'link-graph': { v: 1, locale: 'scoped', extractors: false },
  'duplicate-content': { v: 1, locale: 'scoped', extractors: false },
  'suggest-links-index': { v: 1, locale: 'scoped', extractors: false },
} as const satisfies Record<string, BasePolicy>

export type CacheKeyBase = keyof typeof CACHE_KEY_POLICY

/** The slice of a request `keyFor` reads: the locale and, for the extractors, the Payload config. */
export interface CacheKeyReq {
  locale?: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any
}

export interface CacheKeyOptions {
  /** The cache the entry goes to: a persistent one adds the config segment. Omit for the in-memory `seoCache`. */
  cache?: { persistent: boolean }
  /** What the result depends on besides the config. Hashed; `undefined` adds no segment. */
  inputs?: unknown
  /** The config the result is a function of. Only hashed for persisted keys. */
  config?: unknown
}

/**
 * The cache key of `base` for this request. Same arguments, same key; anything that should
 * change the result (another locale of a scoped base, other inputs, another version, config or
 * extractors of a persisted one) changes it.
 */
export async function keyFor(base: CacheKeyBase, req: CacheKeyReq, options: CacheKeyOptions = {}): Promise<string> {
  const policy: BasePolicy = CACHE_KEY_POLICY[base]
  const parts: string[] = [base]

  if (policy.locale === 'scoped') {
    const locale = safeCacheLocale(req)
    if (locale !== undefined) parts.push(`l-${escapeLocale(locale)}`)
  }

  if (options.inputs !== undefined) parts.push(`i-${await sha256Hex(canonicalJson(options.inputs))}`)

  if (options.cache?.persistent && (PERSISTENT_CACHE_BASES as readonly string[]).includes(base)) {
    const digest = await sha256Hex(
      canonicalJson({
        v: policy.v,
        config: options.config ?? null,
        extractors: policy.extractors ? (extractorFingerprint(req.payload) ?? null) : null,
      }),
    )
    parts.push(`c-${digest}`)
  }

  return parts.join(':')
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * JSON with object keys sorted, so `{ a, b }` and `{ b, a }` hash alike (a config spread in
 * another order must not rebuild every persisted entry). Functions (`excludeDocs`) shape the
 * output too: they count by their source rather than being dropped by JSON, so adding or
 * changing one never reuses an entry built without it.
 */
function canonicalJson(value: unknown): string {
  return (
    JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v === 'function') return `fn:${String(v)}`
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype) {
        return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      }
      return v
    }) ?? 'undefined'
  )
}

const fingerprints = new WeakMap<object, string | undefined>()

/**
 * Fingerprint of the app's `extractContent` extractors, read from the Payload config the plugin
 * stored them on. Memoised per extractor map: the endpoints ask on every request.
 */
function extractorFingerprint(payload: CacheKeyReq['payload']): string | undefined {
  // `contentExtractorsOf` takes an object without a `config` for the extractor map itself.
  const extractors = payload?.config ? contentExtractorsOf(payload) : undefined
  if (!extractors) return undefined
  if (!fingerprints.has(extractors)) fingerprints.set(extractors, fingerprintContentExtractors(extractors))
  return fingerprints.get(extractors)
}

// ---------------------------------------------------------------------------
// Locale
// ---------------------------------------------------------------------------

/**
 * Locale used to scope the server-side caches — single source of truth.
 *
 * `req.locale` comes straight from the `?locale=` query string and is NOT
 * always sanitized by Payload:
 *   - with no `localization` block (the common single-language site), Payload
 *     copies the raw string onto the request without looking at it;
 *   - with `localization` but `fallback: false`, `sanitizeLocales()` only
 *     rewrites the value when a fallback exists, so an unknown code also
 *     survives untouched.
 *
 * Every aggregation endpoint used to build its cache key from that raw string.
 * A caller looping over `?locale=a1`, `?locale=a2`… therefore produced a fresh
 * key on each request: permanent cache miss, no single-flight (it is keyed by
 * the same string), and one full site-wide recomputation per request — the very
 * load the admin/throttle gates were added to prevent, plus an unbounded key
 * space in the LRU cache and in the `lastAuditBuildAt` map.
 *
 * The fix is to derive the cache scope from what the HOST declares, not from
 * what the caller sends: only a code listed in `config.localization.localeCodes`
 * (or Payload's cross-locale `all`) may scope a key. The resulting key space is
 * bounded by the site configuration.
 *
 * @returns the locale to scope a key with, or `undefined` for the unscoped
 * (default-locale) key.
 */
function safeCacheLocale(req: CacheKeyReq): string | undefined {
  const raw = typeof req?.locale === 'string' ? req.locale.trim() : ''
  if (!raw) return undefined

  const config = req?.payload?.config
  // No config at hand (mock request in tests, non-sanitized config): we cannot
  // tell a legit locale from a forged one, so keep the historical behaviour
  // rather than silently collapsing distinct locales onto one key. A real
  // Payload request always carries the sanitized config, so this branch is not
  // reachable by an attacker.
  if (!config) return raw

  const localization = config.localization
  // Localization disabled → there is exactly one corpus, so exactly one key.
  if (!localization) return undefined

  // Payload's cross-locale mode ('*' is normalized to 'all'): a distinct,
  // legitimate corpus shape, and a single extra bounded key.
  if (raw === 'all' || raw === '*') return 'all'

  const codes: unknown = localization.localeCodes
  if (!Array.isArray(codes) || codes.length === 0) return undefined
  return codes.includes(raw) ? raw : undefined
}

/**
 * A locale code as `[a-z0-9._-]`, injectively (two codes never escape to the same string):
 * `_` is the escape character, written `__`; an uppercase letter is `_` + its lowercase
 * (`pt-BR` → `pt-_b_r`); any other character is `_.` + its four hex digits (`_.003a` for `:`).
 */
function escapeLocale(locale: string): string {
  let out = ''
  for (const char of locale) {
    if (/[a-z0-9.-]/.test(char)) out += char
    else if (char === '_') out += '__'
    else if (/[A-Z]/.test(char)) out += `_${char.toLowerCase()}`
    else out += char.split('').map((c) => `_.${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')
  }
  return out
}
