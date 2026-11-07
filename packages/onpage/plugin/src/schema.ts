/**
 * Builds the editor's JSON schema from Payload field configs, using Payload's
 * own field predicates and translations. Payload's client config can't be used
 * instead: it strips `defaultValue` and `custom`, which the editor needs.
 */
import { getTranslation } from '@payloadcms/translations'
import {
  stegaCleanDeep,
  type DocumentSchema,
  type SchemaBlock,
  type SchemaField,
  type SchemaImage,
} from '@shipment/onpage-core'
import type { Block, Field, PayloadRequest, SanitizedFieldsPermissions } from 'payload'
import { getDefaultValue } from 'payload'
import {
  fieldAffectsData,
  fieldIsHiddenOrDisabled,
  fieldIsVirtual,
  tabHasName,
  formatLabels,
  toWords,
} from 'payload/shared'

/** Fields Payload manages itself; never editable on the page. */
const SYSTEM_FIELDS = new Set(['id', 'createdAt', 'updatedAt', '_status', 'deletedAt'])
/** Data fields with no meaningful on-page value. */
const SKIP_TYPES = new Set(['join', 'ui'])

/**
 * The properties every data field may have. Payload's `Field` union declares
 * them per member, so they're read through this one view; everything specific
 * to a field type is read from Payload's narrowed type in `serializeFields`.
 */
interface CommonField {
  label?: unknown
  localized?: boolean
  required?: boolean
  defaultValue?: unknown
  custom?: { onpage?: { editor?: unknown } }
  admin?: { description?: unknown; custom?: { onpage?: { editor?: unknown } } }
}

/** `{ key: n }` when n is a number, else nothing (for spreading optional limits). */
const num = <K extends string>(key: K, n: unknown): Partial<Record<K, number>> =>
  typeof n === 'number' ? ({ [key]: n } as Record<K, number>) : {}

type I18nLike = Parameters<typeof getTranslation>[1]
type AnyLabel = Parameters<typeof getTranslation>[0]
type Permissions = SanitizedFieldsPermissions | undefined

export interface SerializeContext {
  /** Translates labels into the admin language. Without it, plain-string labels or the field name are used. */
  i18n?: I18nLike | undefined
  /** Global blocks (`config.blocks`), to resolve block slugs listed in a blocks field. */
  blocks?: Block[] | undefined
  /** Field-level permissions: fields the user can't update are left out. */
  permissions?: Permissions | undefined
  /** Collects function defaults to evaluate for this request. */
  defaults?: { req: PayloadRequest; pending: Promise<void>[] } | undefined
}

/** A config label (string, translations or function) in the request's language, else `fallback`. */
export const label = (
  value: unknown,
  fallback: string,
  ctx: Pick<SerializeContext, 'i18n'>,
): string => {
  if (value == null || value === false) return fallback
  if (typeof value === 'string') return value || fallback
  if (!ctx.i18n) return fallback
  try {
    const out = getTranslation(value as AnyLabel, ctx.i18n)
    return typeof out === 'string' && out ? out : fallback
  } catch {
    return fallback
  }
}

/** Sanitized permissions: `true` = everything; a missing entry = denied. */
function childPermissions(perms: Permissions, name: string): Permissions | false {
  if (perms === undefined || perms === true) return perms
  const entry = perms[name]
  if (!entry) return false
  if (entry === true) return true
  if (entry.update !== true) return false
  return entry.fields ?? true
}

function blockPermissions(perms: Permissions, name: string, slug: string): Permissions {
  if (perms === undefined || perms === true) return perms
  const entry = perms[name]
  if (!entry || entry === true) return true
  const block = (
    entry.blocks as Record<string, { fields?: Permissions } | true | undefined> | undefined
  )?.[slug]
  // No block-level rule: the blocks field's own permission (already checked) applies.
  if (!block || block === true) return true
  return block.fields ?? true
}

const isJsonSafe = (v: unknown): boolean => {
  if (v === undefined || typeof v === 'function') return false
  try {
    JSON.stringify(v)
    return true
  } catch {
    return false
  }
}

/**
 * The block properties the picker reads. Payload v3 and v4 type them a little
 * differently (and `imageURL` is deprecated), so they're read through this view.
 */
