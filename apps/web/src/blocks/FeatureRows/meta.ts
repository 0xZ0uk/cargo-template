import type { FeatureRowsBlock } from '@/payload-types'

import { bulletList, paragraph, richText } from '../shared/lexical'
import { defineBlockMeta } from '../shared/meta'

export const featureRowsMeta = defineBlockMeta<FeatureRowsBlock>({
  slug: 'featureRows',
  labels: { singular: 'Feature rows', plural: 'Feature rows' },
  group: 'Features',
  variants: [
    { label: 'Alternating', value: 'alternating' },
    { label: 'Image left', value: 'imageLeft' },
    { label: 'Image right', value: 'imageRight' },
  ],
  example: {
    eyebrow: 'How it works',
    title: 'Everything your team needs to ship on time',
    description:
      'Northwind brings planning, collaboration and reporting into one calm workspace, so nothing slips between tools.',
    rows: [
      {
        eyebrow: 'Plan',
        title: 'Turn goals into a clear roadmap',
        richText: richText(
          paragraph(
            'Map out what matters this quarter and see how every task connects to the bigger picture.',
          ),
          bulletList('Drag-and-drop timelines', 'Shared milestones', 'Dependencies at a glance'),
        ),
        links: [
          {
            link: {
              type: 'custom',
              url: '#',
              label: 'Explore planning',
              appearance: 'default',
            },
          },
        ],
      },
      {
        eyebrow: 'Collaborate',
        title: 'Keep every conversation next to the work',
        richText: richText(
          paragraph(
            'Comments, files and decisions live on the task itself, so context never gets lost in a chat thread.',
          ),
          bulletList('Threaded comments', 'Mentions and reminders', 'One shared activity feed'),
        ),
      },
      {
        eyebrow: 'Measure',
        title: 'Know where you stand, without the meetings',
        richText: richText(
          paragraph(
            'Live dashboards show progress, workload and risks, and send a weekly summary to anyone who wants one.',
          ),
          bulletList('Progress reports', 'Workload balancing', 'Automatic weekly digests'),
        ),
      },
    ],
  },
})
