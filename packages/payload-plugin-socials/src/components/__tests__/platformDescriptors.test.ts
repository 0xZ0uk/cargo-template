import { describe, expect, it } from 'vitest'

import type { PlatformId } from '../../constants.js'
import type { SocialDraftMedia } from '../../types/index.js'
import type { ComposerState } from '../platforms/index.js'

import { PLATFORM_IDS } from '../../constants.js'
import { getPlatformDescriptor, platformDescriptors } from '../platforms/index.js'

const front: SocialDraftMedia = { type: 'image', url: 'https://cdn.test/front.jpg' }
const detail: SocialDraftMedia = { type: 'image', url: 'https://cdn.test/detail.jpg' }
const video: SocialDraftMedia = {
  type: 'video',
  coverImageUrl: 'https://cdn.test/cover.jpg',
  url: 'https://cdn.test/video.mp4',
}

const state = (over: Partial<ComposerState> = {}): ComposerState => ({
  alertType: '',
  altText: 'Accessible',
  callToAction: '',
  callToActionUrl: 'https://example.test/cta',
  copy: 'Composed copy',
  destinationId: 'destination',
  eventEnd: '',
  eventStart: '',
  eventTitle: 'Event',
  format: 'IMAGE',
  languageCode: '',
  link: 'https://example.test/item',
  offerCode: '',
  offerTerms: '',
  selectedMedia: [],
  shareToFeed: true,
  title: 'Pin title',
  videoTitle: 'Video title',
  ...over,
})

const d = (platform: PlatformId) => getPlatformDescriptor(platform)

