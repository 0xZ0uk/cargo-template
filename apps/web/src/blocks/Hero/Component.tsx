import React from 'react'

import type { HeroBlock as HeroBlockProps } from '@/payload-types'

import { CMSLink } from '@/components/Link'
import { BlockMedia } from '@/components/Media/BlockMedia'
import { SectionHeading } from '@/components/SectionHeading'
import { cn } from '@/utilities/ui'

type Links = NonNullable<HeroBlockProps['links']>

/** A row of buttons; renders nothing without links. */
const HeroLinks: React.FC<{ className?: string; links?: Links | null }> = ({
  className,
  links,
}) => {
  if (!links?.length) return null

  return (
    <div className={cn('flex flex-wrap gap-3', className)}>
      {links.map(({ id, link }, index) => (
        <CMSLink
          key={id ?? index}
          {...link}
          appearance={link.appearance ?? 'default'}
          className="h-11 rounded-xl px-5 text-base"
          size="lg"
        />
      ))}
    </div>
  )
}

export const HeroBlock: React.FC<HeroBlockProps> = ({
  description,
  eyebrow,
  links,
  media,
  title,
  variant,
}) => {
  const heading = { description, eyebrow, title }

  if (variant === 'split') {
    return (
      <div className="container">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col items-start gap-8">
            <SectionHeading {...heading} align="start" as="h1" className="max-w-xl" />
            <HeroLinks links={links} />
          </div>
          <BlockMedia
            className="aspect-4/3 w-full rounded-2xl border bg-muted shadow-sm"
            priority
            resource={media}
          />
        </div>
      </div>
    )
  }

  if (variant === 'image') {
    const hasMedia = Boolean(media && typeof media === 'object')

    return (
      <div className="container">
        <div
          className="relative isolate flex min-h-[30rem] items-center overflow-hidden rounded-3xl bg-background text-foreground md:min-h-[70vh]"
          data-theme="dark"
        >
          {hasMedia ? (
            <>
              <BlockMedia className="absolute inset-0 -z-20" priority resource={media} />
              <div
                aria-hidden="true"
                className="absolute inset-0 -z-10 bg-linear-to-t from-background/90 via-background/60 to-background/30 md:bg-linear-to-r md:from-background/90 md:via-background/60 md:to-transparent"
              />
            </>
          ) : (
            <div
              aria-hidden="true"
              className="absolute inset-0 -z-10 bg-linear-to-br from-muted via-background to-muted"
            />
          )}
          <div className="flex w-full flex-col items-start gap-8 p-6 py-12 sm:p-10 md:p-16">
            <SectionHeading {...heading} align="start" as="h1" className="max-w-2xl" />
            <HeroLinks links={links} />
          </div>
        </div>
      </div>
    )
  }

  // Centered (default).
  return (
    <div className="container">
      <div className="flex flex-col items-center gap-8 text-center">
        <SectionHeading {...heading} as="h1" className="max-w-3xl" />
        <HeroLinks className="justify-center" links={links} />
      </div>
      {media && typeof media === 'object' && (
        <BlockMedia
          className="mx-auto mt-12 aspect-video w-full max-w-5xl rounded-2xl border shadow-sm md:mt-16"
          priority
          resource={media}
        />
      )}
    </div>
  )
}
