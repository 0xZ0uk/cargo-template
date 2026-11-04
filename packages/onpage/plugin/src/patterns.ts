/**
 * Saved sections ("patterns", opt-in: the `patterns` option): a block's
 * content kept under a name, to insert again from the block picker. Stored as
 * plain JSON in a collection of their own, so they're in the admin too.
 */
import type { CollectionConfig, PayloadRequest } from 'payload'

export const PATTERNS = 'onpage-patterns'

/** Largest saved section, as JSON (a guard, not a design limit). */
export const MAX_PATTERN_BYTES = 200_000

export function patternsCollection(adminUser: string): CollectionConfig {
  const isEditor = ({ req }: { req: PayloadRequest }) => req.user?.collection === adminUser
  return {
    slug: PATTERNS,
    labels: { singular: 'Saved section', plural: 'Saved sections' },
    admin: {
      useAsTitle: 'name',
      group: 'On-page',
      defaultColumns: ['name', 'blockType', 'updatedAt'],
    },
    access: { read: isEditor, create: isEditor, update: isEditor, delete: isEditor },
    timestamps: true,
    fields: [
      { name: 'name', type: 'text', required: true, maxLength: 120 },
      { name: 'blockType', type: 'text', required: true, index: true },
      { name: 'data', type: 'json', required: true },
    ],
  }
}
