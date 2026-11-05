import type { CtaBlock } from '@/payload-types'

import { defineBlockMeta } from '../shared/meta'

export const ctaMeta = defineBlockMeta<CtaBlock>({
  slug: 'cta',
  labels: { singular: 'Call to action', plural: 'Calls to action' },
  group: 'Conversion',
  variants: [
    { label: 'Banner', value: 'banner' },
    { label: 'Split', value: 'split' },
    { label: 'Centered', value: 'centered' },
  ],
  example: {
    title: 'Ready to build your site?',
    description:
      'Start from a polished template, make it yours in an afternoon and publish without writing a line of code.',
    links: [
      { link: { type: 'custom', url: '/admin', label: 'Get started', appearance: 'default' } },
      { link: { type: 'custom', url: '#features', label: 'Learn more', appearance: 'outline' } },
    ],
  },
})
