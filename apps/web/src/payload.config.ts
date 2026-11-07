import { onpage } from '@cargo/onpage-plugin'
import { tanstackSession } from '@cargo/onpage-tanstack-start/session'
import { abTestingPlugin } from '@cargo/payload-plugin-ab'
import { assistantPlugin } from '@cargo/payload-plugin-assistant'
import { withMarkdownRichText } from '@cargo/payload-plugin-assistant/mcp'
import { createSqlSeoDataStore, seoAnalyzerPlugin } from '@cargo/payload-seo-analyzer'
import { mcpPlugin } from '@cargo/payload-plugin-mcp'
import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite'
import { seoPlugin } from '@payloadcms/plugin-seo'
import type { GenerateTitle, GenerateURL } from '@payloadcms/plugin-seo/types'
import { r2Storage } from '@payloadcms/storage-r2'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { cloudflareEnv as cloudflare, isWorkersRuntime, waitUntil } from '#cloudflare-runtime'
import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Folders } from './collections/Folders'
import { Tags } from './collections/Tags'
import { Pages } from './collections/Pages'
import { Sections } from './collections/Sections'
import { blocks } from './blocks'
import { Footer } from './Footer/config'
import { Header } from './Header/config'
import { defaultLexical } from './fields/defaultLexical'
import type { Page } from './payload-types'
import { abMeasurementConfig } from './plugins/abMeasurement'
import { abStorage } from './plugins/abTesting'
import { assistantAuditSink, assistantConversations, assistantTestModel } from './plugins/assistant'
import { workersAssistantRateLimit } from './plugins/assistantRateLimit'
import { limitVersions } from './plugins/limitVersions'
import { oauthRateLimit } from './plugins/oauthRateLimit'
import { r2SeoCacheStore } from './plugins/seoCacheStore'
import { workersSeoRateLimit } from './plugins/seoRateLimit'
import { SocialsPlugin } from './plugins/socials'
import { pagePath } from './utilities/pagePath'
import { siteName } from './utilities/siteName'
import { createWorkersLogger } from './utilities/workersLogger'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const cloudflareLogger = createWorkersLogger({ level: process.env.PAYLOAD_LOG_LEVEL || 'info' })

// Payload's secret also seals onpage's edit-mode cookies and preview links.
const secret = process.env.PAYLOAD_SECRET || cloudflare.PAYLOAD_SECRET || ''

const generateTitle: GenerateTitle<Page> = ({ doc }) =>
  doc?.title ? `${doc.title} | ${siteName}` : siteName

