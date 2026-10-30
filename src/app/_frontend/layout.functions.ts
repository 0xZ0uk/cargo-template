import { createServerFn } from '@tanstack/react-start'

import type { Footer, Header } from '@/payload-types'

export type LoadLayoutResult = {
  footer: Footer
  header: Header
}

// Nav links are typed as full `Page`s, whose Lexical fields defeat TanStack's serializability
// check (see `loadPage`). At runtime they only carry `defaultPopulate` (title and slug).
export const loadLayout = createServerFn({ method: 'GET', strict: { output: false } }).handler(
  async (): Promise<LoadLayoutResult> => {
    const { getPayload } = await import('payload')

    const payload = await getPayload({ config: (await import('@payload-config')).default })

    // Depth 1 populates the pages that nav links point to.
    const [header, footer] = await Promise.all([
      payload.findGlobal({ slug: 'header', depth: 1, overrideAccess: false }),
      payload.findGlobal({ slug: 'footer', depth: 1, overrideAccess: false }),
    ])

    return { footer, header }
  },
)
