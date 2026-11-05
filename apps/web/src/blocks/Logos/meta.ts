import type { LogosBlock } from '@/payload-types'

import { defineBlockMeta } from '../shared/meta'

export const logosMeta = defineBlockMeta<LogosBlock>({
  slug: 'logos',
  labels: { singular: 'Logos', plural: 'Logos' },
  group: 'Social proof',
  variants: [
    { label: 'Row', value: 'row' },
    { label: 'Grid', value: 'grid' },
    { label: 'Marquee', value: 'marquee' },
  ],
  example: {
    title: 'Trusted by teams at',
    items: [
      { name: 'Northwind' },
      { name: 'Acme Labs' },
      { name: 'Lumen' },
      { name: 'Foxglove' },
      { name: 'Meridian' },
      { name: 'Brightwave' },
      { name: 'Oakridge' },
      { name: 'Quanta' },
    ],
  },
})