const generateURL: GenerateURL<Page> = ({ doc, req }) =>
  `${req.origin}${doc?.slug ? pagePath(doc.slug) : ''}`

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  // Page blocks (src/blocks), defined once and listed by slug in each blocks field.
  blocks,
  collections: [Pages, Sections, Users, Media, Folders, Tags],
  editor: defaultLexical,
  globals: [Header, Footer],
  secret,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  // Blocks are stored as one JSON column per blocks field instead of a table per block and
  // array (two with versions). A block library would otherwise add 100+ tables to D1, all
  // read on every page load.
  db: sqliteD1Adapter({
    binding: cloudflare.D1,
    blocksAsJSON: true,
    migrationDir: path.resolve(dirname, 'db/migrations'),
    // No dev schema push: the local D1 is built from the committed migrations (`pnpm migrate`),
    // like production. Drizzle's push rebuilds changed tables with DROP TABLE, and D1 ignores
    // PRAGMA foreign_keys=OFF, so a push cascade-deletes child rows (locales, rels, versions'
    // parents) and can leave the database half-migrated.
    push: false,
  }),
  // Default is already true; kept explicit because finished jobs (and their logs) would
  // otherwise accumulate in D1.
  jobs: {
    deleteJobOnComplete: true,
  },
  logger: isWorkersRuntime ? cloudflareLogger : undefined,
  localization: {
    locales: [{ code: 'en', label: 'English' }],
    fallback: true,
    defaultLocale: 'en',
  },
  // D1 only stores file metadata. Uploads go to R2 on Workers; the Node dev server writes
  // them to the local `media/` directory instead.
  storage: [
    r2Storage({
      bucket: cloudflare.R2,
      collections: {
        media: true,
      },
      enabled: isWorkersRuntime,
    }),
  ],
  plugins: [
    // Serves MCP at POST /api/mcp (packages/payload-plugin-mcp, our fork of @payloadcms/plugin-mcp).
    // Callers authenticate with a user API key (Claude Code, scripts), the admin's session (the
    // assistant below) or an OAuth access token (`oauth`: ChatGPT and claude.ai, which only connect
    // over OAuth; users approve them on a consent page and revoke them under "AI connections").
    // Without credentials it answers 401 with the OAuth challenge. The discovery documents are also
    // served at the site root by src/app/[.]well-known.$.ts. See README, "MCP".
    // `withMarkdownRichText` (every collection with rich text: Pages and Sections through their
    // blocks, Media's caption): findDocuments shows rich text as Markdown, and
    // setRichTextFromMarkdown writes it, for the assistant and external MCP clients alike.
    mcpPlugin({
      collections: {
        folders: {
          description: 'Folders that organise media in the admin panel.',
        },
        pages: withMarkdownRichText('pages', {
          description:
            'Website pages, served at /<slug> (the page with slug "home" is served at /). Built from layout blocks (sections) and SEO meta. Saved as drafts until published. Pages with `_abVariantOf` set are A/B test variants of that page (slug `<original>--<hash>`), shown to a share of its visitors; they are created, weighted and removed in the admin\'s Variants panel, and `_abVariantOf` / `_abPassPercentage` cannot be written here.',
        }),
        sections: withMarkdownRichText('sections'),
        media: withMarkdownRichText('media', {
          description:
            'Uploaded files (images, documents) with alt text, stored in R2. Call getUploadInstructions before uploading.',
        }),
        tags: {
          description: 'Tags used to label and filter media.',
        },
        users: {
          description: 'Admin panel users.',
          // Account creation and removal stay in the admin panel.
          tools: { create: false, delete: false },
        },
      },
      globals: {
        footer: {
          description: 'Links shown in the website footer (up to 6).',
        },
        header: {
          description: 'Links shown in the website header navigation (up to 6).',
        },
      },
      mcp: {
        serverOptions: { serverInfo: { name: 'Cargo Template' } },
      },
      // The consent page and `resource_name` use the server name above. Every user may connect a
      // client (there are no roles); set `canConnect` to restrict it. Registration is public: the
      // plugin caps pending clients, and this limits it per IP (src/plugins/oauthRateLimit.ts).
      oauth: { rateLimit: oauthRateLimit(cloudflare.OAUTH_RATE_LIMIT_REGISTER) },
    }),
    // Admin assistant (packages/payload-plugin-assistant): /admin/assistant chats with the content
    // through the MCP tools above, as the signed-in user, on OpenRouter (`OPENROUTER_API_KEY`,
    // shared with the SEO analyzer; without it the view says "not configured"). Every write waits
    // for the user's approval on a diff card. Conversations live in Durable Objects, never D1
    // (wrangler.jsonc); the Node dev server keeps them in memory. See the README, "Assistant".
    assistantPlugin({
      models: [{ id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' }],
      apiKey: process.env.OPENROUTER_API_KEY || cloudflare.OPENROUTER_API_KEY || undefined,
      conversations: assistantConversations(cloudflare),
      // Per admin user, shared across isolates. The credit limit on the key is the account-wide cap.
      rateLimit: workersAssistantRateLimit(cloudflare),
      // $5 of OpenRouter cost per admin user per UTC day (counted in the user's index Durable
      // Object); past it, turns get 402 `budget_exceeded` until midnight UTC.
      budget: { dailyCostUsd: 5 },
      // Users' email, API key, sessions and auth state are hidden from the model by default (every
      // auth collection); add other fields here as `{ slug: ['field', 'group.field'] }`.
      // Applied writes go to Analytics Engine (ASSISTANT_AUDIT); see src/plugins/assistant.ts.
      audit: assistantAuditSink(cloudflare),
      // Tests only (Playwright): a scripted model on localhost, never on a deployed Worker.
      testModel: assistantTestModel({
        ASSISTANT_TEST_MODEL: process.env.ASSISTANT_TEST_MODEL || cloudflare.ASSISTANT_TEST_MODEL,
        APP_ENV: process.env.APP_ENV || cloudflare.APP_ENV,
      }),
    }),
    // Fields are added to Pages by hand (the SEO tab), so no `collections` here.
    seoPlugin({
      generateTitle,
      generateURL,
    }),
    // Content analysis on top of the plugin-seo fields: a score sidebar on Pages, a
    // site-wide dashboard at /admin/seo, redirects, and sitemap/robots endpoints under
    // /api/seo-plugin. Time-series features (404 logs, score history, performance imports)
    // store their rows in the separate SEO_D1 database (`dataStore`), pruned daily, and
    // the external link checker scans in budgeted steps; all four passed on a deployed
    // Worker. AI features call OpenRouter (`OPENROUTER_API_KEY`, capped by the key's credit
    // limit in OpenRouter). The alerts digest sends nothing until SEO_ALERT_WEBHOOK_URL or
    // SEO_ALERT_EMAIL is set. GSC stays off until a Google OAuth client exists (it also needs a main-D1
    // migration for `seo-gsc-auth`). Whole-site scans (link graph, keywords,
    // cannibalization…) and IndexNow stay off until the real site exists (GitHub issues #27 and #28).
    seoAnalyzerPlugin({
      collections: ['pages'],
      collectionRoutes: { pages: '' },
      // A/B variants (`_abVariantOf`) are reached through their original's URL, never their
      // own: leave them out of the sitemaps, llms.txt, IndexNow and the whole-site scans. The
      // sidebar still scores a variant an editor opens. Not `noindex` on the variant: its meta
      // is what a visitor bucketed into it gets at the original's URL.
      excludeDocs: (doc) => doc._abVariantOf != null,
      excludeDocsFields: ['_abVariantOf'],
      siteName,
      siteUrl: process.env.SITE_URL || cloudflare.SITE_URL || undefined,
      uploadsCollection: 'media',
      // Workers isolates don't share memory and cancel un-awaited work: the dashboard audit
      // (and the caches the admin polls) persist in R2 and build through `waitUntil`.
      // `waitUntil` is undefined under the Node dev server, which keeps promises alive.
      cacheStore: r2SeoCacheStore(cloudflare.R2),
      waitUntil,
      // Rate limits shared across isolates (Workers Rate Limiting bindings).
      rateLimit: workersSeoRateLimit(cloudflare),
      // Score history, Search Console imports, rank history and 404 logs go to a second D1
      // database, never the main one (AGENTS.md). The plugin creates and migrates its tables
      // there, registers no collections for them, and prunes them daily (retention job).
      dataStore: createSqlSeoDataStore(cloudflare.SEO_D1),
      // Background work as Payload jobs, run by the Cron Trigger (`scheduled` in src/server.ts).
      // With the features below, that's continuing a dashboard audit that paused between steps
      // (plus the retention purge of SEO_D1 once a time-series feature is on).
      jobs: true,
      features: {
        aiFeatures: true,
        alerts: true,
        cannibalization: false,
        duplicateContent: false,
        externalLinks: true,
        gscApi: false,
        indexNow: false,
        keywords: false,
        linkGraph: false,
        performance: true,
        schemaBuilder: true,
        scoreHistory: true,
        seoLogs: true,
        warmCache: false,
      },
    }),
    // A/B testing (packages/payload-plugin-ab): the Variants panel on Pages clones a page into
    // variants and sets each one's share of traffic; `loadPage` routes visitors between them.
    // The manifest (which variants a page has) lives in the hidden `ab-manifest` collection,
    // one row per page path, read through the Cache API (src/plugins/abTesting.ts). Its keys
    // are the paths visitors request, so they come from `pagePath` (`home` → `/`).
    abTestingPlugin({
      storage: abStorage,
      collections: {
        pages: {
          generatePath: ({ doc }) =>
            typeof doc.slug === 'string' && doc.slug ? pagePath(doc.slug) : null,
          // Promoting a variant ("Promote" in the Variants panel) copies its content onto the
          // original's draft; the original keeps its own publish date, "Hide from search engines"
          // setting and cornerstone flag.
          promoteSkipFields: ['publishedAt', 'noindex', 'isCornerstone'],
        },
      },
      // Measurement (src/plugins/abMeasurement.ts): `loadPage` counts impressions and CTA
      // clicks post conversions to `/api/_ab/convert`, both into Workers Analytics Engine;
      // the Variants panel reads results per bucket through its SQL API, once
      // AB_ANALYTICS_ACCOUNT_ID and AB_ANALYTICS_API_TOKEN are set.
      measurement: abMeasurementConfig(cloudflare),
    }),
    // On-page editing (packages/onpage): "Edit on page" in the admin opens the page with an
    // editor, and edits autosave as drafts through Payload's REST API. Pages only: Header and
    // Footer have no drafts, so every keystroke would publish. Comments and saved sections
    // (`comments`, `patterns`) stay off; each adds a collection to the main D1.
    onpage({
      collections: {
        pages: {
          url: ({ doc }) => (typeof doc.slug === 'string' ? pagePath(doc.slug) : null),
          // A/B variants are edited in the Variants panel's drawer, and visitors reach them
          // through the original's URL, so they get no "Edit on page".
          hideEditWhen: '_abVariantOf',
        },
      },
      session: tanstackSession({ secret }),
    }),
    // Social publishing (packages/payload-plugin-socials): a Socials tab on Pages and a
    // composer at /admin/socials, Pinterest only. Disabled until SOCIALS_ENCRYPTION_KEY is set;
    // the schema is the same either way. The Cron Trigger runs its queue (src/server.ts).
    SocialsPlugin,
    // Last, so the cap also covers collections the plugins above add.
    limitVersions({ max: 20 }),
  ],
})
