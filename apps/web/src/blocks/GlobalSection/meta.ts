import type { GlobalSectionBlock } from '@/payload-types'

import { defineBlockMeta, type BlockExample } from '../shared/meta'

export const globalSectionMeta = defineBlockMeta<GlobalSectionBlock>({
  slug: 'globalSection',
  labels: { singular: 'Global section', plural: 'Global sections' },
  group: 'Layout',
  // No section settings: the blocks inside the reusable section have their own.
  section: false,
  // A relationship can't be pre-filled, so the example is empty and shows the "choose a section"
  // placeholder. The field is required, hence the cast.
  example: {} as BlockExample<GlobalSectionBlock>,
})
