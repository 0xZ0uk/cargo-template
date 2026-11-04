/**
 * Field conditions (`admin.condition`) for the editor's settings panels. They
 * are functions in the Payload config, so they run here, on the document the
 * editor has now, and the editor hides the data paths they return.
 */
import type { Block, Field, PayloadRequest } from 'payload'
import { fieldAffectsData, tabHasName } from 'payload/shared'

type Data = Record<string, unknown>
type Condition = (
  data: Data,
  siblingData: Data,
  ctx: {
    blockData: Data | undefined
    operation: 'update'
    path: (string | number)[]
    user: PayloadRequest['user']
  },
) => boolean

interface Walk {
  doc: Data
  user: PayloadRequest['user']
  blocks: Block[] | undefined
  hidden: string[]
}

const isData = (v: unknown): v is Data => !!v && typeof v === 'object' && !Array.isArray(v)

const conditionOf = (f: Field): Condition | undefined => {
  const c: unknown = (f as { admin?: { condition?: unknown } }).admin?.condition
  return typeof c === 'function' ? (c as Condition) : undefined
}

/** Does any field (at any depth) have a condition? Lets the editor skip the round trip. */
export function hasConditions(fields: Field[] | undefined, blocks?: Block[]): boolean {
  return (fields ?? []).some((f) => {
    if (conditionOf(f)) return true
    if (f.type === 'tabs') return f.tabs.some((t) => hasConditions(t.fields, blocks))
    if (f.type === 'blocks')
      return f.blocks.some((b) =>
        typeof b === 'string'
          ? hasConditions(blocks?.find((x) => x.slug === b)?.fields, blocks)
          : hasConditions(b.fields, blocks),
      )
    return 'fields' in f && Array.isArray(f.fields) && hasConditions(f.fields, blocks)
  })
}

/** Every data path under `fields` (for a container whose condition hides it all). */
function allPaths(fields: Field[], base: string[], out: string[]) {
  for (const f of fields) {
    if (f.type === 'tabs') {
      for (const t of f.tabs)
        if (tabHasName(t)) out.push([...base, t.name].join('.'))
        else allPaths(t.fields, base, out)
    } else if (fieldAffectsData(f)) out.push([...base, f.name].join('.'))
    else if ('fields' in f && Array.isArray(f.fields)) allPaths(f.fields, base, out)
  }
}

function walk(
  fields: Field[] | undefined,
  sibling: Data,
  base: (string | number)[],
  blockData: Data | undefined,
  w: Walk,
) {
  for (const f of fields ?? []) {
    if (!f || typeof f !== 'object') continue
    const condition = conditionOf(f)
    const name = fieldAffectsData(f) ? f.name : undefined
    const path = name ? [...base, name] : base
    let shown = true
    if (condition) {
      try {
        shown = condition(w.doc, sibling, {
          blockData,
          operation: 'update',
          path,
          user: w.user,
        })
      } catch {
        shown = true // a condition that throws hides nothing: the admin would show an error, not a gap
      }
    }
    if (!shown) {
      if (name) w.hidden.push(path.join('.'))
      else if ('fields' in f && Array.isArray(f.fields))
        allPaths(f.fields, base.map(String), w.hidden)
      continue
    }
    if (f.type === 'tabs') {
      for (const tab of f.tabs) {
        if (tabHasName(tab)) {
          const value = sibling[tab.name]
          walk(tab.fields, isData(value) ? value : {}, [...base, tab.name], blockData, w)
        } else walk(tab.fields, sibling, base, blockData, w)
      }
      continue
    }
    if (!name) {
      if ('fields' in f && Array.isArray(f.fields)) walk(f.fields, sibling, base, blockData, w)
      continue
    }
    const value = sibling[name]
    if (f.type === 'group') walk(f.fields, isData(value) ? value : {}, path, blockData, w)
    else if (f.type === 'array' && Array.isArray(value))
      value.forEach((row, i) => {
        if (isData(row)) walk(f.fields, row, [...path, i], blockData, w)
      })
    else if (f.type === 'blocks' && Array.isArray(value))
      value.forEach((row, i) => {
        if (!isData(row)) return
        const listed: ReadonlyArray<Block | string> = f.blocks
        const block = listed
          .map((b) => (typeof b === 'string' ? w.blocks?.find((x) => x.slug === b) : b))
          .find((b) => b?.slug === row.blockType)
        if (block) walk(block.fields, row, [...path, i], row, w)
      })
  }
}

/** Data paths (`layout.2.link.url`) whose `admin.condition` is false for `doc`. */
export function hiddenPaths(
  fields: Field[] | undefined,
  doc: Data,
  ctx: { user: PayloadRequest['user']; blocks?: Block[] | undefined },
): string[] {
  const w: Walk = { doc, user: ctx.user, blocks: ctx.blocks, hidden: [] }
  walk(fields, doc, [], undefined, w)
  return w.hidden
}
