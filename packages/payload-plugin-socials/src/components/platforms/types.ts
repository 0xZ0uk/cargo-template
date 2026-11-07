import type { PlatformId } from '../../constants.js'
import type { SocialDraftMedia } from '../../types/index.js'

export type MediaType = 'image' | 'video'

export type ComposerState = {
  alertType: '' | 'COVID_19'
  altText: string
  callToAction: '' | 'BOOK' | 'CALL' | 'LEARN_MORE' | 'ORDER' | 'SHOP' | 'SIGN_UP'
  callToActionUrl: string
  copy: string
  destinationId: string
  eventEnd: string
  eventStart: string
  eventTitle: string
  format: string
  languageCode: string
  link: string
  offerCode: string
  offerTerms: string
  selectedMedia: string[]
  shareToFeed: boolean
  title: string
  videoTitle: string
}

export type ComposerDestination = { id: string; label: string }

export type ComposerFormat = { label: string; value: string }

/**
 * The fields a composer can show for a platform and format, in render order.
 * The source composer renders one control per key; `gbpDetails` is the whole
 * Google Business Profile block (call to action, event, offer, alert, language).
 */
export type ComposerFieldKey =
  | 'altText'
  | 'copy'
  | 'firstLineTitle'
  | 'gbpDetails'
  | 'link'
  | 'pinTitle'
  | 'shareToFeed'
  | 'videoTitle'

/** The slice of a resolved template's content that the composers read. */
export type ResolvedTemplateContent = {
  facebookMessage?: string
  gbpSummary?: string
  instagramCaption?: string
  pinterestAltText?: string
  pinterestDescription?: string
  pinterestHashtags?: string[]
  pinterestTitle?: string
}

/** The form fields a template can overwrite, passed in so a partial result keeps the rest. */
export type TemplateTarget = Pick<ComposerState, 'altText' | 'copy' | 'title'>

/**
 * Everything the composers need to know about one platform. Client-safe: pure
 * data and pure functions, no Payload or server runtime imports. Adding a
 * platform or a format means editing one descriptor.
 */
export type PlatformDescriptor = {
  /** Which media types a format accepts (drives the picker and validation). */
  acceptedMedia: (format: string) => MediaType[]
  /**
   * Source composer: a template's resolved content as form-state changes, or
   * undefined when the template has nothing for this platform.
   */
  applyTemplate: (
    resolved: ResolvedTemplateContent,
    current: TemplateTarget,
  ) => Partial<ComposerState> | undefined
  /** Source composer: the publish input for the form state and its effective assets. */
  buildInput: (state: ComposerState, assets: SocialDraftMedia[]) => Record<string, unknown>
  /**
   * Standalone composer: the publish input for one target. `assets` are the
   * shared media already filtered to the format's accepted types.
   */
  buildStandaloneInput: (
    destinationId: string,
    format: string,
    assets: SocialDraftMedia[],
  ) => Record<string, unknown>
  /** Label of the copy textarea in the source composer. */
  copyLabel: string
  defaultFormat: string
  destination: {
    /** Parse the discovery endpoint's JSON body into select options. */
    parse: (body: Record<string, unknown>) => ComposerDestination[]
    /** Discovery endpoint, relative to the socials API base. */
    path: string
  }
  formats: ComposerFormat[]
  id: PlatformId
  /** The format a fresh source composer starts in, given the draft's media. */
  initialFormat: (media: SocialDraftMedia[]) => string
  /** Whether the format cannot publish without media (shows the media picker even when empty). */
  mediaRequired: (format: string) => boolean
  supportsMultipleMedia: (format: string) => boolean
  /**
   * Instagram and Facebook have no title field: the form's title becomes the
   * first line of the caption/message, so the body must not start with it.
   */
  titleLeadsCopy: boolean
  /** Source composer: the controls to show for a format, in render order. */
  visibleFields: (format: string) => ComposerFieldKey[]
}
