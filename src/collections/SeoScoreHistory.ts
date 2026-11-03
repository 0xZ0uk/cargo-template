/**
 * SEO Score History collection.
 * Stores SEO score snapshots over time for trend tracking.
 *
 * Usage (in plugin.ts):
 *   config.collections = [
 *     ...(config.collections || []),
 *     createSeoScoreHistoryCollection(),
 *   ]
 */

import type { CollectionConfig } from 'payload'
import { isSeoAdminRequest, isSeoPanelUser } from '../helpers/isAdmin.js'

export function createSeoScoreHistoryCollection(): CollectionConfig {
  return {
    slug: 'seo-score-history',
    // Payload 4 versions every collection by default. These are operational records
    // (settings, redirects, logs, snapshots), not authored content: version tables would
    // only duplicate them, and collections with `timestamps: false` cannot be versioned.
    versions: false,
    admin: {
      custom: { navHidden: true },
      // Managed through the plugin's own views; Payload 4 keeps the routes and API.
      group: false,
    },
    access: {
      // See SeoPerformance: `!!req.user` also accepted sessions from other auth
      // collections. Snapshots feed the alert digest, so forging them is not benign.
      // The trackSeoScore hook writes with overrideAccess: true — unaffected.
      read: ({ req }) => isSeoPanelUser(req),
      create: ({ req }) => isSeoAdminRequest(req),
      update: ({ req }) => isSeoAdminRequest(req),
      delete: ({ req }) => isSeoAdminRequest(req),
    },
    timestamps: false,
    fields: [
      {
        name: 'documentId',
        type: 'text',
        required: true,
        index: true,
        admin: {
          description: 'ID of the tracked page or post',
        },
      },
      {
        name: 'collection',
        type: 'text',
        required: true,
        index: true,
        admin: {
          description: "Collection slug (e.g. 'pages', 'posts')",
        },
      },
      {
        name: 'score',
        type: 'number',
        required: true,
        min: 0,
        max: 100,
        admin: {
          description: 'SEO score at time of snapshot (0-100)',
        },
      },
      {
        name: 'level',
        type: 'text',
        admin: {
          description: 'Score level: poor | ok | good | excellent',
        },
      },
      {
        name: 'focusKeyword',
        type: 'text',
        admin: {
          description: 'Focus keyword at time of snapshot',
        },
      },
      {
        name: 'wordCount',
        type: 'number',
        admin: {
          description: 'Word count at time of snapshot',
        },
      },
      {
        name: 'checksSummary',
        type: 'json',
        admin: {
          description: 'Summary: { pass: number, warning: number, fail: number }',
        },
      },
      {
        name: 'snapshotDate',
        type: 'date',
        required: true,
        index: true,
        defaultValue: () => new Date().toISOString(),
        admin: {
          description: 'Date of the snapshot',
        },
      },
    ],
  }
}
