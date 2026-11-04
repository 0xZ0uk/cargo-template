import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { defineConfig, type Options } from 'tsup'

const shared: Partial<Options> = {
  format: ['esm'],
  dts: true,
  sourcemap: false,
  splitting: false,
  treeshake: true,
  target: 'es2022',
  // Keep `node:` specifiers: Workers' nodejs_compat and bundlers resolve them unambiguously.
  removeNodeProtocol: false,
  // Payload, its UI, React and sharp come from the host (one copy each); the
  // `client` / `rsc` self-imports are import-map paths, resolved by the host.
  external: [
    'payload',
    /^payload\//,
    '@payloadcms/ui',
    /^@payloadcms\/ui\//,
    'react',
    'react-dom',
    'react/jsx-runtime',
    'sharp',
    /^@cargo\/payload-plugin-socials/,
  ],
}

export default defineConfig([
  // Server entry: plugin, endpoints, platform adapters.
  { ...shared, entry: { index: 'src/index.ts' }, clean: true },
  // Server components (the /admin/socials view).
  { ...shared, entry: { rsc: 'src/exports/rsc.ts' }, clean: false },
  // Client components. esbuild drops module-level 'use client' and moves the CSS
  // import into dist/client.css, so both are added back to the bundle.
  {
    ...shared,
    entry: { client: 'src/exports/client.ts' },
    clean: false,
    onSuccess: async () => {
      const file = 'dist/client.js'
      const css = existsSync('dist/client.css') ? 'import "./client.css";\n' : ''
      writeFileSync(file, `"use client";\n${css}${readFileSync(file, 'utf8')}`)
    },
  },
])
