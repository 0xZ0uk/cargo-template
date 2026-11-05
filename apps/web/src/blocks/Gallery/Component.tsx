import React from 'react'

import type { GalleryBlock as GalleryBlockProps } from '@/payload-types'

import { Media } from '@/components/Media'
import { BlockMedia } from '@/components/Media/BlockMedia'
import { SectionHeading } from '@/components/SectionHeading'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel'
import { cn } from '@/utilities/ui'

type Item = NonNullable<GalleryBlockProps['items']>[number]

type TileProps = {
  item: Item
  /** Box for the image or placeholder. */
  mediaClassName?: string
  /** Natural aspect ratio (masonry): the image sets its own height. */
  natural?: boolean
}

const Caption: React.FC<{ children?: string | null }> = ({ children }) =>
  children ? <figcaption className="text-sm text-muted-foreground">{children}</figcaption> : null

const Tile: React.FC<TileProps> = ({ item, mediaClassName, natural }) => {
  const hasMedia = item.media && typeof item.media === 'object'

  return (
    <figure className="flex flex-col gap-2.5">
      {natural && hasMedia ? (
        <Media
          className="overflow-hidden rounded-lg bg-muted"
          imgClassName="h-auto w-full"
          resource={item.media}
          videoClassName="h-auto w-full"
        />
      ) : (
        <BlockMedia className={cn('rounded-lg', mediaClassName)} resource={item.media} />
      )}
      <Caption>{item.caption}</Caption>
    </figure>
  )
}

export const GalleryBlock: React.FC<GalleryBlockProps> = ({
  description,
  eyebrow,
  items,
  title,
  variant,
}) => {
  const tiles = items ?? []
  const hasHeading = Boolean(eyebrow || title || description)

  return (
    <div className="container">
      <SectionHeading description={description} eyebrow={eyebrow} title={title} />

      {tiles.length > 0 && (
        <div className={cn(hasHeading && 'mt-12')}>
          {variant === 'masonry' ? (
            <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
              {tiles.map((item, index) => (
                <Tile key={item.id ?? index} item={item} mediaClassName="aspect-[4/3]" natural />
              ))}
            </div>
          ) : variant === 'carousel' ? (
            <Carousel opts={{ align: 'start' }}>
              <CarouselContent>
                {tiles.map((item, index) => (
                  <CarouselItem
                    key={item.id ?? index}
                    className="basis-4/5 sm:basis-1/2 lg:basis-1/3"
                  >
                    <Tile item={item} mediaClassName="aspect-square" />
                  </CarouselItem>
                ))}
              </CarouselContent>
              {tiles.length > 1 && (
                <div className="mt-6 flex justify-end gap-2">
                  <CarouselPrevious className="static inset-auto my-0" />
                  <CarouselNext className="static inset-auto my-0" />
                </div>
              )}
            </Carousel>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {tiles.map((item, index) => (
                <Tile key={item.id ?? index} item={item} mediaClassName="aspect-square" />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
