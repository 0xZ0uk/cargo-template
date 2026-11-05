import type { GalleryBlock } from '@/payload-types'

import { defineBlockMeta } from '../shared/meta'

export const galleryMeta = defineBlockMeta<GalleryBlock>({
  slug: 'gallery',
  labels: { singular: 'Gallery', plural: 'Galleries' },
  group: 'Media',
  variants: [
    { label: 'Grid', value: 'grid' },
    { label: 'Masonry', value: 'masonry' },
    { label: 'Carousel', value: 'carousel' },
  ],
  example: {
    eyebrow: 'Gallery',
    title: 'A look inside Northwind Studio',
    description:
      'Workshops, launch days and everyday moments from the people who build and use our products.',
    items: [
      { caption: 'Our Lisbon studio on a Friday afternoon' },
      { caption: 'The team at the spring product launch' },
      { caption: 'Prototyping the next release on the whiteboard' },
      { caption: 'Customer workshop in Porto' },
      { caption: 'Shipping day, coffee included' },
      { caption: 'Design review with the whole crew' },
    ],
  },
})
