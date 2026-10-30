import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { seoPlugin } from '@payloadcms/plugin-seo'
import type { GenerateTitle, GenerateURL } from '@payloadcms/plugin-seo/types'
import { r2Storage } from '@payloadcms/storage-r2'
import path from 'path'
import { buildConfig } from 'payload'
import type { PayloadLogger } from 'payload'
import { fileURLToPath } from 'url'

import { cloudflareEnv as cloudflare, isWorkersRuntime } from '#cloudflare-runtime'
import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Folders } from './collections/Folders'
import { Tags } from './collections/Tags'
import { Pages } from './collections/Pages'
import { Footer } from './Footer/config'
import { Header } from './Header/config'
import { defaultLexical } from './fields/defaultLexical'
import type { Page } from './payload-types'
import { limitVersions } from './plugins/limitVersions'
import { pagePath } from './utilities/pagePath'
import { siteName } from './utilities/siteName'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// Payload's default pino logger doesn't suit Workers; emit one JSON line per entry so
// Workers Logs can index the fields.
const createLog =
  (level: string, write: typeof console.log) =>
  (objectOrMessage: object | string, message?: string) => {
    const entry =
      typeof objectOrMessage === 'string'
        ? { level, msg: objectOrMessage }
        : {
            level,
            ...objectOrMessage,
            msg: message ?? (objectOrMessage as { msg?: string }).msg,
          }

    write(JSON.stringify(entry))
  }

const cloudflareLogger = {
  debug: createLog('debug', console.debug),
  error: createLog('error', console.error),
  fatal: createLog('fatal', console.error),
  info: createLog('info', console.log),
  level: process.env.PAYLOAD_LOG_LEVEL || 'info',
  silent: () => undefined,
  trace: createLog('trace', console.debug),
  warn: createLog('warn', console.warn),
} as unknown as PayloadLogger

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
  collections: [Pages, Users, Media, Folders, Tags],
  editor: defaultLexical,
  globals: [Header, Footer],
  secret: process.env.PAYLOAD_SECRET || cloudflare.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: sqliteD1Adapter({
    binding: cloudflare.D1,
    migrationDir: path.resolve(dirname, 'db/migrations'),
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
    // Serves MCP at POST /api/mcp. Callers authenticate with a user API key; without one
    // they get no tools, since every tool requires a logged-in user by default.
    mcpPlugin({
      collections: {
        folders: {
          description: 'Folders that organise media in the admin panel.',
        },
        pages: {
          description:
            'Website pages, served at /<slug> (the page with slug "home" is served at /). Built from a hero, layout blocks and SEO meta. Saved as drafts until published.',
        },
        media: {
          description:
            'Uploaded files (images, documents) with alt text, stored in R2. Call getUploadInstructions before uploading.',
        },
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
    }),
    // Fields are added to Pages by hand (the SEO tab), so no `collections` here.
    seoPlugin({
      generateTitle,
      generateURL,
    }),
    limitVersions({ max: 20 }),
  ],
})
