/**
 * The content elements a column holds. Plain Payload blocks defined here, not in the global
 * registry (`defineBlock`): elements only exist inside Columns and never nest further.
 */
import type { Block } from 'payload'

import { link } from '@/fields/link'
import { linkGroup } from '@/fields/linkGroup'

import { blockRichText, iconField, mediaField } from '../shared/fields'

const svgDataUri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg.trim())}`

// 480×320 wireframes, same style as the block thumbnails. No text.
const svg = (shapes: string) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320" fill="none">
  <rect width="480" height="320" fill="#ffffff"/>
  ${shapes}
</svg>
`

const textThumbnail = svg(`
  <rect x="80" y="64" width="200" height="18" rx="4" fill="#404040"/>
  <rect x="80" y="108" width="320" height="8" rx="4" fill="#d4d4d4"/>
  <rect x="80" y="126" width="300" height="8" rx="4" fill="#d4d4d4"/>
  <rect x="80" y="144" width="320" height="8" rx="4" fill="#d4d4d4"/>
  <rect x="80" y="162" width="220" height="8" rx="4" fill="#d4d4d4"/>
  <circle cx="86" cy="198" r="4" fill="#a3a3a3"/>
  <rect x="98" y="194" width="170" height="8" rx="4" fill="#d4d4d4"/>
  <circle cx="86" cy="218" r="4" fill="#a3a3a3"/>
  <rect x="98" y="214" width="140" height="8" rx="4" fill="#d4d4d4"/>
`)

const mediaThumbnail = svg(`
  <rect x="80" y="56" width="320" height="180" rx="10" fill="#e5e5e5"/>
  <path d="M80 214l90-70 70 52 56-36 104 66v10a10 10 0 0 1-10 10H90a10 10 0 0 1-10-10z" fill="#d4d4d4"/>
  <circle cx="340" cy="100" r="16" fill="#a3a3a3"/>
  <rect x="80" y="256" width="180" height="8" rx="4" fill="#a3a3a3"/>
`)

const buttonsThumbnail = svg(`
  <rect x="80" y="130" width="140" height="48" rx="10" fill="#404040"/>
  <rect x="236" y="130" width="140" height="48" rx="10" fill="#ffffff" stroke="#a3a3a3" stroke-width="3"/>
`)

const cardThumbnail = svg(`
  <rect x="80" y="64" width="320" height="192" rx="14" fill="#ffffff" stroke="#d4d4d4" stroke-width="3"/>
  <rect x="112" y="96" width="44" height="44" rx="12" fill="#a3a3a3"/>
  <rect x="112" y="162" width="160" height="14" rx="4" fill="#404040"/>
  <rect x="112" y="190" width="256" height="8" rx="4" fill="#d4d4d4"/>
  <rect x="112" y="208" width="200" height="8" rx="4" fill="#d4d4d4"/>
`)

const thumbnail = (alt: string, shapes: string) => ({
  images: { thumbnail: { alt, url: svgDataUri(shapes) } },
})

export const columnTextElement: Block = {
  slug: 'columnText',
  interfaceName: 'ColumnTextElement',
  labels: { singular: 'Text', plural: 'Text' },
  admin: thumbnail('Text', textThumbnail),
  fields: [
    {
      name: 'richText',
      type: 'richText',
      editor: blockRichText(),
      label: false,
      required: true,
    },
  ],
}

export const columnMediaElement: Block = {
  slug: 'columnMedia',
  interfaceName: 'ColumnMediaElement',
  labels: { singular: 'Media', plural: 'Media' },
  admin: thumbnail('Media', mediaThumbnail),
  fields: [
    mediaField(),
    {
      name: 'caption',
      type: 'text',
      admin: { description: 'Optional line shown under the media.' },
    },
  ],
}

export const columnButtonsElement: Block = {
  slug: 'columnButtons',
  interfaceName: 'ColumnButtonsElement',
  labels: { singular: 'Buttons', plural: 'Buttons' },
  admin: thumbnail('Buttons', buttonsThumbnail),
  fields: [linkGroup({ appearances: ['default', 'outline'], overrides: { maxRows: 3 } })],
}

export const columnCardElement: Block = {
  slug: 'columnCard',
  interfaceName: 'ColumnCardElement',
  labels: { singular: 'Card', plural: 'Cards' },
  admin: thumbnail('Card', cardThumbnail),
  fields: [
    iconField(),
    { name: 'title', type: 'text', required: true },
    { name: 'description', type: 'textarea' },
    {
      name: 'enableLink',
      type: 'checkbox',
      label: 'Make the card a link',
    },
    link({
      appearances: false,
      overrides: {
        admin: { condition: (_, siblingData) => Boolean(siblingData?.enableLink) },
      },
    }),
  ],
}

export const columnElements: Block[] = [
  columnTextElement,
  columnMediaElement,
  columnButtonsElement,
  columnCardElement,
]
