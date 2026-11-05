import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full)
    return /\.(css|tsx?)$/.test(entry.name) ? [full] : []
  })
}

// Payload 4 removed the v3 admin tokens (`--theme-elevation-*`, `--theme-text`,
// `--theme-input-bg`, `--style-radius-*`, `--font-mono`…). A `var()` of one resolves to
// nothing (or its hard-coded fallback), which breaks dark mode. Use the v4 tokens
// (`--color-*`, `--field-color-*`, `--radius-*`, `--text-mono-family`).
describe('Payload 4 admin tokens', () => {
  it('no Payload 3 theme tokens in styles or inline styles', () => {
    const offenders = sourceFiles(SRC).flatMap((file) => {
      const code = fs.readFileSync(file, 'utf8')
      return [...code.matchAll(/var\(--((?:theme|style|font)-[a-z0-9-]+)/g)].map(
        (m) => `${path.relative(SRC, file)}: --${m[1]}`,
      )
    })
    expect(offenders).toEqual([])
  })
})
