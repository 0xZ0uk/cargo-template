import { payloadPluginSocials } from '@cargo/payload-plugin-socials'
import type {
  PayloadPluginSocialsConfig,
  SourceContextResolver,
} from '@cargo/payload-plugin-socials'

import { cloudflareEnv as cloudflare } from '#cloudflare-runtime'
import { pageSocialContext } from '@/utilities/socialsPageSource'

const encryptionKey = process.env.SOCIALS_ENCRYPTION_KEY || cloudflare.SOCIALS_ENCRYPTION_KEY || ''
const previousEncryptionKeys = (
  process.env.SOCIALS_PREVIOUS_ENCRYPTION_KEYS ||
  cloudflare.SOCIALS_PREVIOUS_ENCRYPTION_KEYS ||
  ''
)
  .split(',')
  .map((key) => key.trim())
  .filter(Boolean)

const siteUrl = process.env.SITE_URL || cloudflare.SITE_URL || ''
const pinterestAppId = process.env.PINTEREST_APP_ID || cloudflare.PINTEREST_APP_ID || ''
const pinterestAppSecret = process.env.PINTEREST_APP_SECRET || cloudflare.PINTEREST_APP_SECRET || ''

/**
 * A page's context for the composer. Runs for a logged-in admin user (the plugin's `authorize`
 * has already passed) and from the Cron Trigger (no user), so it reads with the Local API's
 * access override. Without `SITE_URL` (dev, previews) links use the request's origin.
 */
const pageSource: SourceContextResolver = async ({ id, payload, req }) => {
  const page = await payload.findByID({
    id,
    collection: 'pages',
    // Depth 1 populates the SEO image and every block's media (uploads are one level down).
    depth: 1,
    overrideAccess: true,
    req,
  })

  return pageSocialContext(page, siteUrl || req?.origin || '')
}

/**
 * Socials plugin options, shared by `payload.config.ts` and the Cron Trigger (`src/server.ts`
 * passes them to `normalizePluginOptions`, so both must see the same object).
 *
 * - Disabled until `SOCIALS_ENCRYPTION_KEY` is set. The plugin still registers `social-posts`,
 *   `social-templates` and the `socials-connections` global then, and the same admin components
 *   (nav link, `/admin/socials`, dashboard widget, the Socials tab), which show a notice. The
 *   schema, the migration and the import map are the same either way, so none of them needs
 *   secrets.
 * - Pages only (`sources.page`), Pinterest only. Pinterest turns on with its app credentials
 *   and a `SITE_URL` to build the OAuth redirect from. Facebook, Instagram and Google Business
 *   Profile are left out (disabled).
 * - Any logged-in admin user may publish and manage connections; there is no role field.
 * - `assets.autoConvert` / `assets.normalize` stay off: they need sharp, which Workers can't run.
 * - The Cron Trigger runs the queue (`scheduled` in `src/server.ts`), with small drain batches
 *   to fit one invocation's CPU budget.
 */
export const socialsOptions = {
  admin: {
    injectInto: [{ collection: 'pages', sourceKind: 'page' }],
    mode: 'both',
  },
  assets: { autoConvert: false, normalize: false },
  authCollection: 'users',
  authorize: ({ req }) => Boolean(req.user),
  disabled: !encryptionKey,
  encryptionKey,
  platforms: {
    pinterest: {
      clientId: pinterestAppId,
      clientSecret: pinterestAppSecret,
      enabled: Boolean(pinterestAppId && pinterestAppSecret && siteUrl),
      redirectUri: `${siteUrl.replace(/\/+$/, '')}/api/socials/pinterest/oauth/callback`,
    },
  },
  previousEncryptionKeys,
  scheduling: { drainBatchSize: 5 },
  sources: { page: pageSource },
} satisfies PayloadPluginSocialsConfig

export const SocialsPlugin = payloadPluginSocials(socialsOptions)
