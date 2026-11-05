import { defineBlock } from '../shared/defineBlock'
import { headingFields, mediaField } from '../shared/fields'

import { galleryMeta } from './meta'
import { galleryThumbnail } from './thumbnail'

export const GalleryConfig = defineBlock({
  meta: galleryMeta,
  interfaceName: 'GalleryBlock',
  thumbnail: galleryThumbnail,
  fields: [
    ...headingFields(),
    {
      name: 'items',
      type: 'array',
      admin: { initCollapsed: true },
      fields: [
        mediaField(),
        {
          name: 'caption',
          type: 'text',
          admin: { description: 'Shown under the image. Optional.' },
        },
      ],
      labels: { plural: 'Images', singular: 'Image' },
      maxRows: 40,
    },
  ],
})
