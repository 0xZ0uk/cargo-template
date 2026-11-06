import { withPayload } from '@payloadcms/tanstack-start'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { varlockCloudflareVitePlugin } from '@varlock/cloudflare-integration'
import viteReact from '@vitejs/plugin-react'
import rsc from '@vitejs/plugin-rsc'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type ConfigEnv } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const payloadServerEntry = realpathSync(
  path.resolve(__dirname, 'node_modules/payload/dist/index.js'),
)

// `@payloadcms/storage-r2` lazily imports the AWS S3 client for `copyFile`, which only runs
// when `r2Storage` gets `copyCredentials` (this app doesn't pass them). Bundled anyway, the
// SDK adds ~1.7 MB of chunks to the Worker. In the Workers build both imports resolve to a
// stub that throws. Remove this if you pass `copyCredentials`.
const AWS_COPY_STUB_ID = '\0r2-copy-file-stub'
const AWS_COPY_IMPORTS = new Set(['@aws-sdk/client-s3', '@payloadcms/storage-s3/copy-file'])
const AWS_COPY_STUB = `
const unavailable = () => {
  throw new Error('R2 file copy is not bundled in this Worker (see AWS_COPY_STUB in vite.config.ts).')
}
export class S3 { constructor() { unavailable() } }
export const copyS3File = unavailable
`

// `vite dev` runs on Node (with Wrangler's binding proxy), and `varlock run` loads its env.
// Builds and `pnpm preview` run in workerd, the same runtime as production.
const isCloudflareRuntime = (env: ConfigEnv) =>
  env.command === 'build' || process.env.CLOUDFLARE_RUNTIME === 'true'

const payloadConfig = withPayload(
  ({ env, pluginOptions }) => {
    const useCloudflareRuntime = isCloudflareRuntime(env)

    return {
      plugins: [
        useCloudflareRuntime && {
          name: 'payload-cloudflare-server-entry',
          enforce: 'pre',
          resolveId(source) {
            if (!['rsc', 'ssr'].includes(this.environment.name)) {
              return
            }
            if (source === 'payload') {
              return payloadServerEntry
            }
            if (AWS_COPY_IMPORTS.has(source)) {
              return AWS_COPY_STUB_ID
            }
          },
          load(id) {
            if (id === AWS_COPY_STUB_ID) {
              return AWS_COPY_STUB
            }
          },
          // workerd does not define `import.meta.url` for bundled modules. These code paths
          // are CLI-only, so a placeholder URL is enough to keep them from throwing on load.
          transform(code) {
            if (!['rsc', 'ssr'].includes(this.environment.name)) {
              return
            }

            const transformed = code
              .replaceAll(
                'createRequire(import.meta.url)',
                "createRequire(typeof import.meta.url === 'string' ? import.meta.url : 'file:///worker/index.js')",
              )
              .replaceAll(
                'fileURLToPath(import.meta.url)',
                "fileURLToPath(typeof import.meta.url === 'string' ? import.meta.url : 'file:///worker/index.js')",
              )

            if (transformed !== code) {
              return transformed
            }
          },
        },
        // Wraps `@cloudflare/vite-plugin`: validates `.env.schema` and passes the resolved env
        // to workerd as vars and secrets.
        useCloudflareRuntime &&
          varlockCloudflareVitePlugin({
            // Keep `pnpm preview` on local D1/R2 even though D1 is marked `remote` for migrations.
            remoteBindings: false,
            viteEnvironment: {
              childEnvironments: ['rsc'],
              name: 'ssr',
            },
          }),
        // Only processes CSS that imports Tailwind (the frontend stylesheet), so the admin
        // panel's styles are untouched.
        tailwindcss(),
        rsc(pluginOptions.rsc),
        tanstackStart(pluginOptions.tanstackStart),
        viteReact(pluginOptions.react),
      ],
      // The on-page editor's rich-text chunk (packages/onpage/lexical) loads lazily, so Vite's
      // dev server would only discover Lexical on an editor's first rich-text click, then
      // re-bundle and reload the page mid-edit. Listing it up front avoids that. Dev only.
      optimizeDeps: {
        include: [
          'lexical',
          '@lexical/list',
          '@lexical/react/LexicalComposer',
          '@lexical/react/LexicalComposerContext',
          '@lexical/react/LexicalContentEditable',
          '@lexical/react/LexicalErrorBoundary',
          '@lexical/react/LexicalHistoryPlugin',
          '@lexical/react/LexicalListPlugin',
          '@lexical/react/LexicalRichTextPlugin',
          '@lexical/rich-text',
          '@lexical/selection',
          '@lexical/utils',
        ],
      },
      resolve: {
        alias: {
          // The assistant's Durable Object classes (re-exported by src/server.ts) need workerd's
          // `cloudflare:workers`; on Node, a stub (the dev server keeps conversations in memory).
          ...(useCloudflareRuntime
            ? {}
            : {
                '@cargo/payload-plugin-assistant/do': path.resolve(
                  __dirname,
                  'src/runtime/assistantDurableObjects.node.ts',
                ),
              }),
          '#cloudflare-runtime': path.resolve(
            __dirname,
            useCloudflareRuntime ? 'src/runtime/cloudflare.ts' : 'src/runtime/node.ts',
          ),
          '@/': `${path.resolve(__dirname, 'src')}/`,
        },
      },
      server: {
        port: 3000,
        warmup: {
          clientFiles: [
            './src/app/__root.tsx',
            './src/app/_payload.tsx',
            './src/app/_payload/admin.index.tsx',
            './src/app/_payload/admin.$.tsx',
          ],
        },
      },
    }
  },
  {
    devServerExternalPackages: ['esbuild', 'undici', 'wrangler', 'ws'],
    payloadConfigPath: path.resolve(__dirname, 'src', 'payload.config.ts'),
  },
)

export default defineConfig((env) => {
  const config = payloadConfig(env)

  if (isCloudflareRuntime(env)) {
    if (config.ssr) {
      delete config.ssr.external
    }

    // workerd has no Node module loader, so both server environments must bundle the
    // packages Payload normally leaves external.
    for (const name of ['rsc', 'ssr'] as const) {
      const environment = config.environments?.[name]
      if (environment?.build?.rollupOptions) {
        delete environment.build.rollupOptions.external
      }
      if (environment?.resolve) {
        delete environment.resolve.external
      }
    }
  }

  return config
})
