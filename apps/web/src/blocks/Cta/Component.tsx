import React from 'react'

import type { CtaBlock as CtaBlockProps } from '@/payload-types'

import { CMSLink } from '@/components/Link'
import { SectionHeading } from '@/components/SectionHeading'
import { cn } from '@/utilities/ui'

type Links = NonNullable<CtaBlockProps['links']>

/**
 * The block's buttons. On the banner's `bg-primary` panel the default and outline buttons
 * would blend in, so there the primary action is `secondary` and the outline one is a
 * transparent outline in the panel's own foreground colour; both read in light and dark.
 */
const Buttons: React.FC<{ links?: Links | null; onPrimary?: boolean; className?: string }> = ({
  className,
  links,
  onPrimary = false,
}) => {
  const items = links?.filter(({ link }) => link) ?? []
  if (!items.length) return null

  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:flex-wrap', className)}>
      {items.map(({ id, link }, index) => {
        const outline = link.appearance === 'outline'

        return (
          <CMSLink
            key={id ?? index}
            {...link}
            appearance={onPrimary && !outline ? 'secondary' : (link.appearance ?? 'default')}
            className={cn(
              'h-11 px-6 text-base sm:w-auto',
              onPrimary &&
                outline &&
                'border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground dark:border-primary-foreground/40 dark:bg-transparent dark:hover:bg-primary-foreground/10',
            )}
            size="lg"
          />
        )
      })}
    </div>
  )
}

export const CtaBlock: React.FC<CtaBlockProps> = ({
  description,
  eyebrow,
  links,
  title,
  variant,
}) => {
  const heading = { description, eyebrow, title }

  if (variant === 'split') {
    return (
      <div className="container">
        <div className="flex flex-col gap-8 rounded-2xl border bg-card p-8 text-card-foreground shadow-xs md:p-12 lg:flex-row lg:items-center lg:justify-between lg:gap-16">
          <SectionHeading {...heading} align="start" className="max-w-xl" />
          <Buttons className="lg:shrink-0" links={links} />
        </div>
      </div>
    )
  }

  if (variant === 'centered') {
    return (
      <div className="container">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
          <SectionHeading {...heading} className="max-w-3xl [&_h2]:text-4xl md:[&_h2]:text-5xl" />
          <Buttons className="justify-center" links={links} />
        </div>
      </div>
    )
  }

  // banner (default)
  return (
    <div className="container">
      <div className="relative isolate overflow-hidden rounded-3xl bg-primary px-6 py-12 text-primary-foreground sm:px-12 md:py-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-linear-to-br from-primary-foreground/10 via-transparent to-transparent"
        />
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
          <SectionHeading {...heading} className="max-w-3xl [&_p]:text-primary-foreground/80" />
          <Buttons className="justify-center" links={links} onPrimary />
        </div>
      </div>
    </div>
  )
}
