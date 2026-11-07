import { stegaClean } from '@shipment/onpage-core'
import { CircleAlert } from 'lucide-react'
import React from 'react'

import type { EmbedBlock as EmbedBlockProps } from '@/payload-types'

import { cn } from '@/utilities/ui'

import { useDraftMode } from '../shared/draftMode'
import { toEmbed } from './providers'

const layouts: Record<string, { box: string; width: string }> = {
  video: { box: 'aspect-video', width: 'max-w-4xl' },
  square: { box: 'aspect-square', width: 'max-w-xl' },
  tall: { box: 'aspect-[3/4]', width: 'max-w-md' },
}

export const EmbedBlock: React.FC<EmbedBlockProps> = ({ caption, title, url, variant }) => {
  const draft = useDraftMode()
  const layout = layouts[stegaClean(variant) ?? 'video'] ?? layouts.video!
  // The url and title end up in attributes, so strip the on-page editor's invisible markers.
  const embed = url ? toEmbed(stegaClean(url)) : null
  const accessibleTitle = title ? stegaClean(title) : 'Embedded content'

  // Published pages always have a valid URL (it's validated on save). Without one, only
  // editors see a hint; visitors see nothing.
  if (!embed && !draft) return null

  return (
    <div className="container">
      <figure className={cn('mx-auto', layout.width)}>
        <div
          className={cn('relative w-full overflow-hidden rounded-xl border bg-muted', layout.box)}
        >
          {embed ? (
            <iframe
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              className="absolute inset-0 size-full border-0"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              src={embed.src}
              title={accessibleTitle}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
              <CircleAlert aria-hidden className="size-6" />
              <p className="text-sm font-medium">
                {url ? 'This embed URL isn’t supported.' : 'Add an embed URL.'}
              </p>
              <p className="max-w-xs text-xs">
                Use a public https link from YouTube, Vimeo, Loom, Spotify, Google Maps or Calendly.
              </p>
            </div>
          )}
        </div>
        {caption ? (
          <figcaption className="mt-3 text-center text-sm text-muted-foreground">
            {caption}
          </figcaption>
        ) : null}
      </figure>
    </div>
  )
}
