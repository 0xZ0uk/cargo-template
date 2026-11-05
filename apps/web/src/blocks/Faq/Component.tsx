import React from 'react'

import type { FaqBlock as FaqBlockProps } from '@/payload-types'

import RichText from '@/components/RichText'
import { SectionHeading } from '@/components/SectionHeading'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { cn } from '@/utilities/ui'

type Item = NonNullable<FaqBlockProps['items']>[number]

// Compact prose that follows the theme tokens, so it reads in default, muted and dark sections.
const answerClass =
  'prose-sm mx-0 max-w-none [--tw-prose-body:var(--color-muted-foreground)] [--tw-prose-links:var(--color-primary)] dark:[--tw-prose-body:var(--color-muted-foreground)] dark:[--tw-prose-links:var(--color-primary)]'

const Answer: React.FC<{ answer: Item['answer']; className?: string }> = ({ answer, className }) =>
  answer ? (
    <RichText className={cn(answerClass, className)} data={answer} enableGutter={false} />
  ) : null

const FaqAccordion: React.FC<{ className?: string; items: Item[] }> = ({ className, items }) => (
  // `hiddenUntilFound`: closed answers stay in the HTML (search engines, find in page) and open
  // when the browser finds text in them.
  <Accordion
    className={cn('rounded-xl border bg-card px-5 md:px-6', className)}
    hiddenUntilFound
    multiple
  >
    {items.map((item, index) => (
      <AccordionItem key={item.id ?? index} value={item.id ?? String(index)}>
        <AccordionTrigger className="gap-4 py-5 text-base font-medium hover:no-underline">
          {item.question}
        </AccordionTrigger>
        <AccordionContent className="pr-8 pb-5">
          <Answer answer={item.answer} />
        </AccordionContent>
      </AccordionItem>
    ))}
  </Accordion>
)

const FaqGrid: React.FC<{ items: Item[] }> = ({ items }) => (
  <dl className="grid gap-4 md:grid-cols-2 md:gap-6">
    {items.map((item, index) => (
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-6" key={item.id ?? index}>
        <dt className="text-base font-semibold text-balance">{item.question}</dt>
        <dd>
          <Answer answer={item.answer} />
        </dd>
      </div>
    ))}
  </dl>
)

export const FaqBlock: React.FC<FaqBlockProps> = ({
  description,
  eyebrow,
  items,
  title,
  variant,
}) => {
  const list = (items ?? []).filter((item) => item.question || item.answer)
  const hasHeading = Boolean(eyebrow || title || description)

  if (!hasHeading && list.length === 0) return null

  const heading = (align: 'center' | 'start') => (
    <SectionHeading align={align} description={description} eyebrow={eyebrow} title={title} />
  )

  if (variant === 'split') {
    return (
      <div className="container">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16">
          {hasHeading && (
            <div className="lg:sticky lg:top-24 lg:self-start">{heading('start')}</div>
          )}
          {list.length > 0 && (
            <FaqAccordion className={cn(!hasHeading && 'lg:col-span-2')} items={list} />
          )}
        </div>
      </div>
    )
  }

  if (variant === 'grid') {
    return (
      <div className="container flex flex-col gap-10 md:gap-14">
        {heading('center')}
        {list.length > 0 && <FaqGrid items={list} />}
      </div>
    )
  }

  return (
    <div className="container flex flex-col gap-10 md:gap-14">
      {heading('center')}
      {list.length > 0 && <FaqAccordion className="mx-auto w-full max-w-3xl" items={list} />}
    </div>
  )
}
