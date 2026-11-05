import type { TextFieldSingleValidation } from 'payload'

import { defineBlock } from '../shared/defineBlock'

import { embedMeta } from './meta'
import { embedProviderNames, toEmbed } from './providers'
import { embedThumbnail } from './thumbnail'

const supported = embedProviderNames.join(', ')

const validateUrl: TextFieldSingleValidation = (value) => {
  if (typeof value !== 'string' || !value.trim()) return 'Enter the URL of the content to embed.'
  if (toEmbed(value)) return true
  return `This URL can't be embedded. Supported: ${supported}. Paste the public https link (for Google Maps, the "Embed a map" link).`
}

export const EmbedConfig = defineBlock({
  meta: embedMeta,
  interfaceName: 'EmbedBlock',
  thumbnail: embedThumbnail,
  fields: [
    {
      name: 'url',
      type: 'text',
      label: 'URL',
      required: true,
      validate: validateUrl,
      admin: {
        description: `Link to the content. Supported: YouTube, Vimeo, Loom, Spotify (track, album, playlist, episode, show), Google Maps (the "Embed a map" link from Share) and Calendly. https only; other sites are not embedded.`,
      },
    },
    {
      name: 'title',
      type: 'text',
      required: true,
      admin: {
        description:
          'Describes the embed for screen readers (for example "Product walkthrough"). Not shown on the page.',
      },
    },
    {
      name: 'caption',
      type: 'text',
      admin: { description: 'Optional line shown below the embed.' },
    },
  ],
})
