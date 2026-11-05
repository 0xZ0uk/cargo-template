import { stegaClean } from '@cargo/onpage-core'
import React from 'react'

import type { ReviewsBlock as ReviewsBlockProps } from '@/payload-types'

import { SectionHeading } from '@/components/SectionHeading'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/utilities/ui'

import { Stars } from './Stars'

type Review = NonNullable<ReviewsBlockProps['items']>[number]

type SummaryProps = Pick<ReviewsBlockProps, 'average' | 'count' | 'source'>

const hasSummary = ({ average, count, source }: SummaryProps) =>
  typeof average === 'number' || Boolean(count) || Boolean(source)

/** "from 1,200 reviews on Google", each CMS string in its own element. */
const SummaryCaption: React.FC<SummaryProps & { className?: string }> = ({
  className,
  count,
  source,
}) => {
  if (!count && !source) return null

  return (
    <p className={cn('text-sm text-muted-foreground', className)}>
      {count ? (
        <>
          from <span className="font-medium text-foreground">{count}</span> reviews
        </>
      ) : (
        'Reviews'
      )}
      {source && (
        <>
          {' on '}
          <span className="font-medium text-foreground">{source}</span>
        </>
      )}
    </p>
  )
}

/** Big average, stars and caption: the stacked summary used by the grid and list variants. */
const Summary: React.FC<SummaryProps & { align: 'center' | 'start' }> = ({ align, ...props }) => {
  if (!hasSummary(props)) return null
  const { average } = props

  return (
    <div
      className={cn(
        'flex flex-col gap-2',
        align === 'center' ? 'items-center text-center' : 'items-start',
      )}
    >
      {typeof average === 'number' && (
        <div className="flex items-end gap-2">
          <span className="text-6xl leading-none font-semibold tracking-tight tabular-nums md:text-7xl">
            {average}
          </span>
          <span className="pb-1 text-lg text-muted-foreground md:pb-2">/ 5</span>
        </div>
      )}
      {typeof average === 'number' && <Stars className="size-6" value={average} />}
      <SummaryCaption {...props} />
    </div>
  )
}

/** Compact pill for the summary-only variant. */
const SummaryBadge: React.FC<SummaryProps> = (props) => {
  if (!hasSummary(props)) return null
  const { average } = props

  return (
    <div className="flex justify-center">
      <div className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-full border bg-card px-5 py-3 text-card-foreground shadow-xs">
        <div className="flex items-center gap-2">
          {typeof average === 'number' && (
            <>
              <Stars value={average} />
              <span className="text-lg font-semibold tabular-nums">{average}</span>
            </>
          )}
        </div>
        <SummaryCaption {...props} />
      </div>
    </div>
  )
}

const Initial: React.FC<{ name?: null | string }> = ({ name }) => {
  const initial = stegaClean(name ?? '')
    .trim()
    .charAt(0)
    .toUpperCase()

  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground"
    >
      {initial}
    </span>
  )
}

const ReviewBody: React.FC<{ review: Review }> = ({ review }) => {
  const { author, body, date, rating, title } = review

  return (
    <figure className="flex h-full flex-col gap-4">
      <Stars value={Number(stegaClean(rating))} />
      <blockquote className="flex flex-1 flex-col gap-2">
        {title && <p className="font-medium text-balance text-card-foreground">{title}</p>}
        <p className="whitespace-pre-line text-muted-foreground">{body}</p>
      </blockquote>
      <figcaption className="flex items-center gap-3">
        <Initial name={author} />
        <span className="flex min-w-0 flex-col text-sm">
          <span className="truncate font-medium">{author}</span>
          {date && <span className="truncate text-muted-foreground">{date}</span>}
        </span>
      </figcaption>
    </figure>
  )
}

const ReviewCard: React.FC<{ review: Review }> = ({ review }) => (
  <Card className="h-full py-6 [--card-spacing:--spacing(6)]">
    <CardContent className="h-full">
      <ReviewBody review={review} />
    </CardContent>
  </Card>
)

export const ReviewsBlock: React.FC<ReviewsBlockProps> = ({
  average,
  count,
  description,
  eyebrow,
  items,
  source,
  title,
  variant,
}) => {
  const reviews = items ?? []
  const summary = { average, count, source }
  const hasHeading = Boolean(eyebrow || title || description)

  if (!hasHeading && !hasSummary(summary) && reviews.length === 0) return null

  if (variant === 'summary') {
    return (
      <div className="container flex flex-col gap-8">
        <SectionHeading description={description} eyebrow={eyebrow} title={title} />
        <SummaryBadge {...summary} />
      </div>
    )
  }

  if (variant === 'list') {
    return (
      <div className="container grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16">
        <div className="flex flex-col gap-8 lg:sticky lg:top-24 lg:self-start">
          <SectionHeading align="start" description={description} eyebrow={eyebrow} title={title} />
          <Summary align="start" {...summary} />
        </div>
        {reviews.length > 0 && (
          <ul className="flex flex-col divide-y rounded-xl border bg-card text-card-foreground">
            {reviews.map((review, index) => (
              <li className="p-6 md:p-8" key={review.id ?? index}>
                <ReviewBody review={review} />
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="container flex flex-col gap-10 md:gap-12">
      <SectionHeading description={description} eyebrow={eyebrow} title={title} />
      <Summary align="center" {...summary} />
      {reviews.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {reviews.map((review, index) => (
            <li key={review.id ?? index}>
              <ReviewCard review={review} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