describe('platform descriptors', () => {
  it('has one descriptor per platform, keyed by its own id', () => {
    expect(Object.keys(platformDescriptors).sort()).toEqual([...PLATFORM_IDS].sort())
    for (const platform of PLATFORM_IDS) {
      expect(d(platform).id).toBe(platform)
    }
  })

  it('lists formats whose default is one of them, plus a discovery path', () => {
    expect(PLATFORM_IDS.map((platform) => d(platform).destination.path).sort()).toEqual([
      '/facebook/pages',
      '/gbp/locations',
      '/instagram/accounts',
      '/pinterest/boards',
    ])
    for (const platform of PLATFORM_IDS) {
      const { defaultFormat, formats } = d(platform)
      expect(formats.map((format) => format.value)).toContain(defaultFormat)
    }
  })

  describe('acceptedMedia', () => {
    it.each([
      ['pinterest', 'IMAGE', ['image']],
      ['pinterest', 'VIDEO', ['video']],
      ['instagram', 'IMAGE', ['image']],
      ['instagram', 'REELS', ['video']],
      ['instagram', 'STORIES', ['image', 'video']],
      ['instagram', 'CAROUSEL', ['image', 'video']],
      ['facebook', 'LINK', ['image']],
      ['facebook', 'PHOTO', ['image']],
      ['facebook', 'PHOTO_MULTI', ['image']],
      ['facebook', 'VIDEO', ['video']],
      ['gbp', 'STANDARD', ['image']],
      ['gbp', 'EVENT', ['image']],
      ['gbp', 'OFFER', ['image']],
      ['gbp', 'ALERT', ['image']],
    ] as const)('%s %s accepts %j', (platform, format, expected) => {
      expect(d(platform).acceptedMedia(format)).toEqual(expected)
    })
  })

  it('identifies only the two multi-media formats', () => {
    for (const platform of PLATFORM_IDS) {
      for (const { value } of d(platform).formats) {
        const multiple = d(platform).supportsMultipleMedia(value)
        expect(multiple).toBe(
          (platform === 'instagram' && value === 'CAROUSEL') ||
            (platform === 'facebook' && value === 'PHOTO_MULTI'),
        )
      }
    }
  })

  describe('mediaRequired', () => {
    it('is false only for text-first formats', () => {
      expect(d('facebook').mediaRequired('LINK')).toBe(false)
      expect(d('gbp').mediaRequired('STANDARD')).toBe(false)
      expect(d('gbp').mediaRequired('ALERT')).toBe(false)
      expect(d('facebook').mediaRequired('PHOTO')).toBe(true)
      expect(d('gbp').mediaRequired('EVENT')).toBe(true)
      expect(d('pinterest').mediaRequired('IMAGE')).toBe(true)
      expect(d('instagram').mediaRequired('REELS')).toBe(true)
    })
  })

  describe('initialFormat', () => {
    it('starts every platform in its default format', () => {
      for (const platform of PLATFORM_IDS) {
        if (platform !== 'pinterest') {
          expect(d(platform).initialFormat([front, video])).toBe(d(platform).defaultFormat)
        }
      }
    })

    it('starts Pinterest as a Video Pin only when the draft has a video and no image', () => {
      expect(d('pinterest').initialFormat([video])).toBe('VIDEO')
      expect(d('pinterest').initialFormat([front, video])).toBe('IMAGE')
      expect(d('pinterest').initialFormat([])).toBe('IMAGE')
    })
  })

  describe('visibleFields', () => {
    it('shows the pin title, link and alt text on image Pins', () => {
      expect(d('pinterest').visibleFields('IMAGE')).toEqual(['pinTitle', 'copy', 'link', 'altText'])
      expect(d('pinterest').visibleFields('VIDEO')).toEqual(['pinTitle', 'copy', 'link'])
    })

    it('gives Instagram the first-line title, alt text on images and a feed toggle on Reels', () => {
      expect(d('instagram').visibleFields('IMAGE')).toEqual(['firstLineTitle', 'copy', 'altText'])
      expect(d('instagram').visibleFields('REELS')).toEqual([
        'firstLineTitle',
        'copy',
        'shareToFeed',
      ])
      expect(d('instagram').visibleFields('CAROUSEL')).toEqual(['firstLineTitle', 'copy'])
      expect(d('instagram').visibleFields('STORIES')).toEqual(['firstLineTitle', 'copy'])
    })

    it('varies the Facebook extras by format', () => {
      expect(d('facebook').visibleFields('LINK')).toEqual(['firstLineTitle', 'copy', 'link'])
      expect(d('facebook').visibleFields('PHOTO')).toEqual(['firstLineTitle', 'copy', 'altText'])
      expect(d('facebook').visibleFields('PHOTO_MULTI')).toEqual(['firstLineTitle', 'copy'])
      expect(d('facebook').visibleFields('VIDEO')).toEqual(['firstLineTitle', 'copy', 'videoTitle'])
    })

    it('shows the whole details block for every GBP format', () => {
      for (const { value } of d('gbp').formats) {
        expect(d('gbp').visibleFields(value)).toEqual(['copy', 'gbpDetails'])
      }
    })

    it('labels the copy field per platform', () => {
      expect(PLATFORM_IDS.map((platform) => [platform, d(platform).copyLabel])).toEqual([
        ['pinterest', 'Description'],
        ['instagram', 'Caption'],
        ['facebook', 'Message'],
        ['gbp', 'Summary'],
      ])
    })
  })

  describe('destination.parse', () => {
    const rows = [
      { id: 'a', name: 'Name' },
      { id: 'b', pageName: 'Page' },
      { id: 'c', title: 'Title' },
      { id: 'd', storeCode: 'Store' },
      { id: 'e' },
      { id: 5, name: 'numeric id' },
      'not a row',
      null,
      [],
    ]

    it('reads the platform array and id field from the response', () => {
      expect(d('pinterest').destination.parse({ boards: [{ id: 'b1', name: 'Board' }] })).toEqual([
        { id: 'b1', label: 'Board' },
      ])
      expect(d('facebook').destination.parse({ pages: [{ id: 'p1', pageName: 'Page' }] })).toEqual([
        { id: 'p1', label: 'Page' },
      ])
      expect(
        d('instagram').destination.parse({ accounts: [{ id: 'ignored', igUserId: 'ig1' }] }),
      ).toEqual([{ id: 'ig1', label: 'ig1' }])
      expect(
        d('gbp').destination.parse({
          locations: [{ id: 'ignored', resourceName: 'locations/1', storeCode: 'S1' }],
        }),
      ).toEqual([{ id: 'locations/1', label: 'S1' }])
    })

    it('labels with the first string of name, pageName, title, storeCode, else the id', () => {
      expect(d('pinterest').destination.parse({ boards: rows })).toEqual([
        { id: 'a', label: 'Name' },
        { id: 'b', label: 'Page' },
        { id: 'c', label: 'Title' },
        { id: 'd', label: 'Store' },
        { id: 'e', label: 'e' },
      ])
    })

    it('ignores another platform’s key and malformed bodies', () => {
      expect(d('pinterest').destination.parse({ pages: rows })).toEqual([])
      expect(d('facebook').destination.parse({ pages: 'nope' })).toEqual([])
      expect(d('gbp').destination.parse({})).toEqual([])
    })
  })

  describe('applyTemplate', () => {
    const current = { altText: 'current alt', copy: 'current copy', title: 'current title' }

    it('maps Pinterest content, keeping current values for missing parts', () => {
      expect(
        d('pinterest').applyTemplate(
          {
            pinterestAltText: 'alt',
            pinterestDescription: 'Desc',
            pinterestHashtags: ['#a', '#b'],
            pinterestTitle: 'Title',
          },
          current,
        ),
      ).toEqual({ altText: 'alt', copy: 'Desc\n\n#a #b', title: 'Title' })
      expect(d('pinterest').applyTemplate({}, current)).toEqual(current)
      expect(d('pinterest').applyTemplate({ pinterestHashtags: ['#a'] }, current)).toEqual({
        ...current,
        copy: '#a',
      })
    })

    it('replaces only the copy on the other platforms', () => {
      expect(d('instagram').applyTemplate({ instagramCaption: 'IG' }, current)).toEqual({
        copy: 'IG',
      })
      expect(d('facebook').applyTemplate({ facebookMessage: 'FB' }, current)).toEqual({
        copy: 'FB',
      })
      expect(d('gbp').applyTemplate({ gbpSummary: 'GBP' }, current)).toEqual({ copy: 'GBP' })
    })

    it('does nothing when the template has no content for the platform', () => {
      const other = { facebookMessage: 'FB', gbpSummary: 'GBP', instagramCaption: 'IG' }
      expect(
        d('instagram').applyTemplate({ ...other, instagramCaption: '' }, current),
      ).toBeUndefined()
      expect(
        d('facebook').applyTemplate({ ...other, facebookMessage: undefined }, current),
      ).toBeUndefined()
      expect(d('gbp').applyTemplate({ instagramCaption: 'IG' }, current)).toBeUndefined()
    })
  })

  describe('buildInput', () => {
    it('compiles a Pinterest video Pin from canonical media', () => {
      expect(d('pinterest').buildInput(state({ format: 'VIDEO' }), [video])).toMatchObject({
        boardId: 'destination',
        coverImageUrl: 'https://cdn.test/cover.jpg',
        mediaType: 'VIDEO',
        videoUrl: 'https://cdn.test/video.mp4',
      })
    })

    it('keeps the Pinterest title and description separate and threads the asset format', () => {
      const input = d('pinterest').buildInput(state(), [{ ...front, format: 'jpeg' }])
      expect(input.title).toBe('Pin title')
      expect(input.description).toBe('Composed copy')
      expect(input.format).toBe('jpeg')
    })

    it('preserves ordered Instagram carousel children', () => {
      expect(
        d('instagram').buildInput(state({ format: 'CAROUSEL' }), [detail, video]),
      ).toMatchObject({
        carouselChildren: [
          { imageUrl: 'https://cdn.test/detail.jpg' },
          { videoUrl: 'https://cdn.test/video.mp4' },
        ],
        mediaType: 'CAROUSEL',
      })
    })

    it.each([
      ['IMAGE', [front], { imageUrl: 'https://cdn.test/front.jpg' }],
      [
        'REELS',
        [video],
        { coverUrl: 'https://cdn.test/cover.jpg', videoUrl: 'https://cdn.test/video.mp4' },
      ],
      ['STORIES', [video], { videoUrl: 'https://cdn.test/video.mp4' }],
      ['STORIES', [front], { imageUrl: 'https://cdn.test/front.jpg' }],
    ] as const)('compiles Instagram %s media', (format, assets, expected) => {
      expect(d('instagram').buildInput(state({ format }), [...assets])).toMatchObject(expected)
    })

    it('compiles Facebook multi-photo URLs without video assets', () => {
      expect(
        d('facebook').buildInput(state({ format: 'PHOTO_MULTI' }), [front, video, detail]),
      ).toMatchObject({
        format: 'PHOTO_MULTI',
        imageUrls: ['https://cdn.test/front.jpg', 'https://cdn.test/detail.jpg'],
        pageId: 'destination',
      })
    })

    it.each([
      ['PHOTO', [front], { imageUrl: 'https://cdn.test/front.jpg' }],
      ['VIDEO', [video], { videoTitle: 'Video title', videoUrl: 'https://cdn.test/video.mp4' }],
    ] as const)('compiles Facebook %s media', (format, assets, expected) => {
      expect(d('facebook').buildInput(state({ format }), [...assets])).toMatchObject(expected)
    })

    it('puts the title on the first line of the Instagram caption and Facebook message', () => {
      expect(d('instagram').buildInput(state({ title: 'My Title' }), []).caption).toBe(
        'My Title\n\nComposed copy',
      )
      expect(
        d('facebook').buildInput(state({ format: 'LINK', title: 'FB Title' }), []).message,
      ).toBe('FB Title\n\nComposed copy')
    })

    it('leaves the caption alone without a title', () => {
      expect(d('instagram').buildInput(state({ title: '' }), []).caption).toBe('Composed copy')
    })

    it('uses the title alone when there is no copy', () => {
      expect(d('facebook').buildInput(state({ copy: '', title: 'Only' }), []).message).toBe('Only')
    })

    it('does not double the title when the message already starts with it', () => {
      const input = d('facebook').buildInput(
        state({ copy: 'Product 1\n\nThe body.', format: 'PHOTO', title: 'Product 1' }),
        [],
      )
      expect(input.message).toBe('Product 1\n\nThe body.')
      expect(
        d('facebook').buildInput(
          state({ copy: 'The body.', format: 'PHOTO', title: 'Product 1' }),
          [],
        ).message,
      ).toBe('Product 1\n\nThe body.')
    })

    it('compiles GBP event dates and times into the LocalPosts shape', () => {
      expect(
        d('gbp').buildInput(
          state({ eventEnd: '2027-06-02T17:30', eventStart: '2027-06-01T09:15', format: 'EVENT' }),
          [],
        ),
      ).toMatchObject({
        event: {
          schedule: {
            endDate: { day: 2, month: 6, year: 2027 },
            endTime: { hours: 17, minutes: 30 },
            startDate: { day: 1, month: 6, year: 2027 },
            startTime: { hours: 9, minutes: 15 },
          },
          title: 'Event',
        },
        topicType: 'EVENT',
      })
    })

    it('omits the GBP event until both dates are set', () => {
      expect(
        d('gbp').buildInput(state({ eventStart: '2027-06-01T09:15', format: 'EVENT' }), []),
      ).not.toHaveProperty('event')
    })

    it('compiles GBP offer, alert, and call CTA variants', () => {
      expect(
        d('gbp').buildInput(
          state({
            callToActionUrl: 'https://example.test/redeem',
            eventEnd: '2027-06-02T17:30',
            eventStart: '2027-06-01T09:15',
            format: 'OFFER',
            offerCode: 'SAVE20',
            offerTerms: 'Terms',
          }),
          [],
        ),
      ).toMatchObject({
        offer: {
          couponCode: 'SAVE20',
          redeemOnlineUrl: 'https://example.test/redeem',
          termsConditions: 'Terms',
        },
      })
      expect(
        d('gbp').buildInput(state({ alertType: 'COVID_19', format: 'ALERT' }), [front]),
      ).toMatchObject({ alertType: 'COVID_19', imageUrl: undefined })
      expect(
        d('gbp').buildInput(state({ callToAction: 'CALL', format: 'STANDARD' }), []),
      ).toMatchObject({ callToAction: { actionType: 'CALL', url: undefined } })
    })
  })

  describe('buildStandaloneInput', () => {
    it('builds the Pinterest board target', () => {
      expect(d('pinterest').buildStandaloneInput('board-1', 'IMAGE', [front])).toEqual({
        boardId: 'board-1',
        imageUrl: 'https://cdn.test/front.jpg',
        mediaType: 'IMAGE',
        videoUrl: undefined,
      })
    })

    it('builds Instagram targets per format', () => {
      expect(d('instagram').buildStandaloneInput('ig-1', 'IMAGE', [front])).toEqual({
        igUserId: 'ig-1',
        imageUrl: 'https://cdn.test/front.jpg',
        mediaType: 'IMAGE',
      })
      expect(d('instagram').buildStandaloneInput('ig-1', 'REELS', [video])).toEqual({
        igUserId: 'ig-1',
        mediaType: 'REELS',
        videoUrl: 'https://cdn.test/video.mp4',
      })
      expect(d('instagram').buildStandaloneInput('ig-1', 'STORIES', [front, video])).toEqual({
        igUserId: 'ig-1',
        imageUrl: 'https://cdn.test/front.jpg',
        mediaType: 'STORIES',
        videoUrl: 'https://cdn.test/video.mp4',
      })
      expect(d('instagram').buildStandaloneInput('ig-1', 'CAROUSEL', [detail, video])).toEqual({
        carouselChildren: [
          { imageUrl: 'https://cdn.test/detail.jpg' },
          { videoUrl: 'https://cdn.test/video.mp4' },
        ],
        igUserId: 'ig-1',
        mediaType: 'CAROUSEL',
      })
    })

    it('builds Facebook targets per format', () => {
      expect(d('facebook').buildStandaloneInput('page-1', 'LINK', [front])).toEqual({
        format: 'LINK',
        pageId: 'page-1',
      })
      expect(d('facebook').buildStandaloneInput('page-1', 'PHOTO', [front])).toEqual({
        format: 'PHOTO',
        imageUrl: 'https://cdn.test/front.jpg',
        pageId: 'page-1',
      })
      expect(d('facebook').buildStandaloneInput('page-1', 'PHOTO_MULTI', [front, detail])).toEqual({
        format: 'PHOTO_MULTI',
        imageUrls: ['https://cdn.test/front.jpg', 'https://cdn.test/detail.jpg'],
        pageId: 'page-1',
      })
      expect(d('facebook').buildStandaloneInput('page-1', 'VIDEO', [video])).toEqual({
        format: 'VIDEO',
        pageId: 'page-1',
        videoUrl: 'https://cdn.test/video.mp4',
      })
    })

    it('builds the GBP location target', () => {
      expect(d('gbp').buildStandaloneInput('locations/1', 'STANDARD', [front])).toEqual({
        imageUrl: 'https://cdn.test/front.jpg',
        locationResourceName: 'locations/1',
        topicType: 'STANDARD',
      })
    })
  })
})
