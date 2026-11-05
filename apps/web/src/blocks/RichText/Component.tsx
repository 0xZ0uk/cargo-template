import React from 'react'

import type { RichTextBlock as RichTextBlockProps } from '@/payload-types'

import RichText from '@/components/RichText'
import { cn } from '@/utilities/ui'

export const RichTextBlock: React.FC<RichTextBlockProps> = ({ richText, variant }) => {
  return (
    <div className="container">
      <RichText
        className={cn('mx-0', variant === 'wide' ? 'max-w-none' : 'mx-auto max-w-prose')}
        data={richText}
        enableGutter={false}
      />
    </div>
  )
}
