import type { ElementType, Ref } from 'react'

import type { Media as MediaType } from '@/payload-types'

export interface Props {
  alt?: string
  className?: string
  /** Stretch the image over its nearest positioned ancestor. */
  fill?: boolean
  htmlElement?: ElementType | null
  pictureClassName?: string
  imgClassName?: string
  onClick?: () => void
  onLoad?: () => void
  loading?: 'lazy' | 'eager'
  /** Load eagerly with high fetch priority, for above-the-fold images. */
  priority?: boolean
  ref?: Ref<HTMLImageElement | HTMLVideoElement | null>
  resource?: MediaType | string | number | null // for Payload media
  size?: string
  src?: string // for static media
  videoClassName?: string
}
