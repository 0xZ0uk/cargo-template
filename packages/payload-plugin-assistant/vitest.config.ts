import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/workerd/**', 'node_modules/**'],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
})
