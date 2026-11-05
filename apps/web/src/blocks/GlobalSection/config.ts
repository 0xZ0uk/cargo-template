import { defineBlock } from '../shared/defineBlock'

import { globalSectionMeta } from './meta'
import { globalSectionThumbnail } from './thumbnail'

export const GlobalSectionConfig = defineBlock({
  meta: globalSectionMeta,
  interfaceName: 'GlobalSectionBlock',
  thumbnail: globalSectionThumbnail,
  fields: [
    {
      // Not `section`: RenderBlocks treats a `section` key as the block's section settings.
      name: 'reusableSection',
      type: 'relationship',
      relationTo: 'sections',
      required: true,
      label: 'Reusable section',
      admin: {
        description:
          'Pick a section from Reusable sections. Edit it there once and every page that uses it updates.',
      },
    },
  ],
})
