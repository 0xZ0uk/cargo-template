import type { PageHeaderBlock } from '@/payload-types'

import { defineBlockMeta } from '../shared/meta'

export const pageHeaderMeta = defineBlockMeta<PageHeaderBlock>({
  slug: 'pageHeader',
  labels: { singular: 'Page header', plural: 'Page headers' },
  group: 'Heroes',
  variants: [
    { label: 'Simple', value: 'simple' },
    { label: 'Centered', value: 'centered' },
  ],
  example: {
    eyebrow: 'Our story',
    title: 'About us',
    description:
      'We are a small team building calm, dependable tools for studios and growing businesses. Here is who we are and what we believe in.',
    showBreadcrumbs: true,
  },
})
