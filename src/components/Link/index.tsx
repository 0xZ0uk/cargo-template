import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/utilities/ui'
import { Link } from '@tanstack/react-router'
import React from 'react'

import type { Page } from '@/payload-types'

type CMSLinkType = {
  appearance?: 'inline' | ButtonProps['variant']
  children?: React.ReactNode
  className?: string
  label?: string | null
  newTab?: boolean | null
  reference?: {
    relationTo: 'pages'
    value: Page | string | number
  } | null
  size?: ButtonProps['size'] | null
  type?: 'custom' | 'reference' | null
  url?: string | null
}

export const CMSLink: React.FC<CMSLinkType> = (props) => {
  const {
    type,
    appearance = 'inline',
    children,
    className,
    label,
    newTab,
    reference,
    size: sizeFromProps,
    url,
  } = props

  const slug =
    type === 'reference' && typeof reference?.value === 'object' ? reference.value.slug : null

  if (!slug && !url) return null

  const size = appearance === 'link' ? 'clear' : sizeFromProps
  const newTabProps = newTab ? { rel: 'noopener noreferrer', target: '_blank' } : {}
  const content = (
    <>
      {label && label}
      {children && children}
    </>
  )

  // Internal pages navigate client-side; custom URLs can point anywhere, so they stay plain
  // anchors.
  const anchor = slug ? (
    slug === 'home' ? (
      <Link className={cn(className)} to="/" {...newTabProps}>
        {content}
      </Link>
    ) : (
      <Link className={cn(className)} params={{ slug }} to="/$slug" {...newTabProps}>
        {content}
      </Link>
    )
  ) : (
    <a className={cn(className)} href={url!} {...newTabProps}>
      {content}
    </a>
  )

  /* Ensure we don't break any styles set by richText */
  if (appearance === 'inline') {
    return anchor
  }

  return (
    <Button asChild className={className} size={size} variant={appearance}>
      {anchor}
    </Button>
  )
}
