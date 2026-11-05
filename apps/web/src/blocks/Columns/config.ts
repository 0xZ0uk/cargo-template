import { defineBlock } from '../shared/defineBlock'
import { headingFields } from '../shared/fields'

import { columnElements } from './elementBlocks'
import { columnsMeta } from './meta'
import { columnsThumbnail } from './thumbnail'

export const ColumnsConfig = defineBlock({
  meta: columnsMeta,
  interfaceName: 'ColumnsBlock',
  thumbnail: columnsThumbnail,
  fields: [
    ...headingFields(),
    {
      name: 'columns',
      type: 'array',
      admin: {
        description:
          'The layout decides the widths. On phones every column stacks; extra columns wrap onto a new row.',
        initCollapsed: true,
      },
      fields: [
        {
          // Never `section`: RenderBlocks reads a `section` key as the block's section settings.
          name: 'content',
          type: 'blocks',
          blocks: columnElements,
          labels: { singular: 'Element', plural: 'Elements' },
        },
      ],
      labels: { singular: 'Column', plural: 'Columns' },
      maxRows: 4,
      minRows: 1,
    },
  ],
})
