/**
 * Block metadata that both sides need: the Payload config (server) and the `/dev/blocks`
 * gallery and render tests (client). Keep `meta.ts` files free of Payload and Lexical imports
 * (type-only imports are fine) so the gallery doesn't bundle server code.
 */

/** Groups in the block picker (admin drawer and on-page "Add section"), in this order. */
export const blockGroups = [
  'Heroes',
  'Content',
  'Features',
  'Social proof',
  'Conversion',
  'Media',
  'Layout',
] as const

export type BlockGroup = (typeof blockGroups)[number]

export type BlockVariant = { label: string; value: string }

/** A block's data as an editor fills it in, without the ids Payload adds. */
export type BlockExample<T> = Omit<T, 'blockName' | 'blockType' | 'id' | 'section' | 'variant'>

export type BlockMeta<T = unknown> = {
  /** Payload block slug (camelCase). Also the key in the component registry. */
  slug: string
  labels: { singular: string; plural: string }
  group: BlockGroup
  /**
   * Layout variants, shown as a radio field named `variant` (the first is the default). Each is
   * a designed layout, not a styling knob.
   */
  variants?: readonly [BlockVariant, ...BlockVariant[]]
  /**
   * Sample content. A new block starts from it in the on-page editor, and the gallery and
   * render tests render it. Plain JSON (rich text as Lexical JSON, built with `./lexical`).
   * Leave uploads and relationships out: there's no media to point at on a fresh install.
   */
  example: BlockExample<T>
  /** `false` for blocks that don't get section settings (a wrapper around other sections). */
  section?: boolean
}

export const defineBlockMeta = <T>(meta: BlockMeta<T>): BlockMeta<T> => meta
