import { linkGroup } from '@/fields/linkGroup'

import { defineBlock } from '../shared/defineBlock'
import { headingFields, mediaField } from '../shared/fields'

import { heroMeta } from './meta'
import { heroThumbnail } from './thumbnail'

export const HeroConfig = defineBlock({
  meta: heroMeta,
  interfaceName: 'HeroBlock',
  thumbnail: heroThumbnail,
  fields: [
    // The title is the page's h1.
    ...headingFields({ titleRequired: true }),
    linkGroup({ appearances: ['default', 'outline'], overrides: { maxRows: 2 } }),
    mediaField({
      admin: {
        description:
          'Shown below the text (Centered), beside it (Split) or behind it (Background image).',
      },
    }),
  ],
})
