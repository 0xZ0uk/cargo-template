import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { defineConfig, type Options } from 'tsup'

const shared: Partial<Options> = {
  format: ['esm'],
  dts: true,
  sourcemap: false,
  splitting: false,
  treeshake: true,
  target: 'es2022',
  // Payload, its UI and React come from the host (one copy each). The admin component is an
  // import-map path the host resolves, so the server bundle never imports it.
  external: ['payload', /^payload\//, '@payloadcms/ui', /^@payloadcms\/ui\//, 'react', 'react-dom', 'react/jsx-runtime'],
}

/** esbuild drops module-level 'use client' and moves CSS imports into a sibling .css file. */
function addClientBanner(file: string) {
  const css = file.replace(/\.js$/, '.css')
  const cssImport = existsSync(css) ? `import "./${css.split('/').pop()}";\n` : ''
  writeFileSync(file, `"use client";\n${cssImport}${readFileSync(file, 'utf8')}`)
}

export default defineConfig([
  // Server: the plugin (fields, hooks, endpoint, experiments collection).
  { ...shared, entry: { index: 'src/index.ts' }, clean: false },
  // Storage adapter, imported by both the Payload config and the request resolver.
  { ...shared, entry: { 'adapters/payloadGlobal/index': 'src/adapters/payloadGlobal/index.ts' }, clean: false },
  // Request resolver: Web Request in, routing decision and cookies out. No Payload import.
  { ...shared, entry: { 'middleware/index': 'src/middleware/index.ts' }, clean: false },
  // Client components.
  {
    ...shared,
    entry: { 'analytics/client': 'src/analytics/client.ts' },
    clean: false,
    onSuccess: async () => addClientBanner('dist/analytics/client.js'),
  },
  {
    ...shared,
    entry: { 'admin/VariantsField': 'src/admin/components/VariantsField.tsx' },
    clean: false,
    onSuccess: async () => addClientBanner('dist/admin/VariantsField.js'),
  },
])
