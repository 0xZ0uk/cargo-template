import { Link } from '@tanstack/react-router'
import React from 'react'

import type { PageHeaderBlock as PageHeaderBlockProps } from '@/payload-types'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { cn } from '@/utilities/ui'

export const PageHeaderBlock: React.FC<PageHeaderBlockProps> = ({
  description,
  eyebrow,
  showBreadcrumbs,
  title,
  variant,
}) => {
  const centered = variant === 'centered'

  return (
    <div className="container">
      <div
        className={cn(
          'flex flex-col gap-6',
          centered ? 'items-center text-center' : 'border-b pb-8 md:pb-12',
        )}
      >
        {showBreadcrumbs && title && (
          <Breadcrumb>
            <BreadcrumbList className={cn(centered && 'justify-center')}>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link to="/" />}>Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        )}
        <div className={cn('flex max-w-3xl flex-col gap-4', centered && 'items-center')}>
          {eyebrow && <p className="text-sm font-medium text-primary">{eyebrow}</p>}
          {title && (
            <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
              {title}
            </h1>
          )}
          {description && (
            <p className="text-lg text-pretty whitespace-pre-line text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
