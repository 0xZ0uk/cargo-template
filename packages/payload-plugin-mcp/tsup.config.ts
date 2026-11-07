import { readFileSync, writeFileSync } from 'node:fs'
import { defineConfig, type Options } from 'tsup'

const shared: Partial<Options> = {
  format: ['esm'],
  dts: true,
  sourcemap: false,
  treeshake: true,
  target: 'es2022',
  removeNodeProtocol: false,
  // One copy of Payload and React, from the host.
  external: ['payload', /^payload\//, 'react', 'react/jsx-runtime'],
}

export default defineConfig([
  {
    ...shared,
    entry: {
      index: 'src/index.ts',
      internal: 'src/exports/internal.ts',
      // Framework-free helpers for the site-root `/.well-known/*` routes (no Payload import).
      'well-known': 'src/exports/wellKnown.ts',
    },
    clean: true,
    splitting: true,
  },
  // The admin view (import map path `@cargo/payload-plugin-mcp/client#OAuthContinueView`).
  // esbuild drops the module-level 'use client', so it is added back.
  {
    ...shared,
    entry: { client: 'src/exports/client.tsx' },
    clean: false,
    splitting: false,
    onSuccess: async () => {
      const file = 'dist/client.js'
      writeFileSync(file, `"use client";\n${readFileSync(file, 'utf8')}`)
    },
  },
])
