/**
 * Immutable path helpers over plain document data. Paths use Payload's dotted
 * form: "sections.3.items.0.title".
 */

export type PathSegment = string | number

/** "3" in "sections.3.title": a row index. */
export const isIndexSegment = (segment: string): boolean => /^\d+$/.test(segment)

/** Segments that would reach an object's prototype instead of its own data. */
const UNSAFE_SEGMENTS: ReadonlySet<PathSegment> = new Set(['__proto__', 'constructor', 'prototype'])

export function parsePath(path: string | PathSegment[]): PathSegment[] {
  const segs = Array.isArray(path)
    ? path
    : path
        .split('.')
        .filter((s) => s !== '')
        .map((s) => (isIndexSegment(s) ? Number(s) : s))
  if (segs.some((s) => UNSAFE_SEGMENTS.has(s)))
    throw new Error(`Unsupported path: ${segs.join('.')}`)
  return segs
}

type Container = Record<string | number, unknown>

/** The value at `path`, or undefined. Narrow the result where it's used (`Array.isArray`, `typeof`…). */
export function getAt(obj: unknown, path: string | PathSegment[]): unknown {
  let cur: unknown = obj
  for (const seg of parsePath(path)) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Container)[seg]
  }
  return cur
}

/** Returns a copy of `obj` with `value` at `path`; untouched branches are shared. */
export function setAt<T>(obj: T, path: string | PathSegment[], value: unknown): T {
  const segs = parsePath(path)
  if (!segs.length) return value as T
  const [head, ...rest] = segs as [PathSegment, ...PathSegment[]]
  const base = (obj ?? (typeof head === 'number' ? [] : {})) as Container
  const copy = (Array.isArray(base) ? base.slice() : { ...base }) as Container
  copy[head] = rest.length ? setAt(base[head], rest, value) : value
  return copy as T
}

/** Apply `fn` to the array at `path` (an absent array is treated as []). */
export function updateArray<T>(
  obj: T,
  path: string | PathSegment[],
  fn: (arr: unknown[]) => unknown[],
): T {
  const current = getAt(obj, path)
  return setAt(obj, path, fn(Array.isArray(current) ? current : []))
}

export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= arr.length) return arr
  const target = Math.max(0, Math.min(arr.length - 1, to))
  const copy = arr.slice()
  copy.splice(target, 0, ...copy.splice(from, 1))
  return copy
}

export function insertItem<T>(arr: T[], index: number, item: T): T[] {
  const copy = arr.slice()
  copy.splice(Math.max(0, Math.min(arr.length, index)), 0, item)
  return copy
}

export function removeItem<T>(arr: T[], index: number): T[] {
  if (index < 0 || index >= arr.length) return arr
  const copy = arr.slice()
  copy.splice(index, 1)
  return copy
}

/** Split "sections.3.items.1" into the array path and the index: ["sections.3.items", 1]. */
export function splitItemPath(path: string): [string, number] | null {
  const segs = parsePath(path)
  const last = segs[segs.length - 1]
  if (typeof last !== 'number') return null
  return [segs.slice(0, -1).join('.'), last]
}

/**
 * The rows that enclose a path, outermost first: "sections.2.items.0.title" →
 * ["sections.2", "sections.2.items.0"]. A path that is itself a row is not included.
 */
export function rowPrefixes(path: string): string[] {
  const segs = path.split('.')
  const out: string[] = []
  for (let i = 1; i < segs.length - 1; i++)
    if (isIndexSegment(segs[i] ?? '')) out.push(segs.slice(0, i + 1).join('.'))
  return out
}

/** A 24-hex id, the shape Payload uses for array and block rows. */
export function newRowId(): string {
  const bytes = new Uint8Array(12)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * A same-origin site path ("/about?x=1#top"), or null. Rejects protocol-relative
 * and absolute URLs, backslashes, control characters and their percent-encoded
 * forms: anything a browser could resolve to another origin.
 */
export function safePath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.length > 2048) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(raw))
    return null
  const origin = 'https://onpage.invalid'
  let url: URL
  try {
    url = new URL(raw, origin)
  } catch {
    return null
  }
  if (url.origin !== origin || raw.startsWith('//')) return null
  return `${url.pathname}${url.search}${url.hash}`
}

/** The path part only ("/about" for "/about?x#y"), for cookie scopes and comparisons. */
export const pathnameOf = (path: string): string => path.split(/[?#]/)[0] || '/'

/** Same page, ignoring a trailing slash. */
export const samePath = (a: string, b: string): boolean =>
  trimSlashes(pathnameOf(a)) === trimSlashes(pathnameOf(b))

/** Drop trailing slashes (keeping "/"). A loop, not a regex: linear on hostile input. */
function trimSlashes(p: string): string {
  let end = p.length
  while (end > 1 && p.charCodeAt(end - 1) === 47 /* '/' */) end--
  return p.slice(0, end)
}

/**
 * A link target safe to store and render: http(s), mailto, tel, or a relative
 * URL ("/x", "#id", "?q", "./x"). Rejects javascript:, data:, vbscript: and any
 * other scheme, and control characters. Returns the trimmed URL or null.
 */
export function safeLinkUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const url = raw.trim()
  // eslint-disable-next-line no-control-regex
  if (!url || url.length > 2048 || /[\u0000-\u001f\u007f]/.test(url)) return null
  if (/^(?:\/(?!\/)|#|\?|\.\.?\/)/.test(url)) return url
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase()
  return scheme && ['http', 'https', 'mailto', 'tel'].includes(scheme) ? url : null
}
