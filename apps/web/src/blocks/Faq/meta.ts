import type { FaqBlock } from '@/payload-types'

import { paragraph, richText } from '../shared/lexical'
import { defineBlockMeta } from '../shared/meta'

export const faqMeta = defineBlockMeta<FaqBlock>({
  slug: 'faq',
  labels: { singular: 'FAQ', plural: 'FAQs' },
  group: 'Content',
  variants: [
    { label: 'Accordion', value: 'accordion' },
    { label: 'Two columns', value: 'split' },
    { label: 'Open grid', value: 'grid' },
  ],
  example: {
    eyebrow: 'FAQ',
    title: 'Questions, answered',
    description:
      'Everything you need to know about Northwind. Cannot find what you are looking for? Our team is happy to help.',
    items: [
      {
        question: 'How does billing work?',
        answer: richText(
          paragraph(
            'Northwind is billed per workspace, monthly or yearly. Invoices are emailed on the first day of each billing period, and annual plans save two months compared with paying monthly.',
          ),
        ),
      },
      {
        question: 'Can I cancel at any time?',
        answer: richText(
          paragraph(
            'Yes. Cancel from your account settings whenever you like and you keep access until the end of the period you have already paid for. There are no cancellation fees.',
          ),
        ),
      },
      {
        question: 'What happens to my data if I leave?',
        answer: richText(
          paragraph(
            'You can export everything as CSV or JSON before you go. After cancelling, your workspace is kept for 30 days in case you change your mind, then permanently deleted.',
          ),
        ),
      },
      {
        question: 'Is my data secure?',
        answer: richText(
          paragraph(
            'Data is encrypted in transit and at rest, backed up every night, and stored in the region you choose when you create your workspace. We never sell or share your data.',
          ),
        ),
      },
      {
        question: 'Do you offer discounts for nonprofits or students?',
        answer: richText(
          paragraph(
            'We do. Registered nonprofits, schools and students get 50% off any plan. Contact our team with proof of status and we will apply the discount within one business day.',
          ),
        ),
      },
      {
        question: 'How do I get help if something goes wrong?',
        answer: richText(
          paragraph(
            'Reach support from the chat widget or by email, any day of the week. Most questions are answered within a few hours, and paid plans include priority responses.',
          ),
        ),
      },
    ],
  },
})
