import type { FeaturesBlock } from '@/payload-types'

import { defineBlockMeta } from '../shared/meta'

export const featuresMeta = defineBlockMeta<FeaturesBlock>({
  slug: 'features',
  labels: { singular: 'Features', plural: 'Features' },
  group: 'Features',
  variants: [
    { label: 'Grid', value: 'grid' },
    { label: 'Cards', value: 'cards' },
    { label: 'List', value: 'list' },
  ],
  example: {
    eyebrow: 'Features',
    title: 'Everything your team needs to ship faster',
    description:
      'Northwind brings planning, delivery and reporting into one workspace, so work keeps moving without the status meetings.',
    items: [
      {
        icon: 'zap',
        title: 'Instant setup',
        description:
          'Import your projects in minutes and start planning the same day. No consultants, no migration weekend.',
      },
      {
        icon: 'users',
        title: 'Built for teams',
        description:
          'Share boards, assign owners and keep everyone on the same page with comments and mentions.',
      },
      {
        icon: 'bar-chart',
        title: 'Clear reporting',
        description:
          'See progress, workload and delivery trends at a glance, and share live reports with stakeholders.',
      },
      {
        icon: 'shield-check',
        title: 'Secure by default',
        description:
          'Single sign-on, audit logs and role-based permissions keep your data protected as you grow.',
      },
      {
        icon: 'puzzle',
        title: 'Connects to your tools',
        description:
          'Sync with the calendar, chat and code tools your team already uses through one-click integrations.',
      },
      {
        icon: 'message-circle',
        title: 'Support that answers',
        description:
          'Talk to a real person within the hour, any day of the week. Most questions are solved in one reply.',
      },
    ],
  },
})
