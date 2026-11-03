import { createFileRoute } from '@tanstack/react-router'

import { servePluginFile } from '@/utilities/servePluginFile'

// The SEO analyzer plugin serves this at `/api/seo-plugin/robots.txt`; crawlers expect it at the root.
export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: ({ request }) => servePluginFile(request, 'robots.txt'),
    },
  },
})
