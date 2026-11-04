/**
 * SEO Settings singleton collection.
 * Stores site-wide SEO configuration (site name, ignored slugs, disabled rules, thresholds).
 * Managed via the admin Configuration SEO view.
 *
 * Usage (in plugin.ts):
 *   config.collections = [
 *     ...(config.collections || []),
 *     createSeoSettingsCollection(),
 *   ]
 */

import type { CollectionConfig } from 'payload'
import { isSeoAdminRequest, isSeoPanelUser } from '../helpers/isAdmin.js'

export function createSeoSettingsCollection(): CollectionConfig {
  return {
    slug: 'seo-settings',
    // Payload 4 versions every collection by default. These are operational records
    // (settings, redirects, logs, snapshots), not authored content: version tables would
    // only duplicate them, and collections with `timestamps: false` cannot be versioned.
    versions: false,
    admin: {
      custom: { navHidden: true },
      // Managed through the plugin's own views; Payload 4 keeps the routes and API.
      group: false,
    },
    // `read` stays open to any authenticated user: the admin views and the
    // plugin endpoints both surface this data to editors. Writes are restricted
    // to SEO admins, mirroring the gate the endpoints already enforce
    // (`isSeoAdmin` in settings.ts / redirects.ts). Without this, an editor
    // could bypass those endpoints through the REST collection API — writing
    // `robotsCustomRules`, neutralising `disabledRules`, creating a redirect or
    // overwriting the OAuth CSRF state.
    access: {
      read: ({ req }) => isSeoPanelUser(req),
      create: ({ req }) => isSeoAdminRequest(req),
      update: ({ req }) => isSeoAdminRequest(req),
      delete: ({ req }) => isSeoAdminRequest(req),
    },
    fields: [
      {
        name: 'siteName',
        type: 'text',
        label: 'Site name',
        admin: {
          description: 'Used for the brand check in titles',
        },
      },
      {
        name: 'ignoredSlugs',
        type: 'array',
        label: 'Ignored slugs',
        admin: {
          description: 'Pages excluded from the SEO audit (e.g. legal-notice, terms)',
        },
        fields: [
          {
            name: 'slug',
            type: 'text',
            required: true,
          },
        ],
      },
      {
        name: 'disabledRules',
        type: 'select',
        hasMany: true,
        label: 'Disabled rules',
        admin: {
          description: 'Rule groups to ignore during analysis',
        },
        options: [
          { label: 'Title', value: 'title' },
          { label: 'Meta description', value: 'meta-description' },
          { label: 'URL / Slug', value: 'url' },
          { label: 'H1–H6 headings', value: 'headings' },
          { label: 'Content', value: 'content' },
          { label: 'Images', value: 'images' },
          { label: 'Links', value: 'linking' },
          { label: 'Social networks', value: 'social' },
          { label: 'Structured data', value: 'schema' },
          { label: 'Readability', value: 'readability' },
          { label: 'Quality', value: 'quality' },
          { label: 'Secondary keywords', value: 'secondary-keywords' },
          { label: 'Cornerstone content', value: 'cornerstone' },
          { label: 'Freshness', value: 'freshness' },
          { label: 'Technical', value: 'technical' },
          { label: 'Accessibility', value: 'accessibility' },
          { label: 'E-commerce', value: 'ecommerce' },
        ],
      },
      {
        name: 'thresholds',
        type: 'group',
        label: 'Custom thresholds',
        admin: {
          description: 'Leave empty to use the default values',
        },
        fields: [
          { name: 'titleLengthMin', type: 'number', label: 'Title — min length', admin: { description: 'Default: 30' } },
          { name: 'titleLengthMax', type: 'number', label: 'Title — max length', admin: { description: 'Default: 60' } },
          { name: 'metaDescLengthMin', type: 'number', label: 'Meta desc — min length', admin: { description: 'Default: 120' } },
          { name: 'metaDescLengthMax', type: 'number', label: 'Meta desc — max length', admin: { description: 'Default: 160' } },
          { name: 'minWordsGeneric', type: 'number', label: 'Min words (pages)', admin: { description: 'Default: 300' } },
          { name: 'minWordsPost', type: 'number', label: 'Min words (posts)', admin: { description: 'Default: 800' } },
          { name: 'keywordDensityMin', type: 'number', label: 'Min keyword density (%)', admin: { description: 'Default: 0.5' } },
          { name: 'keywordDensityMax', type: 'number', label: 'Max keyword density (%)', admin: { description: 'Default: 3' } },
          { name: 'fleschScorePass', type: 'number', label: 'Min Flesch score', admin: { description: 'Default: 40' } },
          { name: 'slugMaxLength', type: 'number', label: 'Max slug length', admin: { description: 'Default: 75' } },
        ],
      },
      {
        name: 'sitemap',
        type: 'group',
        label: 'Sitemap configuration',
        fields: [
          {
            name: 'excludedSlugs',
            type: 'array',
            label: 'Slugs excluded from the sitemap',
            admin: {
              description: 'Pages to exclude from sitemap generation',
            },
            fields: [{ name: 'slug', type: 'text', required: true }],
          },
          {
            name: 'defaultChangefreq',
            type: 'select',
            label: 'Default frequency',
            defaultValue: 'weekly',
            options: [
              { label: 'Daily', value: 'daily' },
              { label: 'Weekly', value: 'weekly' },
              { label: 'Monthly', value: 'monthly' },
              { label: 'Yearly', value: 'yearly' },
            ],
          },
          {
            name: 'defaultPriority',
            type: 'number',
            label: 'Default priority',
            min: 0,
            max: 1,
            admin: {
              step: 0.1,
              description: 'Value between 0 and 1 (default: 0.5)',
            },
          },
          {
            name: 'priorityOverrides',
            type: 'array',
            label: 'Custom priorities',
            admin: {
              description: 'Set the priority for specific slug patterns',
            },
            fields: [
              { name: 'slugPattern', type: 'text', required: true, admin: { description: 'Pattern (e.g. home, blog/*, services/*)' } },
              { name: 'priority', type: 'number', required: true, min: 0, max: 1, admin: { step: 0.1 } },
              {
                name: 'changefreq',
                type: 'select',
                options: [
                  { label: 'Daily', value: 'daily' },
                  { label: 'Weekly', value: 'weekly' },
                  { label: 'Monthly', value: 'monthly' },
                  { label: 'Yearly', value: 'yearly' },
                ],
              },
            ],
          },
        ],
      },
      {
        name: 'robotsCustomRules',
        type: 'textarea',
        label: 'Custom robots.txt rules',
        admin: {
          description:
            'Additional rules to include in robots.txt (one per line). Example: Disallow: /private/',
        },
      },
      {
        name: 'breadcrumb',
        type: 'group',
        label: 'Breadcrumb configuration',
        fields: [
          {
            name: 'enabled',
            type: 'checkbox',
            label: 'Enable breadcrumbs',
            defaultValue: true,
          },
          {
            name: 'homeLabel',
            type: 'text',
            label: 'Home page label',
            // No default: empty means "Home" (see the /breadcrumb endpoint and buildJsonLd).
          },
          {
            name: 'separator',
            type: 'select',
            label: 'Separator',
            defaultValue: '>',
            options: [
              { label: '>', value: '>' },
              { label: '/', value: '/' },
              { label: '\u00BB', value: '\u00BB' },
              { label: '\u2192', value: '\u2192' },
            ],
          },
          {
            name: 'showOnHome',
            type: 'checkbox',
            label: 'Show on the home page',
            defaultValue: false,
          },
        ],
      },
    ],
  }
}
