import { Star } from 'lucide-react'
import React from 'react'

import { cn } from '@/utilities/ui'

const STARS = [0, 1, 2, 3, 4]

const clamp = (value: number) => Math.min(5, Math.max(0, value))

/** Formats a rating for the label: 5 → "5", 4.8 → "4.8". */
const formatRating = (value: number) => String(Math.round(value * 10) / 10)

const row = (className: string, filled: boolean) =>
  STARS.map((index) => (
    <Star
      aria-hidden="true"
      className={cn('shrink-0', className, filled ? 'fill-current' : 'fill-current opacity-20')}
      key={index}
    />
  ))

/**
 * A row of five stars filled up to `value`, with partial fill for fractions (4.8 fills the fifth
 * star to 80%): a muted row underneath and a primary row clipped to the rating on top.
 */
export const Stars: React.FC<{ className?: string; value: number }> = ({ className, value }) => {
  const rating = clamp(value)
  // Every star is the same width and there's no gap, so the clip width maps straight onto the
  // rating.
  const starSize = cn('size-5', className)

  return (
    <span
      aria-label={`${formatRating(rating)} out of 5 stars`}
      className="relative inline-flex text-primary"
      role="img"
    >
      <span className="inline-flex">{row(starSize, false)}</span>
      <span
        className="absolute inset-y-0 left-0 inline-flex overflow-hidden"
        style={{ width: `${(rating / 5) * 100}%` }}
      >
        {row(starSize, true)}
      </span>
    </span>
  )
}
