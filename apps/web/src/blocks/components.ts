/**
 * Client registry: the component for each block type. Typed against the generated `Page`
 * type, so a block in the config without a component here (or the other way round) fails
 * `pnpm web typecheck`.
 */
import type React from 'react'

import type { Page } from '@/payload-types'

import { ColumnsBlock } from './Columns/Component'
import { CtaBlock } from './Cta/Component'
import { EmbedBlock } from './Embed/Component'
import { FaqBlock } from './Faq/Component'
import { FeatureRowsBlock } from './FeatureRows/Component'
import { FeaturesBlock } from './Features/Component'
import { GalleryBlock } from './Gallery/Component'
import { GlobalSectionBlock } from './GlobalSection/Component'
import { HeroBlock } from './Hero/Component'
import { LogosBlock } from './Logos/Component'
import { MediaBlock } from './MediaBlock/Component'
import { PageHeaderBlock } from './PageHeader/Component'
import { PricingBlock } from './Pricing/Component'
import { ReviewsBlock } from './Reviews/Component'
import { RichTextBlock } from './RichText/Component'
import { StatsBlock } from './Stats/Component'
import { StepsBlock } from './Steps/Component'
import { TestimonialsBlock } from './Testimonials/Component'

export type LayoutBlock = NonNullable<Page['layout']>[number]
export type LayoutBlockType = LayoutBlock['blockType']

export type BlockComponents = {
  [K in LayoutBlockType]: React.ComponentType<Extract<LayoutBlock, { blockType: K }>>
}

export const blockComponents: BlockComponents = {
  hero: HeroBlock,
  pageHeader: PageHeaderBlock,
  richText: RichTextBlock,
  faq: FaqBlock,
  features: FeaturesBlock,
  featureRows: FeatureRowsBlock,
  steps: StepsBlock,
  testimonials: TestimonialsBlock,
  reviews: ReviewsBlock,
  logos: LogosBlock,
  stats: StatsBlock,
  cta: CtaBlock,
  pricing: PricingBlock,
  mediaBlock: MediaBlock,
  gallery: GalleryBlock,
  embed: EmbedBlock,
  columns: ColumnsBlock,
  globalSection: GlobalSectionBlock,
}
