import { cn } from '@/utilities/ui'
import React from 'react'

import type { Props as MediaProps } from '../types'

import { getMediaUrl } from '@/utilities/getMediaUrl'

/**
 * Renders a plain `<img>`. Workers can't run sharp, so the Media collection has no resized
 * variants; for responsive images, put Cloudflare Images in front of the media URLs.
 */
export const ImageMedia: React.FC<MediaProps> = (props) => {
  const {
    alt: altFromProps,
    fill,
    pictureClassName,
    imgClassName,
    onLoad,
    priority,
    ref,
    resource,
    size,
    src: srcFromProps,
    loading: loadingFromProps,
  } = props

  let width: number | undefined
  let height: number | undefined
  let alt = altFromProps
  let src = srcFromProps || ''

  if (!src && resource && typeof resource === 'object') {
    const { alt: altFromResource, height: fullHeight, url, width: fullWidth } = resource

    width = fullWidth ?? undefined
    height = fullHeight ?? undefined
    alt = altFromResource || ''

    src = getMediaUrl(url, resource.updatedAt)
  }

  const loading = loadingFromProps || (priority ? 'eager' : 'lazy')

  return (
    <picture className={cn(pictureClassName)}>
      <img
        alt={alt || ''}
        className={cn({ 'absolute inset-0 size-full': fill }, imgClassName)}
        decoding="async"
        fetchPriority={priority ? 'high' : undefined}
        height={!fill ? height : undefined}
        loading={loading}
        onLoad={onLoad}
        ref={ref as React.Ref<HTMLImageElement>}
        sizes={size}
        src={src}
        width={!fill ? width : undefined}
      />
    </picture>
  )
}
