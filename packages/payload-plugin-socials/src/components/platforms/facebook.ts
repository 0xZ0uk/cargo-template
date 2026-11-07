import type { PlatformDescriptor } from './types.js'

import { captionWithTitle, firstOfType, parseDestinationResponse } from './shared.js'

export const facebookDescriptor: PlatformDescriptor = {
  id: 'facebook',
  // A link post's image is optional, but only an image is accepted when present.
  acceptedMedia: (format) => (format === 'VIDEO' ? ['video'] : ['image']),
  applyTemplate: (resolved) =>
    resolved.facebookMessage ? { copy: resolved.facebookMessage } : undefined,
  buildInput: (state, assets) => {
    const firstImage = firstOfType(assets, 'image')
    const firstVideo = firstOfType(assets, 'video')
    const input: Record<string, unknown> = {
      altText: state.altText,
      format: state.format,
      link: state.link,
      message: captionWithTitle(state),
      pageId: state.destinationId,
    }
    if (state.format === 'PHOTO') {
      input.imageUrl = firstImage?.url
      input.imageFormat = firstImage?.format
    }
    if (state.format === 'PHOTO_MULTI') {
      input.imageUrls = assets.filter((asset) => asset.type === 'image').map((asset) => asset.url)
    }
    if (state.format === 'VIDEO') {
      input.videoTitle = state.videoTitle
      input.videoUrl = firstVideo?.url
      input.videoFormat = firstVideo?.format
    }
    return input
  },
  buildStandaloneInput: (destinationId, format, assets) => {
    const input: Record<string, unknown> = { pageId: destinationId, format }
    if (format === 'PHOTO') {
      input.imageUrl = firstOfType(assets, 'image')?.url
    }
    if (format === 'PHOTO_MULTI') {
      input.imageUrls = assets.filter((a) => a.type === 'image').map((a) => a.url)
    }
    if (format === 'VIDEO') {
      input.videoUrl = firstOfType(assets, 'video')?.url
    }
    return input
  },
  copyLabel: 'Message',
  defaultFormat: 'LINK',
  destination: {
    parse: (body) => parseDestinationResponse(body, 'pages', 'id'),
    path: '/facebook/pages',
  },
  formats: [
    { label: 'Link or text', value: 'LINK' },
    { label: 'Single photo', value: 'PHOTO' },
    { label: 'Photo gallery', value: 'PHOTO_MULTI' },
    { label: 'Video', value: 'VIDEO' },
  ],
  initialFormat: () => 'LINK',
  mediaRequired: (format) => format !== 'LINK',
  supportsMultipleMedia: (format) => format === 'PHOTO_MULTI',
  titleLeadsCopy: true,
  visibleFields: (format) => {
    if (format === 'LINK') {
      return ['firstLineTitle', 'copy', 'link']
    }
    if (format === 'PHOTO') {
      return ['firstLineTitle', 'copy', 'altText']
    }
    if (format === 'VIDEO') {
      return ['firstLineTitle', 'copy', 'videoTitle']
    }
    return ['firstLineTitle', 'copy']
  },
}
