import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/utilities/ui'
import { Link } from '@tanstack/react-router'
import type { VariantProps } from 'class-variance-authority'
import React from 'react'

import type { Page } from '@/payload-types'

type ButtonVariants = VariantProps<typeof buttonVariants>

type CMSLinkType = {
  appearance?: 'inline' | ButtonVariants['variant']
  children?: React.ReactNode
  className?: string
  label?: string | null
  newTab?: boolean | null
  reference?: {
    relationTo: 'pages'
    value: Page | string | number
  } | null
  size?: ButtonVariants['size']
  type?: 'custom' | 'reference' | null
  url?: string | null
}

export const CMSLink: React.FC<CMSLinkType> = (props) => {
  const {
    type,
    appearance: appearanceProp = 'inline',
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

  const newTabProps = newTab ? { rel: 'noopener noreferrer', target: '_blank' } : {}
  // `null` is a button link whose appearance an editor cleared: show the default button.
  const appearance = appearanceProp ?? 'default'
  // Button appearances style the anchor itself (shadcn's pattern for links), so it stays a
  // link to assistive tech. Inline links keep the rich text's own styles. A `link`
  // appearance gets no size, so it has no button height or padding.
  const linkClassName =
    appearance === 'inline'
      ? cn(className)
      : cn(
          buttonVariants({
            size: appearance === 'link' ? null : sizeFromProps,
            variant: appearance,
          }),
          className,
        )
  const content = (
    <>
      {label && label}
      {children && children}
    </>
  )

  // Internal pages navigate client-side; custom URLs can point anywhere, so they stay plain
  // anchors.
  if (slug) {
    return slug === 'home' ? (
      <Link className={linkClassName} to="/" {...newTabProps}>
        {content}
      </Link>
    ) : (
      <Link className={linkClassName} params={{ slug }} to="/$slug" {...newTabProps}>
        {content}
      </Link>
    )
  }

  return (
    <a className={linkClassName} href={url!} {...newTabProps}>
      {content}
    </a>
  )
}
