import { linkGroup } from '@/fields/linkGroup'

import { defineBlock } from '../shared/defineBlock'
import { blockRichText, headingFields, mediaField } from '../shared/fields'

import { featureRowsMeta } from './meta'
import { featureRowsThumbnail } from './thumbnail'

export const FeatureRowsConfig = defineBlock({
  meta: featureRowsMeta,
  interfaceName: 'FeatureRowsBlock',
  thumbnail: featureRowsThumbnail,
  fields: [
    ...headingFields(),
    {
      name: 'rows',
      type: 'array',
      admin: {
        description: 'Each row pairs an image or video with text.',
        initCollapsed: true,
      },
      fields: [
        {
          name: 'eyebrow',
          type: 'text',
          admin: { description: 'Short label above the title.' },
        },
        { name: 'title', type: 'text', required: true },
        {
          name: 'richText',
          type: 'richText',
          editor: blockRichText({ headings: ['h4'] }),
          label: false,
        },
        linkGroup({ appearances: ['default', 'outline'], overrides: { maxRows: 2 } }),
        mediaField(),
      ],
      maxRows: 8,
    },
  ],
})