interface BlockPresentation {
  imageURL?: unknown
  imageAltText?: unknown
  custom?: { onpage?: { example?: unknown; insertExample?: unknown } }
  admin?: {
    group?: unknown
    images?: { thumbnail?: unknown }
    custom?: { onpage?: { example?: unknown; insertExample?: unknown } }
  }
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/** `admin.images.thumbnail` (a URL or `{ url, alt }`), else the deprecated `imageURL`/`imageAltText`. */
function thumbnailOf(block: BlockPresentation): SchemaImage | undefined {
  const t = block.admin?.images?.thumbnail
  if (nonEmpty(t)) return { url: t }
  if (t && typeof t === 'object') {
    const { url, alt } = t as { url?: unknown; alt?: unknown }
    if (nonEmpty(url)) return { url, ...(nonEmpty(alt) ? { alt } : {}) }
  }
  if (nonEmpty(block.imageURL))
    return {
      url: block.imageURL,
      ...(nonEmpty(block.imageAltText) ? { alt: block.imageAltText } : {}),
    }
  return undefined
}

/** `admin.custom.onpage.example` when it's a plain, JSON-safe object (markers removed). */
function exampleOf(block: BlockPresentation): Record<string, unknown> | undefined {
  const e = block.admin?.custom?.onpage?.example ?? block.custom?.onpage?.example
  if (!e || typeof e !== 'object' || Array.isArray(e) || !isJsonSafe(e)) return undefined
  return stegaCleanDeep(JSON.parse(JSON.stringify(e)) as Record<string, unknown>)
}

function serializeBlock(block: Block, perms: Permissions, ctx: SerializeContext): SchemaBlock {
  const view = block as BlockPresentation
  const thumbnail = thumbnailOf(view)
  const group = label(view.admin?.group, '', ctx)
  const example = exampleOf(view)
  const insertExample =
    view.admin?.custom?.onpage?.insertExample ?? view.custom?.onpage?.insertExample
  return {
    slug: block.slug,
    labels: {
      singular: label(block.labels?.singular, toWords(block.slug), ctx),
      plural: label(block.labels?.plural, toWords(block.slug), ctx),
    },
    fields: serializeFields(block.fields, { ...ctx, permissions: perms }),
    ...(thumbnail ? { thumbnail } : {}),
    ...(group ? { group } : {}),
    ...(example ? { example } : {}),
    ...(example && insertExample === true ? { insertExample: true } : {}),
  }
}

/**
 * Serialize Payload field configs into the editor schema. Presentational
 * containers (row, collapsible, unnamed group/tab) are flattened into their
 * parent; named tabs become groups; hidden, disabled, virtual, system and
 * join/ui fields are left out.
 */
export function serializeFields(
  fields: Field[] | undefined,
  ctx: SerializeContext = {},
): SchemaField[] {
  const out: SchemaField[] = []
  for (const f of fields ?? []) {
    if (!f || typeof f !== 'object' || SKIP_TYPES.has(f.type)) continue
    if (f.type === 'tabs') {
      for (const tab of f.tabs ?? []) {
        if (!tabHasName(tab)) {
          out.push(...serializeFields(tab.fields, ctx))
          continue
        }
        const perms = childPermissions(ctx.permissions, tab.name)
        if (perms === false) continue
        out.push({
          name: tab.name,
          type: 'group',
          label: label(tab.label, toWords(tab.name), ctx),
          fields: serializeFields(tab.fields, { ...ctx, permissions: perms }),
          ...(tab.localized ? { localized: true } : {}),
        })
      }
      continue
    }
    if (!fieldAffectsData(f)) {
      // row, collapsible, unnamed group: their children belong to the parent.
      if ('fields' in f && Array.isArray(f.fields)) out.push(...serializeFields(f.fields, ctx))
      continue
    }
    // Hidden from the admin (admin.hidden) or the API (hidden), disabled, virtual, or
    // read-only in the admin (admin.readOnly): not editable here either.
    if (
      SYSTEM_FIELDS.has(f.name) ||
      fieldIsHiddenOrDisabled(f) ||
      fieldIsVirtual(f) ||
      f.admin?.hidden ||
      f.admin?.readOnly
    )
      continue
    const perms = childPermissions(ctx.permissions, f.name)
    if (perms === false) continue

    const common = f as CommonField
    const base = {
      name: f.name,
      label: label(common.label, toWords(f.name), ctx),
      ...(common.localized ? { localized: true } : {}),
      ...(common.required ? { required: true } : {}),
    }
    const description = label(common.admin?.description, '', ctx)
    const editor = common.admin?.custom?.onpage?.editor ?? common.custom?.onpage?.editor
    const childCtx = { ...ctx, permissions: perms }
    const rows = (
      labels: { singular?: unknown; plural?: unknown } | undefined,
      min: unknown,
      max: unknown,
    ) => {
      const fallback = formatLabels(f.name)
      return {
        labels: {
          singular: label(labels?.singular, fallback.singular, ctx),
          plural: label(labels?.plural, fallback.plural, ctx),
        },
        ...num('minRows', min),
        ...num('maxRows', max),
      }
    }

    let field: SchemaField
    switch (f.type) {
      case 'text':
      case 'textarea':
      case 'email':
      case 'code':
      case 'json':
      case 'checkbox':
      case 'point':
      case 'richText':
        field = { ...base, type: f.type, ...('hasMany' in f && f.hasMany ? { hasMany: true } : {}) }
        break
      case 'number':
        field = {
          ...base,
          type: 'number',
          ...(f.hasMany ? { hasMany: true } : {}),
          ...num('min', f.min),
          ...num('max', f.max),
        }
        break
      case 'date': {
        const picker = f.admin?.date?.pickerAppearance
        field = {
          ...base,
          type: 'date',
          ...(typeof picker === 'string' ? { pickerAppearance: picker } : {}),
        }
        break
      }
      case 'select':
      case 'radio':
        field = {
          ...base,
          type: f.type,
          options: f.options.map((o) =>
            typeof o === 'string'
              ? { label: o, value: o }
              : { label: label(o.label, String(o.value), ctx), value: String(o.value) },
          ),
          ...('hasMany' in f && f.hasMany ? { hasMany: true } : {}),
        }
        break
      case 'relationship':
      case 'upload':
        field = {
          ...base,
          type: f.type,
          relationTo: f.relationTo,
          ...(f.hasMany ? { hasMany: true } : {}),
        }
        break
      case 'group':
        field = { ...base, type: 'group', fields: serializeFields(f.fields, childCtx) }
        break
      case 'array':
        field = {
          ...base,
          type: 'array',
          fields: serializeFields(f.fields, childCtx),
          ...rows(f.labels, f.minRows, f.maxRows),
        }
        break
      case 'blocks': {
        // Payload 4 lists shared blocks by slug in `blocks`; a slug names a block in config.blocks.
        const listed: ReadonlyArray<Block | string> = f.blocks
        const blocks = listed
          .map((b) => (typeof b === 'string' ? ctx.blocks?.find((x) => x.slug === b) : b))
          .filter((b): b is Block => !!b)
        field = {
          ...base,
          type: 'blocks',
          blocks: blocks.map((b) =>
            serializeBlock(b, blockPermissions(ctx.permissions, f.name, b.slug), ctx),
          ),
          ...rows(f.labels, f.minRows, f.maxRows),
        }
        break
      }
      default:
        // join/ui are skipped above; anything newer than this plugin isn't editable on the page.
        continue
    }
    if (description) field.description = description
    if (typeof editor === 'string') field.editor = editor
    if (typeof common.defaultValue === 'function') {
      if (ctx.defaults) {
        const { req, pending } = ctx.defaults
        const target = field
        pending.push(
          getDefaultValue({
            defaultValue: common.defaultValue,
            locale: req.locale ?? undefined,
            req,
            user: req.user,
          })
            .then((v) => {
              if (isJsonSafe(v)) target.defaultValue = v
            })
            .catch(() => undefined),
        )
      }
    } else if (isJsonSafe(common.defaultValue)) {
      field.defaultValue = common.defaultValue
    }
    out.push(field)
  }
  return out
}

/** Every collection a relationship or upload field in `fields` points to. */
export function relationTargets(fields: SchemaField[], into = new Set<string>()): Set<string> {
  for (const f of fields) {
    if (f.type === 'relationship' || f.type === 'upload')
      for (const slug of Array.isArray(f.relationTo) ? f.relationTo : [f.relationTo]) into.add(slug)
    if (f.type === 'group' || f.type === 'array') relationTargets(f.fields, into)
    if (f.type === 'blocks') for (const b of f.blocks) relationTargets(b.fields, into)
  }
  return into
}

export type { DocumentSchema }
