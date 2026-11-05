import React, { Fragment } from 'react'

import { Section } from '@/components/Section'

import { blockComponents, type LayoutBlock } from './components'

/** Renders a layout: each block inside its `Section` (background, spacing, anchor). */
export const RenderBlocks: React.FC<{ blocks?: LayoutBlock[] | null }> = ({ blocks }) => {
  if (!blocks?.length) return null

  return (
    <Fragment>
      {blocks.map((block, index) => {
        const Block = blockComponents[block.blockType] as
          | React.ComponentType<LayoutBlock>
          | undefined
        if (!Block) return null

        const key = block.id ?? index
        const content = <Block {...block} />

        // Blocks without section settings (a reusable section's wrapper) render their own.
        return 'section' in block ? (
          <Section blockType={block.blockType} key={key} settings={block.section}>
            {content}
          </Section>
        ) : (
          <Fragment key={key}>{content}</Fragment>
        )
      })}
    </Fragment>
  )
}
