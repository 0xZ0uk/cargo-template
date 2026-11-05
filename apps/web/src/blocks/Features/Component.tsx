import React from 'react'

import type { FeaturesBlock as FeaturesBlockProps } from '@/payload-types'

import { Icon } from '@/components/Icon'
import { SectionHeading } from '@/components/SectionHeading'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/utilities/ui'

type Item = NonNullable<FeaturesBlockProps['items']>[number]

const IconTile: React.FC<{ className?: string; name?: string | null }> = ({ className, name }) =>
  name ? (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary',
        className,
      )}
    >
      <Icon className="size-5" name={name} />
    </div>
  ) : null

const ItemText: React.FC<{ item: Item; titleClassName?: string }> = ({ item, titleClassName }) => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <h3 className={cn('text-base leading-snug font-semibold', titleClassName)}>{item.title}</h3>
    {item.description && (
      <p className="text-sm whitespace-pre-line text-muted-foreground">{item.description}</p>
    )}
  </div>
)

export const FeaturesBlock: React.FC<FeaturesBlockProps> = ({
  description,
  eyebrow,
  items,
  title,
  variant,
}) => {
  const rows = items ?? []

  return (
    <div className="container flex flex-col gap-12 md:gap-16">
      <SectionHeading description={description} eyebrow={eyebrow} title={title} />
      {rows.length > 0 && variant === 'list' ? (
        <ul className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
          {rows.map((item, i) => (
            <li className="flex items-start gap-4" key={item.id ?? i}>
              <IconTile className="size-9" name={item.icon} />
              <ItemText item={item} />
            </li>
          ))}
        </ul>
      ) : rows.length > 0 && variant === 'cards' ? (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((item, i) => (
            <li className="flex" key={item.id ?? i}>
              <Card className="w-full [--card-spacing:--spacing(6)]">
                <CardContent className="flex flex-col gap-4">
                  <IconTile className="size-10" name={item.icon} />
                  <ItemText item={item} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : rows.length > 0 ? (
        <ul className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((item, i) => (
            <li className="flex flex-col gap-4" key={item.id ?? i}>
              <IconTile className="size-10" name={item.icon} />
              <ItemText item={item} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
