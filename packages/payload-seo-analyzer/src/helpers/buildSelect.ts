/**
 * Build a Payload `select` (include mode) from the dotted field paths a caller
 * reads, keeping only paths that at least one of the target collections has.
 *
 *   buildSelect(payload, ['posts', 'pages'], ['slug', 'meta.noindex'])
 *   // → { slug: true, meta: { noindex: true } }
 *
 * Why filter at all: Payload 4 ignores unknown `select` keys, but a projection that
 * names a missing field is rejected by other adapters/versions, and `fetchAllDocs`
 * answers a rejection by retrying without any projection (whole documents again).
 * Naming only real fields keeps the projection from being silently dropped.
 *
 * Returns a NEW object on every call: Payload's `sanitizeSelect` mutates the select
 * it receives (it adds the paths virtual fields depend on), so a shared constant
 * would leak one collection's additions into the next call.
 *
 * When a collection's config is not reachable (`payload.collections[slug]` absent),
 * every requested path is kept, since Payload ignores unknown keys anyway.
 */

import type { Payload, SelectType } from 'payload'

interface FieldLike {
  name?: string
  flattenedFields?: FieldLike[]
}

/** True when `path` ("a" or "a.b") resolves to a field in `fields` (flattened). */
function hasPath(fields: FieldLike[] | undefined, path: string[]): boolean {
  if (!fields || path.length === 0) return false
  const [head, ...rest] = path
  const field = fields.find((f) => f.name === head)
  if (!field) return false
  return rest.length === 0 ? true : hasPath(field.flattenedFields, rest)
}

export function buildSelect(
  payload: Payload,
  collectionSlugs: string[],
  paths: string[],
): SelectType {
  const configs = collectionSlugs.map(
    (slug) =>
      (
        payload.collections as
          | Record<string, { config?: { flattenedFields?: FieldLike[] } } | undefined>
          | undefined
      )?.[slug]?.config?.flattenedFields,
  )

  const select: Record<string, unknown> = {}
  for (const path of paths) {
    const segments = path.split('.')
    // Keep the path when any target collection has it, or when no config is readable.
    const known = configs.some((fields) => (fields ? hasPath(fields, segments) : true))
    if (!known) continue

    let node = select
    segments.forEach((segment, i) => {
      if (i === segments.length - 1) {
        node[segment] = true
      } else {
        const next = node[segment]
        node =
          typeof next === 'object' && next !== null
            ? (next as Record<string, unknown>)
            : (node[segment] = {}) as Record<string, unknown>
      }
    })
  }
  return select as SelectType
}
