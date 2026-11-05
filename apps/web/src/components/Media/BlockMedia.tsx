import { ImageIcon } from 'lucide-react'
import React from 'react'

import type { Props as MediaProps } from './types'

import { cn } from '@/utilities/ui'

import { Media } from '.'

/**
 * Media from a block's upload field, or a neutral placeholder while none is chosen (new
 * blocks, the gallery, examples). Size the box with `className` (e.g. `aspect-video`); the
 * image covers it.
 */
export const BlockMedia: React.FC<
  Pick<MediaProps, 'imgClassName' | 'priority' | 'resource' | 'videoClassName'> & {
    className?: string
  }
> = ({ className, imgClassName, resource, ...props }) => {
  if (resource && typeof resource === 'object') {
    return (
      <Media
        className={cn('relative overflow-hidden', className)}
        fill
        imgClassName={cn('object-cover', imgClassName)}
        resource={resource}
        videoClassName="absolute inset-0 size-full object-cover"
        {...props}
      />
    )
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex items-center justify-center bg-muted text-muted-foreground/60',
        className,
      )}
    >
      <ImageIcon className="size-10" strokeWidth={1.25} />
    </div>
  )
}
