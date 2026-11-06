import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as shared from '../shared.js'

const SRC = path.resolve(__dirname, '..')

/** Every module specifier reachable from `file`, following relative imports. */
function reachableSpecifiers(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return []
  seen.add(file)
  const code = readFileSync(file, 'utf8')
  const specs = [...code.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
  const out: string[] = []
  for (const spec of specs) {
    if (!spec.startsWith('.')) {
      out.push(spec)
      continue
    }
    const base = path.resolve(path.dirname(file), spec.replace(/\.js$/, ''))
    const target = ['.ts', '.tsx', '/index.ts'].map((ext) => base + ext).find((f) => {
      try {
        readFileSync(f)
        return true
      } catch {
        return false
      }
    })
    if (target) out.push(...reachableSpecifiers(target, seen))
  }
  return out
}

describe('shared entry', () => {
  it('exports the frontend helpers', () => {
    expect(Object.keys(shared).sort()).toEqual([
      'FRONTEND_REDIRECTS_CACHE_BASE',
      'buildJsonLd',
      'normalizeFromPath',
      'serializeJsonLd',
      'validateRedirectTarget',
    ])
  })

  it('imports no package (Payload, React, Node built-ins) at runtime', () => {
    expect(reachableSpecifiers(path.join(SRC, 'shared.ts'))).toEqual([])
  })
})
