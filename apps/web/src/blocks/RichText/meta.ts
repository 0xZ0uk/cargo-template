import type { RichTextBlock } from '@/payload-types'

import { bulletList, heading, numberedList, paragraph, richText } from '../shared/lexical'
import { defineBlockMeta } from '../shared/meta'

export const richTextMeta = defineBlockMeta<RichTextBlock>({
  slug: 'richText',
  labels: { singular: 'Rich text', plural: 'Rich text' },
  group: 'Content',
  variants: [
    { label: 'Narrow', value: 'narrow' },
    { label: 'Wide', value: 'wide' },
  ],
  example: {
    richText: richText(
      heading('h2', 'A heading for this section'),
      paragraph(
        'Write as much as the page needs. Rich text keeps long-form content readable: paragraphs, lists, links and headings.',
      ),
      bulletList(
        'Clear structure',
        {
          text: 'Comfortable line length',
          list: bulletList('Narrow for reading', 'Wide for tables and long examples'),
        },
        'Links to related pages',
      ),
      paragraph('Numbered lists keep their order:'),
      numberedList('Write the content', 'Pick a variant', 'Publish'),
    ),
  },
})
