/**
 * Server registry: every block's Payload config, in block-picker order (the picker groups them
 * by `meta.group`). `payload.config.ts` registers them once (`blocks`), and blocks fields list
 * them by slug, so Pages and Sections share one definition.
 *
 * Adding a block: create `src/blocks/<Name>/` (see `RichText/` and the "Page blocks" section of
 * AGENTS.md), then add it here, in `./components.ts` and in `./gallery.ts`.
 */
import type { Block, BlockSlug } from 'payload'

import { ColumnsConfig } from './Columns/config'
import { CtaConfig } from './Cta/config'
import { EmbedConfig } from './Embed/config'
import { FaqConfig } from './Faq/config'
import { FeatureRowsConfig } from './FeatureRows/config'
import { FeaturesConfig } from './Features/config'
import { GalleryConfig } from './Gallery/config'
import { GlobalSectionConfig } from './GlobalSection/config'
import { HeroConfig } from './Hero/config'
import { LogosConfig } from './Logos/config'
import { MediaBlockConfig } from './MediaBlock/config'
import { PageHeaderConfig } from './PageHeader/config'
import { PricingConfig } from './Pricing/config'
import { ReviewsConfig } from './Reviews/config'
import { RichTextConfig } from './RichText/config'
import { StatsConfig } from './Stats/config'
import { StepsConfig } from './Steps/config'
import { TestimonialsConfig } from './Testimonials/config'

export const blocks: Block[] = [
  HeroConfig,
  PageHeaderConfig,
  RichTextConfig,
  FaqConfig,
  FeaturesConfig,
  FeatureRowsConfig,
  StepsConfig,
  TestimonialsConfig,
  ReviewsConfig,
  LogosConfig,
  StatsConfig,
  CtaConfig,
  PricingConfig,
  MediaBlockConfig,
  GalleryConfig,
  EmbedConfig,
  ColumnsConfig,
  GlobalSectionConfig,
]

/** Blocks that can't go inside a reusable section (they'd nest sections in sections). */
const pageOnly = new Set<string>(['globalSection'])

/** Slugs for a page's `layout`, in picker order. */
export const pageBlockSlugs = blocks.map(({ slug }) => slug as BlockSlug)

/** Slugs for a reusable section's `layout` (Sections collection). */
export const sectionBlockSlugs = pageBlockSlugs.filter((slug) => !pageOnly.has(slug))
