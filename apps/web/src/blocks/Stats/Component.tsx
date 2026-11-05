import React from 'react'

import type { StatsBlock as StatsBlockProps } from '@/payload-types'

import { SectionHeading } from '@/components/SectionHeading'
import { Card } from '@/components/ui/card'
import { cn } from '@/utilities/ui'

type Item = NonNullable<StatsBlockProps['items']>[number]

const valueClass = 'text-4xl font-semibold tracking-tighter tabular-nums md:text-5xl'

/**
 * One stat: `<dt>` label and `<dd>` value, in that source order (a term before its
 * definition), with the value shown first.
 */
const Stat: React.FC<{ className?: string; item: Item }> = ({ className, item }) => (
  <div className={cn('flex flex-col-reverse gap-2', className)}>
    <dt className="text-sm font-medium text-muted-foreground">{item.label}</dt>
    <dd className={valueClass}>{item.value}</dd>
  </div>
)

export const StatsBlock: React.FC<StatsBlockProps> = ({
  description,
  eyebrow,
  items,
  title,
  variant,
}) => {
  const stats = items ?? []
  const hasHeading = Boolean(eyebrow || title || description)

  if (variant === 'split') {
    return (
      <div className="container">
        <div
          className={cn(
            'grid gap-12 lg:items-center lg:gap-16',
            hasHeading && stats.length > 0 && 'lg:grid-cols-2',
          )}
        >
          <SectionHeading align="start" description={description} eyebrow={eyebrow} title={title} />
          {stats.length > 0 && (
            <dl className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2">
              {stats.map((item, index) => (
                <Stat className="border-t pt-6" item={item} key={item.id ?? index} />
              ))}
            </dl>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="container flex flex-col gap-12 md:gap-16">
      <SectionHeading description={description} eyebrow={eyebrow} title={title} />
      {stats.length > 0 &&
        (variant === 'cards' ? (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((item, index) => (
              // The card is the <dl> group itself: label, value (shown first) and description.
              <Card className="gap-2 [--card-spacing:--spacing(6)]" key={item.id ?? index}>
                <dt className="px-(--card-spacing) text-sm font-medium text-muted-foreground">
                  {item.label}
                </dt>
                <dd className={cn('order-first px-(--card-spacing)', valueClass)}>{item.value}</dd>
                {item.description && (
                  <dd className="px-(--card-spacing) pt-1 text-sm text-pretty whitespace-pre-line text-muted-foreground">
                    {item.description}
                  </dd>
                )}
              </Card>
            ))}
          </dl>
        ) : (
          <dl className="grid grid-cols-2 gap-y-10 text-center lg:grid-cols-4 lg:gap-y-10">
            {stats.map((item, index) => (
              <Stat
                className={cn(
                  'items-center px-4 lg:px-8',
                  // Subtle dividers between columns: before every item that isn't first in its line.
                  index % 2 === 1 && 'border-l',
                  index % 4 !== 0 ? 'lg:border-l' : 'lg:border-l-0',
                )}
                item={item}
                key={item.id ?? index}
              />
            ))}
          </dl>
        ))}
    </div>
  )
}
