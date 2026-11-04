// @ts-check
import js from '@eslint/js'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** Package boundaries: modules each package must not import (anchored, so "payload" ≠ "core/payload"). */
const boundary = (names) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          regex: `^(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace('\\*', '.*')).join('|')})(/.*)?$`,
          message: 'Crosses a package boundary (see packages/onpage/README.md).',
        },
      ],
    },
  ],
})

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**', '*.config.*', 'vitest.setup.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: ['./tsconfig.test.json'], tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['core/src/**'],
    rules: boundary([
      'react',
      'react-dom',
      'next',
      'next/*',
      '@tanstack/*',
      'payload',
      '@payloadcms/*',
      '@cargo/onpage-*',
    ]),
  },
  {
    files: ['react/src/**'],
    rules: boundary([
      'next',
      'next/*',
      '@tanstack/*',
      'payload',
      '@payloadcms/*',
      '@cargo/onpage-next*',
      '@cargo/onpage-tanstack-start*',
      '@cargo/onpage-plugin*',
      '@cargo/onpage-lexical*',
    ]),
  },
  {
    files: ['lexical/src/**'],
    rules: boundary([
      'next',
      'next/*',
      '@tanstack/*',
      'payload',
      '@payloadcms/*',
      '@cargo/onpage-next*',
      '@cargo/onpage-tanstack-start*',
      '@cargo/onpage-plugin*',
    ]),
  },
  {
    files: ['plugin/src/**'],
    ignores: ['plugin/src/admin/**'],
    rules: boundary([
      'react',
      'react-dom',
      'next',
      'next/*',
      '@tanstack/*',
      '@payloadcms/ui',
      '@cargo/onpage-react*',
      '@cargo/onpage-next*',
      '@cargo/onpage-tanstack-start*',
      '@cargo/onpage-lexical*',
    ]),
  },
  {
    files: ['tanstack-start/src/**'],
    rules: boundary([
      'payload',
      '@payloadcms/*',
      '@cargo/onpage-plugin*',
      'next',
      'next/*',
      '@cargo/onpage-next*',
    ]),
  },
  {
    files: ['**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // Test doubles implement async ports without awaiting anything.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
)
