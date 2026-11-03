import React from 'react'

import type { LoadPageResult } from '@/app/_frontend/pages.functions'

import { RenderBlocks } from '@/blocks/RenderBlocks'
import { LivePreviewListener } from '@/components/LivePreviewListener'
import { RenderHero } from '@/heros/RenderHero'

export const PageTemplate: React.FC<{
  draft: boolean
  page: NonNullable<LoadPageResult['page']>
}> = ({ draft, page }) => {
  const { hero, layout } = page

  return (
    <article className="pt-16 pb-24" data-test="payload-ui-barrel-sentinel">
      {draft && <LivePreviewListener />}

      <RenderHero {...hero} />
      <RenderBlocks blocks={layout} />
    </article>
  )
}
