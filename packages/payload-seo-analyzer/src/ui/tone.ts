/**
 * Semantic tones for scores and statuses, mapped onto Payload 4 design tokens.
 *
 * Components pick a tone from data (score, status) and render it through a class
 * (`seo-text--success`, `seo-stat--warning`…) or a Payload Pill style. Never map data to
 * a raw color: the tokens switch between the light and dark admin themes.
 */

import type { Pill } from '@payloadcms/ui'
import type React from 'react'

type PillProps = React.ComponentProps<typeof Pill>

export type Tone = 'success' | 'warning' | 'danger' | 'brand' | 'neutral'

export interface ScoreThresholds {
  /** Score at or above which the tone is `success`. Default 80. */
  good?: number
  /** Score at or above which the tone is `warning` (below: `danger`). Default 50. */
  ok?: number
}

/** Tone for a 0–100 score. */
export function scoreTone(score: number | null | undefined, thresholds: ScoreThresholds = {}): Tone {
  if (score === null || score === undefined || Number.isNaN(score)) return 'neutral'
  const { good = 80, ok = 50 } = thresholds
  if (score >= good) return 'success'
  if (score >= ok) return 'warning'
  return 'danger'
}

/** Tone for an analyzer check status (`pass` / `warning` / `fail` / anything else). */
export function statusTone(status: string | null | undefined): Tone {
  switch (status) {
    case 'pass':
    case 'good':
    case 'ok':
    case 'success':
      return 'success'
    case 'warning':
    case 'warn':
    case 'needs-work':
      return 'warning'
    case 'fail':
    case 'error':
    case 'critical':
    case 'poor':
      return 'danger'
    default:
      return 'neutral'
  }
}

/** Tone for a value that must fall inside [min, max] (character counts, densities). */
export function rangeTone(value: number, min: number, max: number): Tone {
  if (value === 0) return 'neutral'
  if (value >= min && value <= max) return 'success'
  if (value < min) return 'warning'
  return 'danger'
}

const PILL_STYLE: Record<Tone, NonNullable<PillProps['pillStyle']>> = {
  success: 'success',
  warning: 'warning',
  danger: 'error',
  brand: 'dark',
  neutral: 'light',
}

/** Payload `Pill` style for a tone. */
export function pillStyle(tone: Tone): NonNullable<PillProps['pillStyle']> {
  return PILL_STYLE[tone]
}

const BANNER_TYPE: Record<Tone, 'brand' | 'danger' | 'default' | 'success' | 'warning'> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  brand: 'brand',
  neutral: 'default',
}

/** Payload `Banner` type for a tone. */
export function bannerType(tone: Tone): 'brand' | 'danger' | 'default' | 'success' | 'warning' {
  return BANNER_TYPE[tone]
}

/** Token for text in a tone, for the rare inline style (SVG text, computed styles). */
export const TONE_TEXT: Record<Tone, string> = {
  success: 'var(--color-text-success)',
  warning: 'var(--color-text-warning)',
  danger: 'var(--color-text-danger)',
  brand: 'var(--color-text-brand)',
  neutral: 'var(--color-text-secondary)',
}

/** Token for marks (icons, chart strokes and fills, dots) in a tone. */
export const TONE_MARK: Record<Tone, string> = {
  success: 'var(--color-icon-success)',
  warning: 'var(--color-icon-warning)',
  danger: 'var(--color-icon-danger)',
  brand: 'var(--color-icon-brand)',
  neutral: 'var(--color-icon-secondary)',
}

/** Token for a tinted background in a tone (row highlights, callouts). */
export const TONE_BG: Record<Tone, string> = {
  success: 'var(--color-bg-success-tertiary)',
  warning: 'var(--color-bg-warning-tertiary)',
  danger: 'var(--color-bg-danger-tertiary)',
  brand: 'var(--color-bg-brand-tertiary)',
  neutral: 'var(--color-bg-secondary)',
}

/**
 * Ordered series colors for charts with several categories (link graph collections,
 * multi-line charts). All theme tokens, so they adapt to dark mode.
 */
export const CHART_COLORS: readonly string[] = [
  'var(--color-icon-brand)',
  'var(--color-icon-success)',
  'var(--color-icon-warning)',
  'var(--color-icon-danger)',
  'var(--color-icon-secondary)',
  'var(--color-icon-tertiary)',
]

/** Joins class names, skipping falsy entries. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ')
}
