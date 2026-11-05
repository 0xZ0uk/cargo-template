import React from 'react'

import type { GlobalSectionBlock as GlobalSectionBlockProps } from '@/payload-types'

import { RenderBlocks } from '../RenderBlocks'
import { useDraftMode } from '../shared/draftMode'

export const GlobalSectionBlock: React.FC<GlobalSectionBlockProps> = ({ reusableSection }) => {
  const draft = useDraftMode()

  // Not populated: none chosen yet (drafts only; the field is required), or the section was
  // deleted. Editors get a hint; visitors get nothing.
  if (!reusableSection || typeof reusableSection !== 'object') {
    if (!draft) return null
    return (
      <div className="container py-12">
        <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed bg-muted/30 px-6 text-center text-sm text-muted-foreground">
          Choose a reusable section
        </div>
      </div>
    )
  }

  return <RenderBlocks blocks={reusableSection.layout} />
}
