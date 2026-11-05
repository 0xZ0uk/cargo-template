import React from 'react'

import type { StepsBlock as StepsBlockProps } from '@/payload-types'

import { Icon } from '@/components/Icon'
import { SectionHeading } from '@/components/SectionHeading'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/utilities/ui'

type Item = NonNullable<StepsBlockProps['items']>[number]

const pad = (index: number) => String(index + 1).padStart(2, '0')

/** The step text, shared by the three variants. Each string sits in its own element. */
const StepText: React.FC<{ item: Item; titleClassName?: string }> = ({ item, titleClassName }) => (
  <>
    <h3 className={cn('text-lg leading-snug font-semibold', titleClassName)}>{item.title}</h3>
    {item.description && (
      <p className="mt-2 text-base whitespace-pre-line text-muted-foreground">{item.description}</p>
    )}
  </>
)

const StepNumber: React.FC<{ className?: string; index: number }> = ({ className, index }) => (
  <span aria-hidden="true" className={cn('tabular-nums', className)}>
    {pad(index)}
  </span>
)

const cardColumns = (count: number) =>
  count === 3
    ? 'sm:grid-cols-2 lg:grid-cols-3'
    : count === 4
      ? 'sm:grid-cols-2 lg:grid-cols-4'
      : count <= 2
        ? 'sm:grid-cols-2'
        : 'sm:grid-cols-2 lg:grid-cols-3'

const Cards: React.FC<{ items: Item[] }> = ({ items }) => (
  <ol className={cn('grid list-none gap-4 md:gap-6', cardColumns(items.length))} role="list">
    {items.map((item, index) => (
      <li className="flex" key={item.id ?? index}>
        <Card className="w-full [--card-spacing:--spacing(6)]">
          <CardContent className="flex flex-col gap-5">
            <div className="flex items-start justify-between gap-4">
              <StepNumber
                className="text-5xl leading-none font-semibold tracking-tight text-primary"
                index={index}
              />
              {item.icon && (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" name={item.icon} />
                </span>
              )}
            </div>
            <div>
              <StepText item={item} />
            </div>
          </CardContent>
        </Card>
      </li>
    ))}
  </ol>
)

const Timeline: React.FC<{ items: Item[] }> = ({ items }) => (
  <ol className="mx-auto max-w-3xl list-none" role="list">
    {items.map((item, index) => {
      const last = index === items.length - 1

      return (
        <li className={cn('relative pl-16', !last && 'pb-10')} key={item.id ?? index}>
          <span
            aria-hidden="true"
            className="absolute top-0 left-0 flex size-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground tabular-nums ring-4 ring-background"
          >
            {pad(index)}
          </span>
          {!last && (
            <span
              aria-hidden="true"
              className="absolute top-12 bottom-2 left-[calc(--spacing(5)-1px)] w-0.5 rounded-full bg-border"
            />
          )}
          <div className="flex items-start gap-3 pt-2">
            {item.icon && <Icon className="mt-0.5 size-5 shrink-0 text-primary" name={item.icon} />}
            {/* Title and description stack; the icon sits beside them. */}
            <div className="min-w-0">
              <StepText item={item} />
            </div>
          </div>
        </li>
      )
    })}
  </ol>
)

const Horizontal: React.FC<{ items: Item[] }> = ({ items }) => {
  // Up to five steps share one row; more wrap into rows of four.
  const columns = items.length <= 5 ? items.length : 4

  return (
    <ol
      className="grid list-none gap-x-8 gap-y-10 lg:grid-cols-[repeat(var(--steps),minmax(0,1fr))]"
      role="list"
      style={{ '--steps': columns } as React.CSSProperties}
    >
      {items.map((item, index) => {
        const endOfRow = (index + 1) % columns === 0 || index === items.length - 1

        return (
          <li className="relative flex flex-col" key={item.id ?? index}>
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground tabular-nums"
              >
                {pad(index)}
              </span>
              {!endOfRow && (
                <span
                  aria-hidden="true"
                  className="absolute top-5 left-[calc(--spacing(10)+--spacing(3))] hidden h-0.5 -translate-y-1/2 rounded-full bg-border lg:block"
                  style={{ right: 'calc(var(--spacing) * -5)' }}
                />
              )}
            </div>
            {item.icon && <Icon className="mt-5 size-6 text-primary" name={item.icon} />}
            <div className={item.icon ? 'mt-3' : 'mt-5'}>
              <StepText item={item} />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export const StepsBlock: React.FC<StepsBlockProps> = ({
  description,
  eyebrow,
  items,
  title,
  variant,
}) => {
  const steps = items ?? []

  return (
    <div className="container">
      <SectionHeading description={description} eyebrow={eyebrow} title={title} />
      {steps.length > 0 && (
        <div className={cn(Boolean(eyebrow || title || description) && 'mt-12 md:mt-16')}>
          {variant === 'timeline' ? (
            <Timeline items={steps} />
          ) : variant === 'horizontal' ? (
            <Horizontal items={steps} />
          ) : (
            <Cards items={steps} />
          )}
        </div>
      )}
    </div>
  )
}
