import type { CollectionConfig } from 'payload'

import {
  MetaDescriptionField,
  MetaImageField,
  MetaTitleField,
  OverviewField,
  PreviewField,
} from '@payloadcms/plugin-seo/fields'

import { authenticated } from '@/access/authenticated'
import { authenticatedOrPublished } from '@/access/authenticatedOrPublished'
import { pageBlockSlugs } from '@/blocks'
import { populatePublishedAt } from '@/hooks/populatePublishedAt'
import { pagePath } from '@/utilities/pagePath'

const SPIKE_READ_ONLY_EMAIL = 'readonly@spike.test'

// Drafts render on the frontend only for logged-in users who add `?draft=true`.
const previewPath = (slug: unknown) =>
  typeof slug === 'string' && slug ? `${pagePath(slug)}?draft=true` : null

export const Pages: CollectionConfig = {
  slug: 'pages',
  access: {
    // SPIKE (#59): Users has no role field, so the access-filtering check restricts one
    // test user by email: it may read pages but not create, update or delete them.
    create: ({ req }) => authenticated({ req } as never) && req.user?.email !== SPIKE_READ_ONLY_EMAIL,
    delete: ({ req }) => authenticated({ req } as never) && req.user?.email !== SPIKE_READ_ONLY_EMAIL,
    read: authenticatedOrPublished,
    update: ({ req }) => authenticated({ req } as never) && req.user?.email !== SPIKE_READ_ONLY_EMAIL,
  },
  // What's populated by default when a page is referenced (links, relationships).
  // https://payloadcms.com/docs/queries/select#defaultpopulate-collection-config-property
  defaultPopulate: {
    title: true,
    slug: true,
  },
  admin: {
    defaultColumns: ['title', 'slug', 'updatedAt'],
    livePreview: {
      url: ({ data }) => previewPath(data?.slug),
    },
    preview: (data) => previewPath(data?.slug),
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      type: 'tabs',
      tabs: [
        {
          fields: [
            {
              name: 'layout',
              type: 'blocks',
              // Registered once in `payload.config.ts` (`blocks`), listed here by slug.
              blocks: pageBlockSlugs,
              required: true,
              admin: {
                initCollapsed: true,
              },
            },
          ],
          label: 'Content',
        },
        {
          name: 'meta',
          label: 'SEO',
          fields: [
            OverviewField({
              titlePath: 'meta.title',
              descriptionPath: 'meta.description',
              imagePath: 'meta.image',
            }),
            MetaTitleField({
              hasGenerateFn: true,
            }),
            MetaImageField({
              relationTo: 'media',
            }),
            MetaDescriptionField({}),
            PreviewField({
              // if the `generateUrl` function is configured
              hasGenerateFn: true,

              // field paths to match the target field for data
              titlePath: 'meta.title',
              descriptionPath: 'meta.description',
            }),
          ],
        },
      ],
    },
    {
      name: 'publishedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'slug',
      type: 'slug',
      useAsSlug: 'title',
    },
  ],
  hooks: {
    beforeChange: [populatePublishedAt],
  },
  versions: {
    drafts: {
      // Autosave keeps live preview in sync. It updates a single autosave version in place
      // rather than adding one per save, so it doesn't grow D1.
      autosave: {
        interval: 375,
      },
    },
  },
}
