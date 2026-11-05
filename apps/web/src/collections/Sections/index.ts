import type { CollectionConfig } from 'payload'

import { authenticated } from '@/access/authenticated'
import { sectionBlockSlugs } from '@/blocks'

/**
 * Sections edited once and shown on many pages, through the "Global section" block. No drafts
 * or versions: changes go live on save, and D1 stays small.
 */
export const Sections: CollectionConfig = {
  slug: 'sections',
  labels: { singular: 'Reusable section', plural: 'Reusable sections' },
  access: {
    create: authenticated,
    delete: authenticated,
    // Public on the pages that use it anyway.
    read: () => true,
    update: authenticated,
  },
  admin: {
    defaultColumns: ['title', 'updatedAt'],
    description:
      'Sections you edit once and reuse on many pages with the Global section block. Changes go live on every page that uses a section as soon as you save.',
    group: 'Content',
    useAsTitle: 'title',
  },
  // Payload 4 keeps versions for every collection unless told otherwise; sections publish on
  // save, so a versions table would only grow D1.
  versions: false,
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      admin: { description: 'Only shown in the admin, to find the section later.' },
    },
    {
      name: 'layout',
      type: 'blocks',
      // Registered once in `payload.config.ts` (`blocks`), listed here by slug.
      blocks: sectionBlockSlugs,
      required: true,
      admin: { initCollapsed: true },
    },
  ],
}
