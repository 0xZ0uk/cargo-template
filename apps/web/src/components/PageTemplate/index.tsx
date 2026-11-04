import React from 'react'

import type { LoadPageResult } from '@/app/_frontend/pages.functions'

import { RenderBlocks } from '@/blocks/RenderBlocks'
import { LivePreviewListener } from '@/components/LivePreviewListener'
import { RenderHero } from '@/heros/RenderHero'

export const PageTemplate: React.FC<{
  /** The admin's live preview: reload the route's data when the document is saved there. */
  livePreview: boolean
  page: NonNullable<LoadPageResult['page']>
}> = ({ livePreview, page }) => {
  const { hero, layout } = page

  return (
    <article className="pt-16 pb-24" data-test="payload-ui-barrel-sentinel">
      {/* Not for on-page editing (it refreshes on its own) or preview links: the listener reloads
          the route once on mount. */}
      {livePreview && <LivePreviewListener />}

      <RenderHero {...hero} />
      <RenderBlocks blocks={layout} />
    </article>
  )
}
