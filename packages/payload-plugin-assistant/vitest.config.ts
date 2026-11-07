import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // The admin server components import the client entry by package path (a client boundary
    // for the host's bundler); tests resolve it to the source, like tsconfig's `paths`.
    alias: {
      '@shipment/payload-plugin-assistant/client': fileURLToPath(new URL('./src/client.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/workerd/**', 'node_modules/**'],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
})
