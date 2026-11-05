import { defineBlock } from '../shared/defineBlock'
import { mediaField } from '../shared/fields'

import { logosMeta } from './meta'
import { logosThumbnail } from './thumbnail'

export const LogosConfig = defineBlock({
  meta: logosMeta,
  interfaceName: 'LogosBlock',
  thumbnail: logosThumbnail,
  fields: [
    {
      name: 'title',
      type: 'text',
      admin: { description: 'Small label above the logos, e.g. "Trusted by teams at".' },
    },
    {
      name: 'items',
      type: 'array',
      admin: { initCollapsed: true },
      labels: { singular: 'Logo', plural: 'Logos' },
      maxRows: 24,
      fields: [
        {
          name: 'name',
          type: 'text',
          admin: {
            description:
              'Company name. Shown as text when there is no logo, and used as its alt text.',
          },
          required: true,
        },
        mediaField({
          name: 'logo',
          admin: {
            description: 'A transparent PNG or SVG works best. Shown at a fixed height.',
          },
        }),
        {
          name: 'url',
          type: 'text',
          admin: { description: 'Optional. Makes the logo a link that opens in a new tab.' },
        },
      ],
    },
  ],
})
