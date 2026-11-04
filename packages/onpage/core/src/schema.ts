/**
 * A JSON-safe description of a document's editable fields, produced on the
 * server by the plugin's schema endpoint (`@cargo/onpage-plugin`) and consumed
 * by the editor to build settings forms, new rows and save payloads.
 *
 * `SchemaField` is a union discriminated on `type`: each kind carries only its
 * own properties, so `field.options` exists only after checking for a select,
 * and a `switch (field.type)` can be checked for exhaustiveness.
 */
import type { DocRef } from './docref.ts'

export interface SchemaOption {
  label: string
  value: string
}

/** Singular and plural names ("Feature" / "Features"). */
export interface SchemaLabels {
  singular: string
  plural: string
}

/** What every field has. */
interface FieldBase {
  name: string
  label: string
  localized?: boolean
  required?: boolean
  defaultValue?: unknown
  description?: string
  /** Field-editor override: `admin.custom.onpage.editor` (e.g. "color"). */
  editor?: string
}

/** Fields whose value is a scalar or opaque JSON, edited as a whole. */
export type ScalarFieldType =
  'text' | 'textarea' | 'email' | 'code' | 'json' | 'checkbox' | 'point' | 'richText'

export interface ScalarField extends FieldBase {
  type: ScalarFieldType
  /** A list of values (text/textarea/email with `hasMany`): not edited inline. */
  hasMany?: boolean
}

export interface NumberField extends FieldBase {
  type: 'number'
  hasMany?: boolean
  min?: number
  max?: number
}

export interface DateField extends FieldBase {
  type: 'date'
  /** Payload's `admin.date.pickerAppearance` ("dayOnly", "dayAndTime"…). */
  pickerAppearance?: string
}

export interface ChoiceField extends FieldBase {
  type: 'select' | 'radio'
  options: SchemaOption[]
  hasMany?: boolean
}

export interface RelationField extends FieldBase {
  type: 'relationship' | 'upload'
  relationTo: string | string[]
  hasMany?: boolean
}

export interface GroupField extends FieldBase {
  type: 'group'
  fields: SchemaField[]
}

interface RowsField extends FieldBase {
  labels?: SchemaLabels
  minRows?: number
  maxRows?: number
}

export interface ArrayField extends RowsField {
  type: 'array'
  fields: SchemaField[]
}

export interface BlocksField extends RowsField {
  type: 'blocks'
  blocks: SchemaBlock[]
}

export type SchemaField =
  | ScalarField
  | NumberField
  | DateField
  | ChoiceField
  | RelationField
  | GroupField
  | ArrayField
  | BlocksField

export type SchemaFieldType = SchemaField['type']

/**
 * The field kinds that can have one of the given types: `FieldOf<'select'>` is
 * `ChoiceField`, `FieldOf<'text' | 'email'>` is `ScalarField`. (A plain
 * `Extract` would give `never`, since a kind's `type` is itself a union.)
 */
export type FieldOf<T extends SchemaFieldType> = SchemaField extends infer F
  ? F extends { type: infer U }
    ? [Extract<U, T>] extends [never]
      ? never
      : F
    : never
  : never

/** An array or blocks field: one that holds a list of rows. */
export type ListField = ArrayField | BlocksField

export const isListField = (field: SchemaField): field is ListField =>
  field.type === 'array' || field.type === 'blocks'

/** An image shown for a block in the block picker. */
export interface SchemaImage {
  url: string
  alt?: string
}

export interface SchemaBlock {
  slug: string
  labels: SchemaLabels
  fields: SchemaField[]
  /** Picker image: Payload's `admin.images.thumbnail` (or the older `imageURL`). */
  thumbnail?: SchemaImage
  /** Picker group: Payload's `admin.group`, translated. */
  group?: string
  /**
   * Sample content for the live preview in the block picker
   * (`admin.custom.onpage.example`). Never saved: an inserted block gets its defaults.
   */
  example?: Record<string, unknown>
  /** Start an inserted block from `example` instead of its defaults (`admin.custom.onpage.insertExample`). */
  insertExample?: boolean
}

/** The editable shape of one collection or global, as served by the plugin. */
export interface DocumentSchema {
  kind: DocRef['kind']
  slug: string
  labels: SchemaLabels
  /** Top-level field names the editor may change. */
  editable: string[]
  fields: SchemaField[]
  drafts: boolean
  /** Field used as the document's title (collections). */
  useAsTitle?: string
  defaultLocale?: string
  locales?: string[]
  /** Autosave debounce from the collection's versions config, in ms. */
  autosaveInterval?: number
  /** Publishing can be scheduled (`versions.drafts.schedulePublish`). */
  schedulePublish?: boolean
  /** Some fields have `admin.condition`: ask `DataSource.hiddenFields` which are hidden. */
  conditions?: boolean
  /** Comments and review requests are on (the plugin's `comments` option). */
  comments?: boolean
  /** May this user publish this document? (Sent when the schema is asked for a document.) */
  canPublish?: boolean
  /** Saved sections are on (the plugin's `patterns` option). */
  patterns?: boolean
  /** Collections rich-text links can point to (the site's pages); they're in `relations` too. */
  linkTargets?: string[]
  /** Collections that relationship fields point to: how to search and show them. */
  relations?: Record<string, { titleField: string; label: string }>
}
