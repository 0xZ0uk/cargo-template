import React from 'react'

import type { PricingBlock as PricingBlockProps } from '@/payload-types'

import { Icon } from '@/components/Icon'
import { CMSLink } from '@/components/Link'
import { SectionHeading } from '@/components/SectionHeading'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { cn } from '@/utilities/ui'

type Plan = NonNullable<PricingBlockProps['plans']>[number]

const hasLink = (link: Plan['link']) => Boolean(link?.label && (link.url || link.reference))

/** Grid columns by plan count: never an orphan card, never cramped below `lg`. */
const gridClasses = (count: number) =>
  cn(
    'mx-auto grid w-full gap-6',
    count === 1 && 'max-w-md',
    count === 2 && 'max-w-4xl md:grid-cols-2',
    count === 3 && 'max-w-md lg:max-w-none lg:grid-cols-3',
    count >= 4 && 'max-w-md md:max-w-4xl md:grid-cols-2 xl:max-w-none xl:grid-cols-4',
  )

const PlanHeader: React.FC<{ plan: Plan }> = ({ plan }) => (
  <CardHeader className="gap-3">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-lg font-semibold">{plan.name}</h3>
      {plan.highlighted && plan.badge && <Badge>{plan.badge}</Badge>}
    </div>
    {(plan.price || plan.period) && (
      <p className="flex flex-wrap items-baseline gap-x-1">
        {plan.price && <span className="text-4xl font-semibold tracking-tight">{plan.price}</span>}
        {plan.period && <span className="text-sm text-muted-foreground">{plan.period}</span>}
      </p>
    )}
    {plan.description && (
      <p className="text-sm text-pretty whitespace-pre-line text-muted-foreground">
        {plan.description}
      </p>
    )}
  </CardHeader>
)

const PlanFeatures: React.FC<{ className?: string; features: Plan['features'] }> = ({
  className,
  features,
}) => {
  if (!features?.length) return null

  return (
    <ul className={cn('flex flex-col gap-3 text-sm', className)}>
      {features.map(({ id, feature }, index) => (
        <li className="flex items-start gap-3" key={id ?? index}>
          <Icon className="mt-0.5 size-4 shrink-0 text-primary" name="check" strokeWidth={2.5} />
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  )
}

const PlanAction: React.FC<{ plan: Plan }> = ({ plan }) => {
  if (!plan.link || !hasLink(plan.link)) return null

  return (
    <CardFooter className="border-t-0 bg-transparent pt-0">
      <CMSLink
        {...plan.link}
        appearance={plan.highlighted ? 'default' : 'outline'}
        className="w-full"
        size="lg"
      />
    </CardFooter>
  )
}

const cardClasses = (plan: Plan) =>
  cn('h-full [--card-spacing:--spacing(6)]', plan.highlighted && 'ring-2 ring-primary')

export const PricingBlock: React.FC<PricingBlockProps> = ({
  description,
  eyebrow,
  footnote,
  plans,
  title,
  variant,
}) => {
  const isSingle = variant === 'single'
  const shown = isSingle ? plans?.slice(0, 1) : plans

  return (
    <div className="container flex flex-col gap-12">
      <SectionHeading description={description} eyebrow={eyebrow} title={title} />

      {shown && shown.length > 0 && (
        <div className={isSingle ? 'mx-auto w-full max-w-3xl' : gridClasses(shown.length)}>
          {shown.map((plan, index) => (
            <Card className={cardClasses(plan)} key={plan.id ?? index}>
              <PlanHeader plan={plan} />
              {plan.features && plan.features.length > 0 && (
                <CardContent className="flex-1">
                  <PlanFeatures
                    className={
                      isSingle
                        ? 'gap-x-8 border-t pt-(--card-spacing) sm:grid sm:grid-cols-2'
                        : 'border-t pt-(--card-spacing)'
                    }
                    features={plan.features}
                  />
                </CardContent>
              )}
              <PlanAction plan={plan} />
            </Card>
          ))}
        </div>
      )}

      {footnote && (
        <p className="text-center text-sm whitespace-pre-line text-muted-foreground">{footnote}</p>
      )}
    </div>
  )
}
