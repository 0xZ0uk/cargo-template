import { defineBlock } from '../shared/defineBlock'
import { headingFields, mediaField } from '../shared/fields'

import { testimonialsMeta } from './meta'
import { testimonialsThumbnail } from './thumbnail'

export const TestimonialsConfig = defineBlock({
  meta: testimonialsMeta,
  interfaceName: 'TestimonialsBlock',
  thumbnail: testimonialsThumbnail,
  fields: [
    ...headingFields(),
    {
      name: 'items',
      type: 'array',
      admin: {
        description:
          'Customer quotes. The Spotlight layout shows only the first one; the others are ignored.',
        initCollapsed: true,
      },
      fields: [
        { name: 'quote', type: 'textarea', required: true },
        {
          type: 'row',
          fields: [
            { name: 'name', type: 'text', required: true },
            {
              name: 'role',
              type: 'text',
              admin: { description: 'Job title and company, e.g. "CTO, Acme".' },
            },
          ],
        },
        mediaField({
          name: 'avatar',
          admin: { description: 'Optional portrait. Initials are shown without one.' },
        }),
      ],
      maxRows: 12,
    },
  ],
})
