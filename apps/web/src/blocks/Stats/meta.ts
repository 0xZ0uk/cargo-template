import type { StatsBlock } from '@/payload-types'

import { defineBlockMeta } from '../shared/meta'

export const statsMeta = defineBlockMeta<StatsBlock>({
  slug: 'stats',
  labels: { singular: 'Stats', plural: 'Stats' },
  group: 'Social proof',
  variants: [
    { label: 'Row', value: 'row' },
    { label: 'Cards', value: 'cards' },
    { label: 'With text', value: 'split' },
  ],
  example: {
    eyebrow: 'By the numbers',
    title: 'Teams ship faster with Northwind',
    description:
      'Thousands of teams use Northwind to plan, track and deliver their work. Here is what that looks like in practice.',
    items: [
      {
        value: '98%',
        label: 'Customer satisfaction',
        description: 'Average score across more than 12,000 support conversations.',
      },
      {
        value: '2.5M',
        label: 'Tasks completed every week',
        description: 'Work finished by teams of every size, from startups to enterprises.',
      },
      {
        value: '40%',
        label: 'Faster delivery',
        description: 'Median reduction in cycle time within the first three months.',
      },
      {
        value: '24/7',
        label: 'Support',
        description: 'Real people answer within minutes, in every time zone.',
      },
    ],
  },
})
