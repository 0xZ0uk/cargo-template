import type { MediaSectionBlock } from '@/payload-types'

import { defineBlockMeta } from '../shared/meta'

export const mediaBlockMeta = defineBlockMeta<MediaSectionBlock>({
  slug: 'mediaBlock',
  labels: { singular: 'Media', plural: 'Media' },
  group: 'Media',
  variants: [
    { label: 'Contained', value: 'contained' },
    { label: 'Narrow', value: 'narrow' },
    { label: 'Full width', value: 'full' },
  ],
  example: {
    caption: 'Our studio in Lisbon, where every project starts on a shared table.',
  },
})
