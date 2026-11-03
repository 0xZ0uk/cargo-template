import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The admin UI must build URLs from `useSeoApi()` / `usePayloadApi()` /
// `formatAdminURL()`: a literal path ignores a custom `routes.api`, `routes.admin`
// and the plugin's `endpointBasePath`.

const SRC = join(import.meta.dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

const FORBIDDEN = [
  { pattern: /['"`]\/api\/seo-plugin/, why: "build plugin URLs with useSeoApi() (hooks/useSeoApi.ts)" },
  { pattern: /['"`]\/api\/\$\{/, why: 'build Payload REST URLs with usePayloadApi() (hooks/useSeoApi.ts)' },
  { pattern: /['"`]\/admin(\/|['"`])/, why: 'build admin links with formatAdminURL({ adminRoute, path })' },
]

describe('admin UI has no hard-coded API or admin paths', () => {
  for (const dir of ['components', 'views']) {
    const files = sourceFiles(join(SRC, dir))
    it(`src/${dir} (${files.length} files)`, () => {
      expect(files.length).toBeGreaterThan(0)
      const offenders: string[] = []
      for (const file of files) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            for (const { pattern, why } of FORBIDDEN) {
              if (pattern.test(line)) offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}: ${line.trim()}  → ${why}`)
            }
          })
      }
      expect(offenders).toEqual([])
    })
  }
})
