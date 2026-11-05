import type { TestimonialsBlock } from '@/payload-types'

import { defineBlockMeta } from '../shared/meta'

export const testimonialsMeta = defineBlockMeta<TestimonialsBlock>({
  slug: 'testimonials',
  labels: { singular: 'Testimonials', plural: 'Testimonials' },
  group: 'Social proof',
  variants: [
    { label: 'Grid', value: 'grid' },
    { label: 'Masonry', value: 'masonry' },
    { label: 'Spotlight', value: 'spotlight' },
  ],
  example: {
    eyebrow: 'Testimonials',
    title: 'Loved by teams that ship every week',
    description:
      'Hear from the people who swapped their spreadsheets and status meetings for Northwind.',
    items: [
      {
        quote:
          'Northwind replaced three tools and a weekly status meeting. Our whole team now works from one clear plan, and releases feel calm for the first time.',
        name: 'Maya Lindqvist',
        role: 'CTO, Brightwave',
      },
      {
        quote: 'Setup took an afternoon. We were running real projects by the next morning.',
        name: 'Daniel Okafor',
        role: 'Head of Product, Fieldnote',
      },
      {
        quote:
          'The reporting alone paid for the subscription. I can finally answer "where are we?" in ten seconds, without pinging anyone.',
        name: 'Priya Raman',
        role: 'Operations Lead, Kestrel Logistics',
      },
      {
        quote:
          'Support is the best I have seen from a software vendor. Real people, real answers, same day.',
        name: 'Tomás Herrera',
        role: 'Founder, Casa Verde Studio',
      },
      {
        quote:
          'We onboarded forty people across four time zones without a single training call. The product explains itself, and the templates gave every team a head start.',
        name: 'Hannah Becker',
        role: 'VP Engineering, Lumen Health',
      },
      {
        quote: 'Simple, fast and honest pricing. Exactly what a growing agency needs.',
        name: 'Sam Whitfield',
        role: 'Director, Plainsight Agency',
      },
    ],
  },
})
