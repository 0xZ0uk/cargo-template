import { defineBlock } from '../shared/defineBlock'
import { mediaField } from '../shared/fields'

import { mediaBlockMeta } from './meta'
import { mediaBlockThumbnail } from './thumbnail'

export const MediaBlockConfig = defineBlock({
  meta: mediaBlockMeta,
  interfaceName: 'MediaSectionBlock',
  thumbnail: mediaBlockThumbnail,
  fields: [
    mediaField({
      admin: {
        description: 'An image or video. It keeps its own proportions, so nothing gets cropped.',
      },
    }),
    {
      name: 'caption',
      type: 'text',
      admin: { description: 'Optional line shown under the media.' },
    },
  ],
})
