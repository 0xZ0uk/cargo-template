import { defineBlock } from '../shared/defineBlock'
import { blockRichText, headingFields } from '../shared/fields'

import { faqMeta } from './meta'
import { faqThumbnail } from './thumbnail'

export const FaqConfig = defineBlock({
  meta: faqMeta,
  interfaceName: 'FaqBlock',
  thumbnail: faqThumbnail,
  fields: [
    ...headingFields(),
    {
      name: 'items',
      type: 'array',
      admin: {
        description: 'Questions and answers, in the order they appear.',
        initCollapsed: true,
      },
      fields: [
        { name: 'question', type: 'text', required: true },
        {
          name: 'answer',
          type: 'richText',
          editor: blockRichText({ headings: [] }),
          required: true,
        },
      ],
      labels: { singular: 'Question', plural: 'Questions' },
      maxRows: 30,
    },
  ],
})
