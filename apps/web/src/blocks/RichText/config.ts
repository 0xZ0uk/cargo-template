import { defineBlock } from '../shared/defineBlock'
import { blockRichText } from '../shared/fields'

import { richTextMeta } from './meta'
import { richTextThumbnail } from './thumbnail'

export const RichTextConfig = defineBlock({
  meta: richTextMeta,
  interfaceName: 'RichTextBlock',
  thumbnail: richTextThumbnail,
  fields: [
    // Named `richText` so the SEO analyzer reads it (it looks for `richText` on each block).
    // h1 allowed: a page without a Hero (legal, docs) opens with this block.
    {
      name: 'richText',
      type: 'richText',
      editor: blockRichText({ headings: ['h1', 'h2', 'h3', 'h4'] }),
      label: false,
      required: true,
    },
  ],
})
