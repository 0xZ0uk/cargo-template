import React from 'react'

import type { LoadPageResult } from '@/app/_frontend/pages.functions'

import { RenderBlocks } from '@/blocks/RenderBlocks'
import { DraftModeProvider } from '@/blocks/shared/draftMode'
import { AbConversionTracker } from '@/components/AbConversionTracker'
import { LivePreviewListener } from '@/components/LivePreviewListener'

export const PageTemplate: React.FC<{
  /** A draft read (live preview, on-page editing, a preview link): blocks may show hints. */
  draft: boolean
  /** The A/B experiment this view belongs to (`loadPage`): CTA clicks then count as conversions. */
  experiment?: string | null
  /** The admin's live preview: reload the route's data when the document is saved there. */
  livePreview: boolean
  page: NonNullable<LoadPageResult['page']>
}> = ({ draft, experiment, livePreview, page }) => {
  const { layout } = page

  return (
    <article data-test="payload-ui-barrel-sentinel">
      {/* Not for on-page editing (it refreshes on its own) or preview links: the listener reloads
          the route once on mount. */}
      {livePreview && <LivePreviewListener />}
      {experiment && !draft && <AbConversionTracker experiment={experiment} />}

      <DraftModeProvider draft={draft}>
        <RenderBlocks blocks={layout} />
      </DraftModeProvider>
    </article>
  )
}
