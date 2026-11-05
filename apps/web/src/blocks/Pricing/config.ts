import { link } from '@/fields/link'

import { defineBlock } from '../shared/defineBlock'
import { headingFields } from '../shared/fields'

import { pricingMeta } from './meta'
import { pricingThumbnail } from './thumbnail'

export const PricingConfig = defineBlock({
  meta: pricingMeta,
  interfaceName: 'PricingBlock',
  thumbnail: pricingThumbnail,
  fields: [
    ...headingFields(),
    {
      name: 'plans',
      type: 'array',
      admin: {
        description:
          'Up to four plans. The "Cards" variant shows them side by side; "Single plan" shows only the first one.',
        initCollapsed: true,
      },
      fields: [
        { name: 'name', type: 'text', required: true },
        {
          type: 'row',
          fields: [
            {
              name: 'price',
              type: 'text',
              admin: { description: 'For example "$29", "Free" or "Custom".', width: '50%' },
            },
            {
              name: 'period',
              type: 'text',
              admin: {
                description: 'Shown next to the price, for example "/month".',
                width: '50%',
              },
            },
          ],
        },
        { name: 'description', type: 'textarea' },
        {
          name: 'features',
          type: 'array',
          admin: { initCollapsed: true },
          fields: [{ name: 'feature', type: 'text', required: true }],
          maxRows: 12,
        },
        {
          name: 'highlighted',
          type: 'checkbox',
          admin: { description: 'Gives the plan a primary outline and a badge.' },
          defaultValue: false,
        },
        {
          name: 'badge',
          type: 'text',
          admin: {
            condition: (_, siblingData) => Boolean(siblingData?.highlighted),
            description: 'For example "Most popular".',
          },
        },
        link({ appearances: false }),
      ],
      maxRows: 4,
    },
    {
      name: 'footnote',
      type: 'textarea',
      admin: { description: 'Small text under the plans, for example "Prices exclude VAT".' },
    },
  ],
})
