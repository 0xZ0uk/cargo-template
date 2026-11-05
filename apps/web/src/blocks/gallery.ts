/**
 * Every block's metadata (labels, variants, example), for the dev-only `/dev/blocks` gallery
 * and the render tests. Not imported by the site itself, so examples stay out of its bundle.
 */
import type { BlockMeta } from './shared/meta'
import type { LayoutBlockType } from './components'

import { columnsMeta } from './Columns/meta'
import { ctaMeta } from './Cta/meta'
import { embedMeta } from './Embed/meta'
import { faqMeta } from './Faq/meta'
import { featureRowsMeta } from './FeatureRows/meta'
import { featuresMeta } from './Features/meta'
import { galleryMeta } from './Gallery/meta'
import { globalSectionMeta } from './GlobalSection/meta'
import { heroMeta } from './Hero/meta'
import { logosMeta } from './Logos/meta'
import { mediaBlockMeta } from './MediaBlock/meta'
import { pageHeaderMeta } from './PageHeader/meta'
import { pricingMeta } from './Pricing/meta'
import { reviewsMeta } from './Reviews/meta'
import { richTextMeta } from './RichText/meta'
import { statsMeta } from './Stats/meta'
import { stepsMeta } from './Steps/meta'
import { testimonialsMeta } from './Testimonials/meta'

export const blockMetas: { [K in LayoutBlockType]: BlockMeta<unknown> } = {
  hero: heroMeta,
  pageHeader: pageHeaderMeta,
  richText: richTextMeta,
  faq: faqMeta,
  features: featuresMeta,
  featureRows: featureRowsMeta,
  steps: stepsMeta,
  testimonials: testimonialsMeta,
  reviews: reviewsMeta,
  logos: logosMeta,
  stats: statsMeta,
  cta: ctaMeta,
  pricing: pricingMeta,
  mediaBlock: mediaBlockMeta,
  gallery: galleryMeta,
  embed: embedMeta,
  columns: columnsMeta,
  globalSection: globalSectionMeta,
}
