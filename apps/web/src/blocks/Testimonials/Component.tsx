import { stegaClean } from '@shipment/onpage-core'
import { QuoteIcon } from 'lucide-react'
import React from 'react'

import type { TestimonialsBlock as TestimonialsBlockProps } from '@/payload-types'

import { SectionHeading } from '@/components/SectionHeading'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { getMediaUrl } from '@/utilities/getMediaUrl'
import { cn } from '@/utilities/ui'

type Item = NonNullable<TestimonialsBlockProps['items']>[number]

/** First letters of the first and last word of a name ("Maya Lindqvist" → "ML"). */
const initials = (name: null | string | undefined) => {
  const words = stegaClean(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const letters = [words[0], words.length > 1 ? words.at(-1) : undefined]
  return letters
    .map((word) => (word ? Array.from(word)[0] : ''))
    .join('')
    .toLocaleUpperCase()
}

const Person: React.FC<{ item: Item; large?: boolean }> = ({ item, large }) => {
  const avatar = typeof item.avatar === 'object' ? item.avatar : null
  const src = avatar?.url ? getMediaUrl(avatar.url, avatar.updatedAt) : null

  return (
    <figcaption className={cn('flex items-center gap-3', large && 'flex-col gap-4 text-center')}>
      <Avatar className={cn('size-10', large && 'size-16')}>
        {src && <AvatarImage alt="" src={src} />}
        <AvatarFallback className={cn('font-medium', large && 'text-lg')}>
          {initials(item.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className={cn('font-medium text-foreground', large && 'text-base')}>{item.name}</div>
        {item.role && <div className="text-sm text-muted-foreground">{item.role}</div>}
      </div>
    </figcaption>
  )
}

const TestimonialCard: React.FC<{ item: Item }> = ({ item }) => (
  <Card className="h-full break-inside-avoid py-6 [--card-spacing:--spacing(6)]">
    <CardContent className="flex h-full flex-col gap-6">
      <figure className="flex h-full flex-col gap-6">
        <QuoteIcon aria-hidden="true" className="size-6 text-primary/40" />
        <blockquote className="flex-1 text-base/relaxed text-pretty whitespace-pre-line text-foreground">
          {item.quote}
        </blockquote>
        <Person item={item} />
      </figure>
    </CardContent>
  </Card>
)

export const TestimonialsBlock: React.FC<TestimonialsBlockProps> = ({
  description,
  eyebrow,
  items,
  title,
  variant,
}) => {
  const list = items ?? []
  const hasHeading = Boolean(eyebrow || title || description)

  if (variant === 'spotlight') {
    const item = list[0]
    return (
      <div className="container">
        <SectionHeading description={description} eyebrow={eyebrow} title={title} />
        {item && (
          <figure
            className={cn(
              'mx-auto flex max-w-3xl flex-col items-center gap-8 text-center',
              hasHeading && 'mt-12 md:mt-16',
            )}
          >
            <QuoteIcon aria-hidden="true" className="size-10 text-primary/40" />
            <blockquote className="text-2xl/snug font-medium tracking-tight text-balance whitespace-pre-line md:text-3xl/snug">
              {item.quote}
            </blockquote>
            <Person item={item} large />
          </figure>
        )}
      </div>
    )
  }

  return (
    <div className="container">
      <SectionHeading description={description} eyebrow={eyebrow} title={title} />
      {list.length > 0 && (
        <ul
          className={cn(
            hasHeading && 'mt-12 md:mt-16',
            variant === 'masonry'
              ? 'columns-1 gap-6 space-y-6 md:columns-2 lg:columns-3'
              : 'grid gap-6 md:grid-cols-2 lg:grid-cols-3',
          )}
        >
          {list.map((item, index) => (
            <li
              className={cn(variant === 'masonry' && 'break-inside-avoid')}
              key={item.id ?? index}
            >
              <TestimonialCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
