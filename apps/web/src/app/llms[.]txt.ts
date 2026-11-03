import { createFileRoute } from '@tanstack/react-router'

import { servePluginFile } from '@/utilities/servePluginFile'

// The SEO analyzer plugin serves this at `/api/seo-plugin/llms.txt`; crawlers expect it at the root.
export const Route = createFileRoute('/llms.txt')({
  server: {
    handlers: {
      GET: ({ request }) => servePluginFile(request, 'llms.txt'),
    },
  },
})
