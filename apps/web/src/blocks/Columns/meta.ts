import type { ColumnsBlock } from '@/payload-types'

import { heading, paragraph, richText } from '../shared/lexical'
import { defineBlockMeta } from '../shared/meta'

export const columnsMeta = defineBlockMeta<ColumnsBlock>({
  slug: 'columns',
  labels: { singular: 'Columns', plural: 'Columns' },
  group: 'Layout',
  variants: [
    { label: 'Two equal', value: 'halves' },
    { label: 'Three equal', value: 'thirds' },
    { label: 'Four equal', value: 'quarters' },
    { label: 'Wide + narrow', value: 'twoOne' },
    { label: 'Narrow + wide', value: 'oneTwo' },
  ],
  example: {
    eyebrow: 'Why Northwind',
    title: 'Everything your team needs to ship on time',
    description: 'One workspace for planning, tracking and reporting, so nothing falls through.',
    columns: [
      {
        content: [
          {
            blockType: 'columnText',
            richText: richText(
              heading('h3', 'Plan work together'),
              paragraph(
                'Turn goals into projects, assign owners and set deadlines in minutes. Everyone sees the same plan, and it updates as work moves.',
              ),
            ),
          },
          {
            blockType: 'columnButtons',
            links: [
              {
                link: {
                  type: 'custom',
                  url: '#',
                  label: 'Start free trial',
                  appearance: 'default',
                },
              },
              {
                link: {
                  type: 'custom',
                  url: '#',
                  label: 'See how it works',
                  appearance: 'outline',
                },
              },
            ],
          },
        ],
      },
      {
        content: [
          { blockType: 'columnMedia', caption: 'The project board shows progress at a glance.' },
          {
            blockType: 'columnCard',
            icon: 'rocket',
            title: 'Launch with confidence',
            description: 'Checklists and approvals keep every release on track.',
          },
        ],
      },
    ],
  },
})
