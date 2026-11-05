import { defineBlock } from '../shared/defineBlock'
import { headingFields, iconField } from '../shared/fields'

import { stepsMeta } from './meta'
import { stepsThumbnail } from './thumbnail'

export const StepsConfig = defineBlock({
  meta: stepsMeta,
  interfaceName: 'StepsBlock',
  thumbnail: stepsThumbnail,
  fields: [
    ...headingFields(),
    {
      name: 'items',
      type: 'array',
      admin: {
        description: 'The steps, in order. Numbers (01, 02…) are added automatically.',
        initCollapsed: true,
      },
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'description', type: 'textarea' },
        iconField({ admin: { description: 'Optional. Shown next to the step number.' } }),
      ],
      maxRows: 8,
    },
  ],
})
