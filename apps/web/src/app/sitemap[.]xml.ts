import { createFileRoute } from '@tanstack/react-router'

import { servePluginFile } from '@/utilities/servePluginFile'

// The SEO analyzer plugin serves this at `/api/seo-plugin/sitemap.xml`; crawlers expect it at the root.
export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: ({ request }) => servePluginFile(request, 'sitemap.xml'),
    },
  },
})
