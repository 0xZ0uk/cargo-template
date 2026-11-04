// A Payload-shaped config: rows/tabs/collapsibles, a blocks field, uploads.
export const payloadFields: any[] = [
  { name: 'title', type: 'text', localized: true, required: true },
  { type: 'ui', name: 'button', admin: { components: { Field: 'x' } } },
  {
    type: 'tabs',
    tabs: [
      {
        label: 'Content',
        fields: [
          {
            name: 'sections',
            type: 'blocks',
            blocks: [
              {
                slug: 'hero',
                labels: { singular: 'Hero', plural: 'Heroes' },
                fields: [
                  {
                    type: 'row',
                    fields: [{ name: 'heading', type: 'text', required: true, localized: true }],
                  },
                  { name: 'image', type: 'upload', relationTo: 'media' },
                  {
                    name: 'section',
                    type: 'group',
                    fields: [
                      {
                        name: 'background',
                        type: 'select',
                        defaultValue: 'white',
                        options: [{ label: 'White', value: 'white' }, 'light'],
                      },
                    ],
                  },
                  {
                    name: 'ctas',
                    type: 'array',
                    maxRows: 2,
                    fields: [{ name: 'label', type: 'text', required: true }],
                  },
                ],
              },
              {
                slug: 'gallery',
                fields: [
                  {
                    name: 'images',
                    type: 'array',
                    minRows: 1,
                    fields: [{ name: 'image', type: 'upload', relationTo: 'media' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        name: 'meta',
        label: 'SEO',
        fields: [{ name: 'description', type: 'textarea', defaultValue: () => 'nope' }],
      },
    ],
  },
]
