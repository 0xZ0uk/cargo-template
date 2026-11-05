import React from 'react'

import type { ColumnsBlock } from '@/payload-types'

import { Icon } from '@/components/Icon'
import { CMSLink } from '@/components/Link'
import { BlockMedia } from '@/components/Media/BlockMedia'
import RichText from '@/components/RichText'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/utilities/ui'

export type ColumnElement = NonNullable<
  NonNullable<ColumnsBlock['columns']>[number]['content']
>[number]
export type ColumnElementType = ColumnElement['blockType']

const TextElement: React.FC<Extract<ColumnElement, { blockType: 'columnText' }>> = ({
  richText,
}) => {
  if (!richText) return null

  return (
    <RichText
      className="mx-0 prose-headings:mt-0 first:prose-headings:mt-0"
      data={richText}
      enableGutter={false}
    />
  )
}

const MediaElement: React.FC<Extract<ColumnElement, { blockType: 'columnMedia' }>> = ({
  caption,
  media,
}) => (
  <figure className="flex flex-col gap-3">
    <BlockMedia className="aspect-video rounded-xl" resource={media} />
    {caption && <figcaption className="text-sm text-muted-foreground">{caption}</figcaption>}
  </figure>
)

const ButtonsElement: React.FC<Extract<ColumnElement, { blockType: 'columnButtons' }>> = ({
  links,
}) => {
  if (!links?.length) return null

  return (
    <div className="flex flex-wrap items-center gap-3">
      {links.map(({ id, link }, index) => (
        <CMSLink
          key={id ?? index}
          {...link}
          appearance={link.appearance === 'outline' ? 'outline' : 'default'}
          size="lg"
        />
      ))}
    </div>
  )
}

const CardElement: React.FC<Extract<ColumnElement, { blockType: 'columnCard' }>> = ({
  description,
  enableLink,
  icon,
  link,
  title,
}) => {
  const hasLink = Boolean(enableLink && link && (link.url || link.reference))

  return (
    <Card
      className={cn(
        'relative gap-4 py-6 transition-shadow',
        hasLink &&
          'hover:ring-foreground/25 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring',
      )}
    >
      <CardHeader className="gap-3 px-6">
        {icon && (
          <span className="mb-1 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-5" name={icon} />
          </span>
        )}
        {title && <CardTitle className="text-lg font-semibold">{title}</CardTitle>}
      </CardHeader>
      {(description || hasLink) && (
        <CardContent className="flex flex-col gap-4 px-6">
          {description && (
            <CardDescription className="text-sm/relaxed whitespace-pre-line">
              {description}
            </CardDescription>
          )}
          {hasLink && link && (
            <CMSLink
              {...link}
              appearance="link"
              // The pseudo-element stretches the link over the whole card.
              className="h-auto self-start p-0 font-medium after:absolute after:inset-0 after:content-[''] focus-visible:ring-0"
            />
          )}
        </CardContent>
      )}
    </Card>
  )
}

/** Renders one element of a column. Typed exhaustively: a new element needs an entry here. */
export const elementComponents: {
  [K in ColumnElementType]: React.ComponentType<Extract<ColumnElement, { blockType: K }>>
} = {
  columnButtons: ButtonsElement,
  columnCard: CardElement,
  columnMedia: MediaElement,
  columnText: TextElement,
}
