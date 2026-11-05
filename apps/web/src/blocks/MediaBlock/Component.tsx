import React from 'react'

import type { MediaSectionBlock } from '@/payload-types'

import { Media } from '@/components/Media'
import { BlockMedia } from '@/components/Media/BlockMedia'
import { cn } from '@/utilities/ui'

// Images keep their natural aspect ratio (the `<img>` carries width/height); videos fill the
// width. Nothing is cropped, so no fixed aspect box.
const naturalMedia = 'block h-auto w-full'

export const MediaBlock: React.FC<MediaSectionBlock> = ({ caption, media, variant }) => {
  const hasMedia = Boolean(media && typeof media === 'object')
  const isFull = variant === 'full'
  const rounded = isFull ? undefined : 'overflow-hidden rounded-xl'

  const visual = hasMedia ? (
    <Media
      className={rounded}
      imgClassName={naturalMedia}
      resource={media}
      videoClassName={naturalMedia}
    />
  ) : (
    <BlockMedia className={cn('aspect-video w-full', rounded)} />
  )

  const figcaption = caption ? (
    <figcaption className="text-muted-foreground mt-3 text-center text-sm text-pretty">
      {caption}
    </figcaption>
  ) : null

  if (isFull) {
    return (
      <figure>
        {visual}
        {figcaption ? <div className="container">{figcaption}</div> : null}
      </figure>
    )
  }

  return (
    <div className="container">
      <figure className={cn(variant === 'narrow' && 'mx-auto max-w-3xl')}>
        {visual}
        {figcaption}
      </figure>
    </div>
  )
}
