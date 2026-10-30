import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
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
import { limitVersions } from './plugins/limitVersions'

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

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media, Folders, Tags],
  editor: lexicalEditor(),
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
      mcp: {
        serverOptions: { serverInfo: { name: 'Cargo Template' } },
      },
    }),
    limitVersions({ max: 20 }),
  ],
})
