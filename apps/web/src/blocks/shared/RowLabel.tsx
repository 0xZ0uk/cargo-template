'use client'
import { type RowLabelProps, useRowLabel } from '@payloadcms/ui'

/** Fields that name a row, in the order they're tried. */
const labelKeys = [
  'title',
  'name',
  'question',
  'label',
  'value',
  'feature',
  'author',
  'caption',
] as const

const textOf = (data: unknown): string | undefined => {
  if (!data || typeof data !== 'object') return undefined
  const row = data as Record<string, unknown>

  for (const key of labelKeys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  // Links (`link` group) are named by their label.
  const link = row.link as Record<string, unknown> | undefined
  return typeof link?.label === 'string' && link.label.trim() ? link.label.trim() : undefined
}

/**
 * Row label for block arrays (added to every array by `defineBlock`): the row's title, name,
 * question… instead of "Item 01", so collapsed rows stay recognisable.
 */
export const RowLabel: React.FC<RowLabelProps> = () => {
  const { data, rowNumber } = useRowLabel<unknown>()
  const text = textOf(data)
  const number = String((rowNumber ?? 0) + 1).padStart(2, '0')

  return <span>{text ? `${number} · ${text}` : `Row ${number}`}</span>
}
