import type { Block, Field } from 'payload'

import type { BlockMeta } from './meta'

import { sectionField, variantField } from './fields'

type DefineBlockArgs = {
  meta: BlockMeta<unknown>
  /** Generated type name, e.g. `PricingBlock`. Also what `Component.tsx` imports. */
  interfaceName: string
  /** A 480×320 SVG wireframe (string), shown in the admin and on-page block pickers. */
  thumbnail: string
  fields: Field[]
}

const svgDataUri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg.trim())}`

const rowLabel = '@/blocks/shared/RowLabel#RowLabel'

/**
 * Gives every array (nested ones and those in inline blocks too) the shared row label, unless
 * it sets its own. Returns copies; field builders may share objects.
 */
const withRowLabels = (fields: Field[]): Field[] =>
  fields.map((field) => {
    switch (field.type) {
      case 'array':
        return {
          ...field,
          admin: {
            ...field.admin,
            components: { RowLabel: rowLabel, ...field.admin?.components },
          },
          fields: withRowLabels(field.fields),
        }
      case 'collapsible':
      case 'group':
      case 'row':
        return { ...field, fields: withRowLabels(field.fields) } as Field
      case 'tabs':
        return {
          ...field,
          tabs: field.tabs.map((tab) => ({ ...tab, fields: withRowLabels(tab.fields) })),
        }
      case 'blocks':
        return {
          ...field,
          blocks: field.blocks.map((block) =>
            typeof block === 'string' ? block : { ...block, fields: withRowLabels(block.fields) },
          ),
        }
      default:
        return field
    }
  })

/**
 * A Payload block with the conventions every block follows: the `variant` radio from
 * `meta.variants` (first), the block's own fields, section settings (last), the picker group and
 * thumbnail, the shared row label on every array, and the on-page editor starting a new block
 * from `meta.example`.
 */
export const defineBlock = ({
  fields,
  interfaceName,
  meta,
  thumbnail,
}: DefineBlockArgs): Block => ({
  slug: meta.slug,
  interfaceName,
  labels: meta.labels,
  admin: {
    group: meta.group,
    images: { thumbnail: { alt: meta.labels.singular, url: svgDataUri(thumbnail) } },
    custom: { onpage: { example: meta.example, insertExample: true } },
  },
  fields: [
    ...(meta.variants ? [variantField(meta.variants)] : []),
    ...withRowLabels(fields),
    ...(meta.section === false ? [] : [sectionField]),
  ],
})
