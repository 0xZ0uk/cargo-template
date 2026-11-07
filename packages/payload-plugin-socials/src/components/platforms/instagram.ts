import type { PlatformDescriptor } from './types.js'

import { captionWithTitle, firstOfType, parseDestinationResponse } from './shared.js'

export const instagramDescriptor: PlatformDescriptor = {
  id: 'instagram',
  acceptedMedia: (format) => {
    if (format === 'IMAGE') {
      return ['image']
    }
    if (format === 'REELS') {
      return ['video']
    }
    return ['image', 'video'] // STORIES, CAROUSEL
  },
  applyTemplate: (resolved) =>
    resolved.instagramCaption ? { copy: resolved.instagramCaption } : undefined,
  buildInput: (state, assets) => {
    const firstImage = firstOfType(assets, 'image')
    const firstVideo = firstOfType(assets, 'video')
    const input: Record<string, unknown> = {
      altText: state.altText,
      caption: captionWithTitle(state),
      format: firstImage?.format ?? firstVideo?.format,
      igUserId: state.destinationId,
      mediaType: state.format,
      shareToFeed: state.shareToFeed,
    }
    if (state.format === 'IMAGE') {
      input.imageUrl = firstImage?.url
    }
    if (state.format === 'REELS') {
      input.coverUrl = firstVideo?.coverImageUrl ?? firstImage?.url
      input.videoUrl = firstVideo?.url
    }
    if (state.format === 'STORIES') {
      if (firstVideo) {
        input.videoUrl = firstVideo.url
      } else {
        input.imageUrl = firstImage?.url
      }
    }
    if (state.format === 'CAROUSEL') {
      input.carouselChildren = assets.map((asset) =>
        asset.type === 'video'
          ? { format: asset.format, videoUrl: asset.url }
          : { format: asset.format, imageUrl: asset.url },
      )
    }
    return input
  },
  buildStandaloneInput: (destinationId, format, assets) => {
    const firstImage = firstOfType(assets, 'image')
    const firstVideo = firstOfType(assets, 'video')
    const input: Record<string, unknown> = { igUserId: destinationId, mediaType: format }
    if (format === 'IMAGE') {
      input.imageUrl = firstImage?.url
    }
    if (format === 'REELS') {
      input.videoUrl = firstVideo?.url
    }
    if (format === 'STORIES') {
      input.imageUrl = firstImage?.url
      input.videoUrl = firstVideo?.url
    }
    if (format === 'CAROUSEL') {
      input.carouselChildren = assets.map((asset) =>
        asset.type === 'video' ? { videoUrl: asset.url } : { imageUrl: asset.url },
      )
    }
    return input
  },
  copyLabel: 'Caption',
  defaultFormat: 'IMAGE',
  destination: {
    parse: (body) => parseDestinationResponse(body, 'accounts', 'igUserId'),
    path: '/instagram/accounts',
  },
  formats: [
    { label: 'Image', value: 'IMAGE' },
    { label: 'Reel', value: 'REELS' },
    { label: 'Story', value: 'STORIES' },
    { label: 'Carousel', value: 'CAROUSEL' },
  ],
  initialFormat: () => 'IMAGE',
  mediaRequired: () => true,
  supportsMultipleMedia: (format) => format === 'CAROUSEL',
  titleLeadsCopy: true,
  visibleFields: (format) => {
    if (format === 'IMAGE') {
      return ['firstLineTitle', 'copy', 'altText']
    }
    if (format === 'REELS') {
      return ['firstLineTitle', 'copy', 'shareToFeed']
    }
    return ['firstLineTitle', 'copy']
  },
}
