import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

// Host bundlers (Vite, webpack) resolve every literal dynamic import at build time. An
// optional package the host didn't install (e.g. `sharp`) then breaks the whole admin
// bundle, whatever ignore comments sit next to it. Optional imports must use a variable.
describe('optional dynamic imports', () => {
  it('no literal dynamic import of a bare package outside node: builtins', () => {
    const offenders = sourceFiles(SRC).flatMap((file) => {
      const code = fs.readFileSync(file, 'utf8')
      const matches = code.matchAll(/import\(\s*(?:\/\*[\s\S]*?\*\/\s*)*['"]([^'"]+)['"]\s*\)/g)
      return [...matches]
        .map((m) => m[1])
        .filter((spec) => !spec.startsWith('.') && !spec.startsWith('node:'))
        .map((spec) => `${path.relative(SRC, file)}: ${spec}`)
    })
    expect(offenders).toEqual([])
  })
})
