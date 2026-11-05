import type { ReviewsBlock } from '@/payload-types'

import { defineBlockMeta } from '../shared/meta'

export const reviewsMeta = defineBlockMeta<ReviewsBlock>({
  slug: 'reviews',
  labels: { singular: 'Reviews', plural: 'Reviews' },
  group: 'Social proof',
  variants: [
    { label: 'Summary and grid', value: 'grid' },
    { label: 'Summary only', value: 'summary' },
    { label: 'List', value: 'list' },
  ],
  example: {
    eyebrow: 'Reviews',
    title: 'Loved by teams that ship every week',
    description:
      'Real feedback from customers who moved their planning and reporting to Northwind.',
    average: 4.8,
    count: '1,200',
    source: 'Google',
    items: [
      {
        rating: '5',
        title: 'Replaced three tools with one',
        body: 'We moved planning, reporting and handoffs into Northwind in a single afternoon. The team stopped asking where things live, and our weekly review now takes half the time.',
        author: 'Maya Fernandes',
        date: 'March 2026',
      },
      {
        rating: '5',
        title: 'Support that actually answers',
        body: 'I asked a tricky question about permissions on a Friday evening and had a clear, correct reply within the hour. That alone made the switch worth it.',
        author: 'Daniel Okafor',
        date: 'February 2026',
      },
      {
        rating: '5',
        title: 'Clean, fast and easy to roll out',
        body: 'Onboarding forty people took one short call. The defaults are sensible, so almost nobody needed training.',
        author: 'Sofia Lindqvist',
        date: 'February 2026',
      },
      {
        rating: '4',
        title: 'Great value for a growing team',
        body: 'Pricing stays predictable as we add people, and the reports finally give leadership the numbers they ask for. I would love a few more integrations.',
        author: 'Tomás Rivera',
        date: 'January 2026',
      },
      {
        rating: '5',
        title: 'Our clients noticed the difference',
        body: 'Shared project pages mean clients see progress without a status meeting. Two of them mentioned it in their renewal feedback.',
        author: 'Hannah Becker',
        date: 'December 2025',
      },
      {
        rating: '4',
        title: 'Does what it promises',
        body: 'Stable, quick and thoughtfully designed. We have used it daily for a year and have not hit a single outage.',
        author: 'Kenji Watanabe',
        date: 'November 2025',
      },
    ],
  },
})
