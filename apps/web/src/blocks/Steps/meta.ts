import type { StepsBlock } from '@/payload-types'

import { defineBlockMeta } from '../shared/meta'

export const stepsMeta = defineBlockMeta<StepsBlock>({
  slug: 'steps',
  labels: { singular: 'Steps', plural: 'Steps' },
  group: 'Features',
  variants: [
    { label: 'Cards', value: 'cards' },
    { label: 'Timeline', value: 'timeline' },
    { label: 'Horizontal', value: 'horizontal' },
  ],
  example: {
    eyebrow: 'How it works',
    title: 'From sign-up to launch in four steps',
    description: 'No setup calls, no developers. Most teams are live within a day.',
    items: [
      {
        title: 'Create your account',
        description: 'Sign up with your email and name your workspace. It takes under a minute.',
        icon: 'users',
      },
      {
        title: 'Connect your tools',
        description:
          'Link the apps your team already uses. Your data syncs automatically and stays up to date.',
        icon: 'puzzle',
      },
      {
        title: 'Make it yours',
        description:
          'Pick a template, add your brand colours and logo, and invite your teammates to collaborate.',
        icon: 'wand',
      },
      {
        title: 'Go live',
        description: 'Review everything once more, then publish with a single click.',
        icon: 'rocket',
      },
    ],
  },
})
