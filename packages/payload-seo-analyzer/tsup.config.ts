import { defineConfig, type Options } from 'tsup'
import { existsSync, writeFileSync, readFileSync } from 'fs'

const CLIENT_BANNER = '"use client";\n'

const sharedConfig: Partial<Options> = {
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: false,
  splitting: false,
  treeshake: true,
  target: 'es2022',
  external: ['payload', '@payloadcms/ui', '@payloadcms/ui/rsc', 'react', 'react-dom', 'react/jsx-runtime', '@cargo/payload-seo-analyzer', '@cargo/payload-seo-analyzer/client'],
}

export default defineConfig([
  // Server entry — analysis engine + plugin
  {
    ...sharedConfig,
    entry: { index: 'src/index.ts' },
    clean: true,
  },
  // Client entry — React components
  // "use client" is prepended via onSuccess because tsup strips module-level directives
  {
    ...sharedConfig,
    entry: { client: 'src/client.ts' },
    clean: false,
    onSuccess: async () => {
      for (const file of ['dist/client.js', 'dist/client.cjs']) {
        const content = readFileSync(file, 'utf-8')
        // esbuild moves `import './ui/styles.css'` into dist/client.css and drops the
        // import. Re-add it to the ESM bundle so Vite / Next load the styles with the
        // components. The CJS bundle stays CSS-free (Node would try to require it);
        // CJS hosts import `@cargo/payload-seo-analyzer/client.css` themselves.
        const cssImport = file.endsWith('.js') && existsSync('dist/client.css') ? 'import "./client.css";\n' : ''
        writeFileSync(file, CLIENT_BANNER + cssImport + content)
      }
      console.log('✓ Prepended "use client" (and the stylesheet import) to client bundles')
    },
  },
  // Views entry — server components with DefaultTemplate (admin layout)
  {
    ...sharedConfig,
    entry: { views: 'src/views.ts' },
    clean: false,
  },
])
