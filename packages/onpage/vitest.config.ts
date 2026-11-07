import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const src = (pkg: string, file = 'index.ts') =>
  fileURLToPath(new URL(`./${pkg}/src/${file}`, import.meta.url))

// Tests run against source, not dist: no build step, and coverage maps to src.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@shipment\/onpage-core$/, replacement: src('core') },
      { find: /^@shipment\/onpage-core\/payload$/, replacement: src('core', 'payload.ts') },
      { find: /^@shipment\/onpage-core\/testing$/, replacement: src('core', 'testing.ts') },
      { find: /^@shipment\/onpage-plugin$/, replacement: src('plugin') },
      { find: /^@shipment\/onpage-plugin\/admin$/, replacement: src('plugin', 'admin/index.ts') },
      { find: /^@shipment\/onpage-react$/, replacement: src('react') },
      { find: /^@shipment\/onpage-react\/annotations$/, replacement: src('react', 'annotations.ts') },
      { find: /^@shipment\/onpage-react\/client$/, replacement: src('react', 'OnPageClient.tsx') },
      { find: /^@shipment\/onpage-react\/editor-kit$/, replacement: src('react', 'editor-kit.ts') },
      { find: /^@shipment\/onpage-react\/locales\/(.+)$/, replacement: src('react', 'locales/$1.ts') },
      { find: /^@shipment\/onpage-lexical$/, replacement: src('lexical') },
      { find: /^@shipment\/onpage-lexical\/editor$/, replacement: src('lexical', 'editor.ts') },
      { find: /^@shipment\/onpage-tanstack-start$/, replacement: src('tanstack-start', 'index.tsx') },
      {
        find: /^@shipment\/onpage-tanstack-start\/client$/,
        replacement: src('tanstack-start', 'client.tsx'),
      },
      {
        find: /^@shipment\/onpage-tanstack-start\/session$/,
        replacement: src('tanstack-start', 'session.server.ts'),
      },
    ],
  },
  test: {
    include: ['*/src/**/__tests__/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/__tests__/**',
        '**/index.ts',
        '**/*.d.ts',
        '**/types.ts',
        '**/ports.ts',
        '**/schema.ts',
      ],
      reporter: ['text-summary'],
      // Per-package gates (lines), as upstream set them.
      thresholds: {
        'core/src/**': { lines: 90 },
        'plugin/src/**': { lines: 90 },
        'react/src/**': { lines: 85 },
        'lexical/src/**': { lines: 80 },
        'tanstack-start/src/**': { lines: 80 },
      },
    },
  },
})
