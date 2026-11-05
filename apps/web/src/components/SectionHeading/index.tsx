import React from 'react'

import { cn } from '@/utilities/ui'

/**
 * A section's eyebrow, title and description (`headingFields()`). Renders nothing when all
 * three are empty. Each string is in its own element, so the on-page editor maps each to its
 * field.
 */
export const SectionHeading: React.FC<{
  align?: 'center' | 'start'
  /** `h1` only for the page's hero; every other section is `h2`. */
  as?: 'h1' | 'h2'
  className?: string
  description?: string | null
  eyebrow?: string | null
  title?: string | null
}> = ({ align = 'center', as: Heading = 'h2', className, description, eyebrow, title }) => {
  if (!eyebrow && !title && !description) return null

  return (
    <div
      className={cn(
        'flex max-w-2xl flex-col gap-3',
        align === 'center' && 'mx-auto items-center text-center',
        className,
      )}
    >
      {eyebrow && <p className="text-sm font-medium text-primary">{eyebrow}</p>}
      {title && (
        <Heading
          className={cn(
            'font-semibold tracking-tight text-balance',
            Heading === 'h1' ? 'text-4xl md:text-6xl' : 'text-3xl md:text-4xl',
          )}
        >
          {title}
        </Heading>
      )}
      {description && (
        <p className="text-lg text-pretty whitespace-pre-line text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  )
}
