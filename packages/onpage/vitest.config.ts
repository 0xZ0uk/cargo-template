import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const src = (pkg: string, file = 'index.ts') =>
  fileURLToPath(new URL(`./${pkg}/src/${file}`, import.meta.url))

// Tests run against source, not dist: no build step, and coverage maps to src.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@cargo\/onpage-core$/, replacement: src('core') },
      { find: /^@cargo\/onpage-core\/payload$/, replacement: src('core', 'payload.ts') },
      { find: /^@cargo\/onpage-core\/testing$/, replacement: src('core', 'testing.ts') },
      { find: /^@cargo\/onpage-plugin$/, replacement: src('plugin') },
      { find: /^@cargo\/onpage-plugin\/admin$/, replacement: src('plugin', 'admin/index.ts') },
      { find: /^@cargo\/onpage-react$/, replacement: src('react') },
      { find: /^@cargo\/onpage-react\/annotations$/, replacement: src('react', 'annotations.ts') },
      { find: /^@cargo\/onpage-react\/client$/, replacement: src('react', 'OnPageClient.tsx') },
      { find: /^@cargo\/onpage-react\/editor-kit$/, replacement: src('react', 'editor-kit.ts') },
      { find: /^@cargo\/onpage-react\/locales\/(.+)$/, replacement: src('react', 'locales/$1.ts') },
      { find: /^@cargo\/onpage-lexical$/, replacement: src('lexical') },
      { find: /^@cargo\/onpage-lexical\/editor$/, replacement: src('lexical', 'editor.ts') },
      { find: /^@cargo\/onpage-tanstack-start$/, replacement: src('tanstack-start', 'index.tsx') },
      {
        find: /^@cargo\/onpage-tanstack-start\/client$/,
        replacement: src('tanstack-start', 'client.tsx'),
      },
      {
        find: /^@cargo\/onpage-tanstack-start\/session$/,
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
