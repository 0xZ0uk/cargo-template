import type { EmbedBlock } from '@/payload-types'

import { defineBlockMeta } from '../shared/meta'

export const embedMeta = defineBlockMeta<EmbedBlock>({
  slug: 'embed',
  labels: { singular: 'Embed', plural: 'Embeds' },
  group: 'Media',
  variants: [
    { label: 'Video (16:9)', value: 'video' },
    { label: 'Square (1:1)', value: 'square' },
    { label: 'Tall (3:4)', value: 'tall' },
  ],
  example: {
    url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    title: 'Big Buck Bunny, an open movie by the Blender Foundation',
    caption:
      'Sample video. Paste your own YouTube, Vimeo, Loom, Spotify, Google Maps or Calendly link.',
  },
})
