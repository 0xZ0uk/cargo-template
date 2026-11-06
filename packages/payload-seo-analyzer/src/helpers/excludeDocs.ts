/**
 * The host's document exclusion (`excludeDocs` / `excludeDocsFields` in the plugin config):
 * documents it matches are left out of every whole-site list, scan and output (sitemaps,
 * llms.txt, the dashboard and indexation audits, IndexNow, link graph, cannibalization…).
 * The per-document sidebar still analyzes them when an editor opens one.
 *
 * Scans that read only some fields (`select`) must also read the fields the predicate looks
 * at, or it sees `undefined` and excludes nothing. `withExclusionSelect` adds them; when the
 * host declares no fields, it drops the projection so the predicate sees whole documents.
 */

import type { Payload, SelectType } from 'payload'
import type { SeoConfig, SeoExcludeDocs } from '../types.js'
import { buildSelect } from './buildSelect.js'

export interface DocExclusion {
  test: SeoExcludeDocs
  /** Dotted field paths the predicate reads, or `undefined` when it didn't declare them. */
  fields?: string[]
}

/** The exclusion configured in `seoConfig`, or `undefined` when there is none. */
export function docExclusion(seoConfig?: Pick<SeoConfig, 'excludeDocs' | 'excludeDocsFields'>): DocExclusion | undefined {
  const test = seoConfig?.excludeDocs
  if (typeof test !== 'function') return undefined
  return { test, fields: seoConfig?.excludeDocsFields }
}

/** True when the exclusion matches this document of `collectionSlug`. */
export function isExcludedDoc(
  exclusion: DocExclusion | undefined,
  doc: unknown,
  collectionSlug: string,
): boolean {
  if (!exclusion || !doc || typeof doc !== 'object') return false
  return exclusion.test(doc as Record<string, unknown>, collectionSlug) === true
}

function mergeSelect(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object') {
      const existing = target[key]
      if (existing === true) continue // the whole field is already read
      const next = existing && typeof existing === 'object' ? (existing as Record<string, unknown>) : {}
      target[key] = next
      mergeSelect(next, value as Record<string, unknown>)
    } else {
      target[key] = value
    }
  }
}

/**
 * The `select` a scan should pass so the exclusion can be evaluated: `select` itself when
 * there is no exclusion or no projection, `select` plus the exclusion's fields (those the
 * collections have) when it declared them, and no projection at all when it didn't.
 * `select` is an include-mode projection (as `buildSelect` builds). Returns a new object.
 */
export function withExclusionSelect(
  payload: Payload,
  collectionSlugs: string[],
  select: SelectType | undefined,
  exclusion: DocExclusion | undefined,
): SelectType | undefined {
  if (!select || !exclusion) return select
  if (!exclusion.fields) return undefined
  const merged = structuredClone(select) as Record<string, unknown>
  mergeSelect(merged, buildSelect(payload, collectionSlugs, exclusion.fields) as Record<string, unknown>)
  return merged as SelectType
}
