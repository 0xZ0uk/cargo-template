import type { PlatformId } from '../../constants.js'
import type { PlatformDescriptor } from './types.js'

import { facebookDescriptor } from './facebook.js'
import { gbpDescriptor } from './gbp.js'
import { instagramDescriptor } from './instagram.js'
import { pinterestDescriptor } from './pinterest.js'

export type {
  ComposerDestination,
  ComposerFieldKey,
  ComposerFormat,
  ComposerState,
  MediaType,
  PlatformDescriptor,
  ResolvedTemplateContent,
  TemplateTarget,
} from './types.js'

/** One descriptor per platform: the single place that knows how a platform composes. */
export const platformDescriptors: Record<PlatformId, PlatformDescriptor> = {
  facebook: facebookDescriptor,
  gbp: gbpDescriptor,
  instagram: instagramDescriptor,
  pinterest: pinterestDescriptor,
}

export const getPlatformDescriptor = (platform: PlatformId): PlatformDescriptor =>
  platformDescriptors[platform]
