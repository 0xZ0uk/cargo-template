import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createTranslate, defaultMessages, type Messages } from '../messages.ts'

const dir = new URL('../locales/', import.meta.url)
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('UI translations', async () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
  const locales = await Promise.all(
    files.map(async (f) => {
      const mod = (await import(new URL(f, dir).href)) as Record<string, Messages>
      return [f.replace('.ts', ''), Object.values(mod)[0]!] as const
    }),
  )
  it('ship es, fr and de', () => {
    expect(locales.map(([l]) => l).sort()).toEqual(['de', 'es', 'fr'])
  })
  for (const [lang, messages] of locales) {
    it(`${lang}: every message, with the same placeholders; plural forms only for counts`, () => {
      const table = messages as Record<string, string>
      for (const [key, english] of Object.entries(defaultMessages)) {
        expect(table[key], `${lang} ${key}`).toBeTypeOf('string')
        expect(placeholders(table[key]!), `${lang} ${key}`).toEqual(placeholders(english))
      }
      for (const key of Object.keys(table)) {
        if (key in defaultMessages) continue
        const base = key.replace(/\.(zero|one|two|few|many|other)$/, '')
        expect(base, `${lang} ${key}`).not.toBe(key)
        expect(defaultMessages[base as keyof typeof defaultMessages], `${lang} ${key}`).toContain(
          '{count}',
        )
      }
      // Plural forms resolve through the locale's rules.
      const t = createTranslate(messages, lang)
      expect(t('dock.documents', { count: 1 })).toBe(
        table['dock.documents.one']?.replace('{count}', '1'),
      )
      expect(t('dock.documents', { count: 3 })).toBe(
        table['dock.documents']?.replace('{count}', '3'),
      )
    })
  }
})
