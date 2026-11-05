import type { HeroBlock } from '@/payload-types'

import { defineBlockMeta } from '../shared/meta'

export const heroMeta = defineBlockMeta<HeroBlock>({
  slug: 'hero',
  labels: { singular: 'Hero', plural: 'Heroes' },
  group: 'Heroes',
  variants: [
    { label: 'Centered', value: 'centered' },
    { label: 'Split', value: 'split' },
    { label: 'Background image', value: 'image' },
  ],
  example: {
    eyebrow: 'New: on-page editing',
    title: 'Run your whole business from one calm dashboard',
    description:
      'Harbor brings invoicing, scheduling and customer messages together, so small teams spend less time on admin and more time on the work they love.',
    links: [
      { link: { type: 'custom', url: '#features', label: 'See features', appearance: 'default' } },
      { link: { type: 'custom', url: '#pricing', label: 'View pricing', appearance: 'outline' } },
    ],
  },
})
