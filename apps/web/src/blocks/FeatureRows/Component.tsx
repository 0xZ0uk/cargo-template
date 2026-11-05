import React from 'react'

import type { FeatureRowsBlock as FeatureRowsBlockProps } from '@/payload-types'

import { BlockMedia } from '@/components/Media/BlockMedia'
import { CMSLink } from '@/components/Link'
import RichText from '@/components/RichText'
import { SectionHeading } from '@/components/SectionHeading'
import { cn } from '@/utilities/ui'

export const FeatureRowsBlock: React.FC<FeatureRowsBlockProps> = ({
  description,
  eyebrow,
  rows,
  title,
  variant,
}) => {
  const hasHeading = Boolean(eyebrow || title || description)
  const items = rows ?? []

  return (
    <div className="container">
      <SectionHeading description={description} eyebrow={eyebrow} title={title} />
      {items.length > 0 && (
        <div className={cn('flex flex-col gap-16 md:gap-24', hasHeading && 'mt-12 md:mt-16')}>
          {items.map((row, index) => {
            // Media is first in the DOM, so it stacks above the text on phones. From `md` up it
            // sits on the right when the variant (or the row's position) says so.
            const mediaOnRight =
              variant === 'imageRight' || (variant === 'alternating' && index % 2 === 1)
            const links = (row.links ?? []).filter(({ link }) => link)

            return (
              <div
                className="grid items-center gap-8 md:grid-cols-2 md:gap-12 lg:gap-20"
                key={row.id ?? index}
              >
                <BlockMedia
                  className={cn(
                    'aspect-[4/3] w-full rounded-xl border',
                    mediaOnRight && 'md:order-last',
                  )}
                  resource={row.media}
                />
                <div className="flex max-w-xl flex-col items-start gap-4">
                  {row.eyebrow && <p className="text-sm font-medium text-primary">{row.eyebrow}</p>}
                  {row.title && (
                    <h3 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
                      {row.title}
                    </h3>
                  )}
                  {row.richText && (
                    <RichText
                      className="mx-0 text-muted-foreground"
                      data={row.richText}
                      enableGutter={false}
                    />
                  )}
                  {links.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-3">
                      {links.map(({ id, link }, i) => (
                        <CMSLink key={id ?? i} size="lg" {...link} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
