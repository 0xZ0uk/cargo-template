import { linkGroup } from '@/fields/linkGroup'

import { defineBlock } from '../shared/defineBlock'
import { headingFields } from '../shared/fields'

import { ctaMeta } from './meta'
import { ctaThumbnail } from './thumbnail'

export const CtaConfig = defineBlock({
  meta: ctaMeta,
  interfaceName: 'CtaBlock',
  thumbnail: ctaThumbnail,
  fields: [
    ...headingFields({ titleRequired: true }),
    linkGroup({ appearances: ['default', 'outline'], overrides: { maxRows: 2 } }),
  ],
})
