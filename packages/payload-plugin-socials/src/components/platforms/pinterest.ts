import type { PlatformDescriptor } from './types.js'

import { firstOfType, parseDestinationResponse } from './shared.js'

export const pinterestDescriptor: PlatformDescriptor = {
  id: 'pinterest',
  acceptedMedia: (format) => (format === 'VIDEO' ? ['video'] : ['image']),
  applyTemplate: (resolved, current) => {
    const tags = resolved.pinterestHashtags?.join(' ')
    return {
      altText: resolved.pinterestAltText ?? current.altText,
      copy: [resolved.pinterestDescription, tags].filter(Boolean).join('\n\n') || current.copy,
      title: resolved.pinterestTitle ?? current.title,
    }
  },
  buildInput: (state, assets) => {
    const firstImage = firstOfType(assets, 'image')
    const firstVideo = firstOfType(assets, 'video')
    return {
      altText: state.altText,
      boardId: state.destinationId,
      coverImageUrl: firstVideo?.coverImageUrl ?? firstImage?.url,
      description: state.copy,
      format: firstImage?.format ?? firstVideo?.format,
      imageUrl: firstImage?.url,
      link: state.link,
      mediaType: state.format,
      title: state.title,
      videoUrl: firstVideo?.url,
    }
  },
  buildStandaloneInput: (destinationId, format, assets) => ({
    boardId: destinationId,
    imageUrl: firstOfType(assets, 'image')?.url,
    videoUrl: firstOfType(assets, 'video')?.url,
    mediaType: format,
  }),
  copyLabel: 'Description',
  defaultFormat: 'IMAGE',
  destination: {
    parse: (body) => parseDestinationResponse(body, 'boards', 'id'),
    path: '/pinterest/boards',
  },
  formats: [
    { label: 'Image Pin', value: 'IMAGE' },
    { label: 'Video Pin', value: 'VIDEO' },
  ],
  // A draft with only a video starts as a Video Pin.
  initialFormat: (media) =>
    !media.some((asset) => asset.type === 'image') && media.some((asset) => asset.type === 'video')
      ? 'VIDEO'
      : 'IMAGE',
  mediaRequired: () => true,
  supportsMultipleMedia: () => false,
  titleLeadsCopy: false,
  visibleFields: (format) =>
    format === 'IMAGE' ? ['pinTitle', 'copy', 'link', 'altText'] : ['pinTitle', 'copy', 'link'],
}
