import { defineBlock } from '../shared/defineBlock'
import { headingFields } from '../shared/fields'

import { pageHeaderMeta } from './meta'
import { pageHeaderThumbnail } from './thumbnail'

export const PageHeaderConfig = defineBlock({
  meta: pageHeaderMeta,
  interfaceName: 'PageHeaderBlock',
  thumbnail: pageHeaderThumbnail,
  fields: [
    // The title is the page's h1, so it is required.
    ...headingFields({ titleRequired: true }),
    {
      name: 'showBreadcrumbs',
      type: 'checkbox',
      admin: { description: 'Shows Home › this page above the title.' },
      defaultValue: true,
      label: 'Show breadcrumbs',
    },
  ],
})
