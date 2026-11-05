import { defineBlock } from '../shared/defineBlock'
import { headingFields } from '../shared/fields'

import { statsMeta } from './meta'
import { statsThumbnail } from './thumbnail'

export const StatsConfig = defineBlock({
  meta: statsMeta,
  interfaceName: 'StatsBlock',
  thumbnail: statsThumbnail,
  fields: [
    ...headingFields(),
    {
      name: 'items',
      type: 'array',
      admin: {
        description: 'Up to 8 numbers. The Row variant shows up to 4 per line.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'value',
          type: 'text',
          admin: { description: 'The big number, as you want it shown: 98%, 2.5M, 24/7.' },
          required: true,
        },
        { name: 'label', type: 'text', required: true },
        {
          name: 'description',
          type: 'textarea',
          admin: { description: 'Optional detail. Shown in the Cards variant.' },
        },
      ],
      maxRows: 8,
    },
  ],
})
