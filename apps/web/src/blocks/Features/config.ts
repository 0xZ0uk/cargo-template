import { defineBlock } from '../shared/defineBlock'
import { headingFields, iconField } from '../shared/fields'

import { featuresMeta } from './meta'
import { featuresThumbnail } from './thumbnail'

export const FeaturesConfig = defineBlock({
  meta: featuresMeta,
  interfaceName: 'FeaturesBlock',
  thumbnail: featuresThumbnail,
  fields: [
    ...headingFields(),
    {
      name: 'items',
      type: 'array',
      admin: { initCollapsed: true },
      fields: [
        iconField({ admin: { description: 'Shown next to the title.' } }),
        { name: 'title', type: 'text', required: true },
        { name: 'description', type: 'textarea' },
      ],
      maxRows: 12,
    },
  ],
})
