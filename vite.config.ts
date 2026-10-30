import { cloudflare } from '@cloudflare/vite-plugin'
import { withPayload } from '@payloadcms/tanstack-start'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
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

// `vite dev` runs on Node (with Wrangler's binding proxy). Builds and `pnpm preview` run
// in workerd, the same runtime as production.
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
            if (source === 'payload' && ['rsc', 'ssr'].includes(this.environment.name)) {
              return payloadServerEntry
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
        useCloudflareRuntime &&
          cloudflare({
            // Keep `pnpm preview` on local D1/R2 even though D1 is marked `remote` for migrations.
            remoteBindings: false,
            viteEnvironment: {
              childEnvironments: ['rsc'],
              name: 'ssr',
            },
          }),
        rsc(pluginOptions.rsc),
        tanstackStart(pluginOptions.tanstackStart),
        viteReact(pluginOptions.react),
      ],
      resolve: {
        alias: {
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
