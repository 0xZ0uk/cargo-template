/**
 * SEO fields added automatically to collections by the plugin.
 * Includes: focusKeyword, focusKeywords array, isCornerstone, and the SeoAnalyzer UI.
 */

import type { Field } from 'payload'

export function seoFields(): Field[] {
  return [
    {
      name: 'isCornerstone',
      type: 'checkbox',
      defaultValue: false,
      label: 'Cornerstone content',
      admin: {
        description: 'Cornerstone content is the most important content on your site and should be well linked.',
        position: 'sidebar',
      },
    },
    {
      name: 'focusKeyword',
      type: 'text',
      label: 'Primary SEO keyword',
      admin: {
        position: 'sidebar',
        description: 'Target keyword for SEO analysis',
      },
    },
    {
      name: 'seoAnalyzer',
      type: 'ui',
      admin: {
        position: 'sidebar',
        components: {
          Field: '@cargo/payload-seo-analyzer/client#SeoAnalyzerField',
        },
      },
    },
    {
      type: 'collapsible',
      label: 'Secondary keywords (SEO)',
      admin: { initCollapsed: true },
      fields: [
        {
          name: 'focusKeywords',
          type: 'array',
          maxRows: 3,
          admin: {
            description: 'Secondary keywords (in addition to the primary keyword)',
          },
          fields: [
            {
              name: 'keyword',
              type: 'text',
              required: true,
            },
          ],
        },
      ],
    },
  ]
}
