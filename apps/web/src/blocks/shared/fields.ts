/**
 * Field builders shared by blocks. Server only (Payload config): components read the data
 * through the generated types, never these builders.
 */
import type { Field, RadioField, SelectField, UploadField } from 'payload'

import {
  FixedToolbarFeature,
  HeadingFeature,
  InlineToolbarFeature,
  lexicalEditor,
} from '@payloadcms/richtext-lexical'

import { iconLabel, iconNames } from './icons'
import type { BlockVariant } from './meta'

/**
 * Section settings every block gets (added by `defineBlock`): background, vertical spacing
 * and an anchor id for in-page links. Rendered by `@/components/Section`, never by the block.
 */
export const sectionField: Field = {
  type: 'collapsible',
  label: 'Section settings',
  admin: { initCollapsed: true },
  fields: [
    {
      name: 'section',
      type: 'group',
      label: false,
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'background',
              type: 'select',
              defaultValue: 'default',
              options: [
                { label: 'Default', value: 'default' },
                { label: 'Muted', value: 'muted' },
                { label: 'Dark', value: 'dark' },
              ],
              required: true,
            },
            {
              name: 'spacing',
              type: 'select',
              defaultValue: 'md',
              options: [
                { label: 'None', value: 'none' },
                { label: 'Small', value: 'sm' },
                { label: 'Medium', value: 'md' },
                { label: 'Large', value: 'lg' },
              ],
              required: true,
            },
            {
              name: 'anchor',
              type: 'text',
              admin: {
                description:
                  'Lets links jump here with #anchor. Lowercase letters, digits, dashes.',
              },
              validate: (value: null | string | undefined) =>
                !value || /^[a-z0-9-]+$/.test(value)
                  ? true
                  : 'Use lowercase letters, digits and dashes only.',
            },
          ],
        },
      ],
    },
  ],
}

/** The `variant` radio for a block's layout variants (the first is the default). */
export const variantField = (variants: readonly BlockVariant[]): RadioField => ({
  name: 'variant',
  type: 'radio',
  admin: { layout: 'horizontal' },
  defaultValue: variants[0]!.value,
  options: variants.map(({ label, value }) => ({ label, value })),
  required: true,
})

/**
 * Eyebrow, title and description, rendered by `@/components/SectionHeading`. Most sections
 * open with these. Plain text, so the on-page editor can edit them in place.
 */
export const headingFields = ({ titleRequired = false } = {}): Field[] => [
  {
    name: 'eyebrow',
    type: 'text',
    admin: { description: 'Short label above the title.' },
  },
  { name: 'title', type: 'text', required: titleRequired },
  { name: 'description', type: 'textarea' },
]

/** An icon from the curated list in `./icons`, rendered with `@/components/Icon`. */
export const iconField = (
  overrides: Partial<Omit<SelectField, 'hasMany' | 'options' | 'type'>> = {},
): SelectField =>
  ({
    name: 'icon',
    type: 'select',
    options: iconNames.map((name) => ({ label: iconLabel(name), value: name })),
    ...overrides,
  }) as SelectField

/**
 * An image or video from Media. Never required: blocks render a placeholder without one, so a
 * new block from the on-page editor looks right before an image is chosen.
 */
export const mediaField = (overrides: Partial<Omit<UploadField, 'relationTo' | 'type'>> = {}) =>
  ({
    name: 'media',
    type: 'upload',
    relationTo: 'media',
    ...overrides,
  }) as UploadField

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4'

/**
 * Rich text for blocks: the root editor's features (paragraphs, bold/italic/underline, links,
 * bulleted and numbered lists, see `fields/defaultLexical.ts`) plus h2–h4 headings by default and
 * the toolbars. A page has one h1, usually the hero's title; only blocks that can open a page
 * (Rich text) allow h1.
 */
export const blockRichText = ({
  headings = ['h2', 'h3', 'h4'],
}: { headings?: HeadingTag[] } = {}) =>
  lexicalEditor({
    features: ({ rootFeatures }) => [
      ...rootFeatures,
      HeadingFeature({ enabledHeadingSizes: [...headings] }),
      FixedToolbarFeature(),
      InlineToolbarFeature(),
    ],
  })
