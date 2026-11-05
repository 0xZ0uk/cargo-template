import type { PricingBlock } from '@/payload-types'

import { defineBlockMeta } from '../shared/meta'

export const pricingMeta = defineBlockMeta<PricingBlock>({
  slug: 'pricing',
  labels: { singular: 'Pricing', plural: 'Pricing' },
  group: 'Conversion',
  variants: [
    { label: 'Cards', value: 'cards' },
    { label: 'Single plan', value: 'single' },
  ],
  example: {
    eyebrow: 'Pricing',
    title: 'Simple pricing that grows with you',
    description:
      'Start for free, upgrade when your team needs more. No hidden fees, cancel any time.',
    plans: [
      {
        name: 'Starter',
        price: '$0',
        period: '/month',
        description: 'Everything you need to try Northwind with a small project.',
        features: [
          { feature: '1 workspace' },
          { feature: 'Up to 3 team members' },
          { feature: '5 GB of storage' },
          { feature: 'Community support' },
        ],
        highlighted: false,
        link: { type: 'custom', url: '#contact', label: 'Get started' },
      },
      {
        name: 'Pro',
        price: '$29',
        period: '/month',
        description: 'For growing teams that need more room and faster support.',
        features: [
          { feature: 'Unlimited workspaces' },
          { feature: 'Up to 25 team members' },
          { feature: '100 GB of storage' },
          { feature: 'Advanced analytics' },
          { feature: 'Priority email support' },
        ],
        highlighted: true,
        badge: 'Most popular',
        link: { type: 'custom', url: '#contact', label: 'Start free trial' },
      },
      {
        name: 'Enterprise',
        price: 'Custom',
        description: 'Security, scale and support tailored to your organisation.',
        features: [
          { feature: 'Unlimited team members' },
          { feature: 'Single sign-on (SSO)' },
          { feature: 'Audit logs and custom roles' },
          { feature: 'Uptime SLA' },
          { feature: 'Dedicated account manager' },
          { feature: 'Onboarding and training' },
        ],
        highlighted: false,
        link: { type: 'custom', url: '#contact', label: 'Contact sales' },
      },
    ],
    footnote: 'Prices exclude VAT. Annual billing saves 20%.',
  },
})
