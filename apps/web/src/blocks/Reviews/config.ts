import { defineBlock } from '../shared/defineBlock'
import { headingFields } from '../shared/fields'

import { reviewsMeta } from './meta'
import { reviewsThumbnail } from './thumbnail'

export const ReviewsConfig = defineBlock({
  meta: reviewsMeta,
  interfaceName: 'ReviewsBlock',
  thumbnail: reviewsThumbnail,
  fields: [
    ...headingFields(),
    {
      type: 'row',
      fields: [
        {
          name: 'average',
          type: 'number',
          admin: {
            description: 'Average rating out of 5, e.g. 4.8.',
            step: 0.1,
            width: '33%',
          },
          max: 5,
          min: 0,
        },
        {
          name: 'count',
          type: 'text',
          admin: { description: 'Number of reviews, e.g. 1,200.', width: '33%' },
        },
        {
          name: 'source',
          type: 'text',
          admin: { description: 'Where the reviews come from, e.g. Google.', width: '33%' },
        },
      ],
    },
    {
      name: 'items',
      type: 'array',
      admin: { initCollapsed: true },
      fields: [
        {
          name: 'rating',
          type: 'select',
          defaultValue: '5',
          options: ['1', '2', '3', '4', '5'].map((value) => ({
            label: `${value} ${value === '1' ? 'star' : 'stars'}`,
            value,
          })),
          required: true,
        },
        { name: 'title', type: 'text' },
        { name: 'body', type: 'textarea', required: true },
        {
          type: 'row',
          fields: [
            { name: 'author', type: 'text', required: true },
            {
              name: 'date',
              type: 'text',
              admin: { description: 'Free text, e.g. March 2026.' },
            },
          ],
        },
      ],
      labels: { plural: 'Reviews', singular: 'Review' },
      maxRows: 12,
    },
  ],
})
