import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Component tests are .tsx and opt into jsdom with `// @vitest-environment jsdom`.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
})
