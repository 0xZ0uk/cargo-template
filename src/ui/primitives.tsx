'use client'

/**
 * Small building blocks for the plugin's admin UI, for the patterns Payload's own
 * component kit (`@payloadcms/ui`) doesn't cover. Use Payload components first (Button,
 * Pill, Banner, Collapsible, Tabs, Tooltip, Spinner, Drawer, ConfirmationModal…) and
 * these only to fill the gaps. All styling lives in `styles.css` on Payload tokens.
 */

import React from 'react'
import { Pill, Spinner } from '@payloadcms/ui'
import { cx, pillStyle, scoreTone, type ScoreThresholds, type Tone } from './tone.js'

/* ---------- Layout ------------------------------------------------------- */

export interface ViewHeaderProps {
  title: React.ReactNode
  description?: React.ReactNode
  /** Buttons rendered on the right of the title (Payload `Button`s). */
  actions?: React.ReactNode
}

/**
 * Page header for a plugin admin view. Same markup as Payload's collection list header,
 * so the title, spacing and action placement match the built-in views.
 */
export function ViewHeader({ title, description, actions }: ViewHeaderProps) {
  return (
    <header className="list-header">
      <div className="list-header__content">
        <div className="list-header__title-and-actions">
          <h1 className="list-header__title">{title}</h1>
        </div>
        {actions ? <div className="list-header__actions">{actions}</div> : null}
      </div>
      {description ? <p className="seo-view-header__description">{description}</p> : null}
    </header>
  )
}

/** Body of a plugin admin view, below `ViewHeader`: gutters and vertical rhythm. */
export function ViewBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('seo-view', className)}>{children}</div>
}

export interface CardProps {
  title?: React.ReactNode
  /** Right side of the header (Payload `Button`s, `Pill`s). */
  actions?: React.ReactNode
  footer?: React.ReactNode
  /** Body without padding, e.g. for a full-bleed `DataTable`. */
  flush?: boolean
  muted?: boolean
  className?: string
  children?: React.ReactNode
}

/** Bordered section with an optional header. For collapsible sections use Payload's `Collapsible`. */
export function Card({ title, actions, footer, flush, muted, className, children }: CardProps) {
  return (
    <section className={cx('seo-card', muted && 'seo-card--muted', className)}>
      {title || actions ? (
        <div className="seo-card__header">
          {title ? <h3 className="seo-card__title">{title}</h3> : <span className="seo-spacer" />}
          {actions}
        </div>
      ) : null}
      {children !== undefined && children !== null && children !== false ? (
        <div className={cx('seo-card__body', flush && 'seo-card__body--flush')}>{children}</div>
      ) : null}
      {footer ? <div className="seo-card__footer">{footer}</div> : null}
    </section>
  )
}

/* ---------- Data display -------------------------------------------------- */

export interface StatTileProps {
  label: React.ReactNode
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: Tone
}

/** Labelled number for summary rows. Tone colors the value only. */
export function StatTile({ label, value, hint, tone = 'neutral' }: StatTileProps) {
  return (
    <div className={cx('seo-stat', tone !== 'neutral' && `seo-stat--${tone}`)}>
      <span className="seo-stat__value">{value}</span>
      <span className="seo-stat__label">{label}</span>
      {hint ? <span className="seo-stat__hint">{hint}</span> : null}
    </div>
  )
}

/** Responsive grid for `StatTile`s and cards. */
export function Grid({ children, wide, className }: { children: React.ReactNode; wide?: boolean; className?: string }) {
  return <div className={cx('seo-grid', wide && 'seo-grid--wide', className)}>{children}</div>
}

export interface ScorePillProps {
  score: number | null | undefined
  thresholds?: ScoreThresholds
  /** Text after the number, e.g. "/100". */
  suffix?: string
  size?: 'medium' | 'small'
}

/** Score as a Payload `Pill`, colored by its tone. */
export function ScorePill({ score, thresholds, suffix, size = 'small' }: ScorePillProps) {
  const tone = scoreTone(score, thresholds)
  return (
    <Pill pillStyle={pillStyle(tone)} size={size}>
      {score === null || score === undefined ? '—' : Math.round(score)}
      {suffix}
    </Pill>
  )
}

/** A Payload `Pill` in a semantic tone (status labels, tags). */
export function TonePill({ tone, children, size = 'small' }: { tone: Tone; children: React.ReactNode; size?: 'medium' | 'small' }) {
  return (
    <Pill pillStyle={pillStyle(tone)} size={size}>
      {children}
    </Pill>
  )
}

export interface ScoreRingProps {
  score: number | null | undefined
  /** Diameter in px. */
  size?: number
  strokeWidth?: number
  thresholds?: ScoreThresholds
  /** Overrides the number in the middle. */
  label?: React.ReactNode
  'aria-label'?: string
}

/** Circular 0–100 score. */
export function ScoreRing({ score, size = 64, strokeWidth = 6, thresholds, label, ...rest }: ScoreRingProps) {
  const tone = scoreTone(score, thresholds)
  const value = Math.max(0, Math.min(100, score ?? 0))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  return (
    <div
      aria-label={rest['aria-label']}
      className={cx('seo-score-ring', tone !== 'neutral' && `seo-score-ring--${tone}`)}
      role="img"
      style={{ width: size, height: size }}
    >
      <svg aria-hidden="true" height={size} width={size}>
        <circle
          className="seo-score-ring__track"
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          strokeWidth={strokeWidth}
        />
        <circle
          className="seo-score-ring__value"
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
        />
      </svg>
      <span className="seo-score-ring__label">{label ?? (score === null || score === undefined ? '—' : Math.round(score))}</span>
    </div>
  )
}

export interface MeterProps {
  /** Current value. */
  value: number
  /** Value at 100%. Default 100. */
  max?: number
  tone?: Tone
  'aria-label'?: string
  className?: string
}

/** Horizontal progress bar. */
export function Meter({ value, max = 100, tone = 'neutral', className, ...rest }: MeterProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div
      aria-label={rest['aria-label']}
      aria-valuemax={max}
      aria-valuemin={0}
      aria-valuenow={value}
      className={cx('seo-meter', tone !== 'neutral' && `seo-meter--${tone}`, className)}
      role="meter"
    >
      <span className="seo-meter__fill" style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Small colored dot for legends and status lists. */
export function Dot({ tone = 'neutral' }: { tone?: Tone }) {
  return <span aria-hidden="true" className={cx('seo-dot', tone !== 'neutral' && `seo-dot--${tone}`)} />
}

export interface DataTableProps {
  children: React.ReactNode
  /** Accessible name of the table. */
  'aria-label'?: string
  /** Drop the outer border, e.g. when the table already sits in a `Card` with `flush`. */
  bare?: boolean
  className?: string
}

/**
 * Wraps a plain `<table>` in Payload's list-table styles (header row, cell padding,
 * row separators, horizontal scroll). Put `className="seo-table__num"` on numeric cells.
 */
export function DataTable({ children, bare, className, ...rest }: DataTableProps) {
  return (
    <div className={cx('table', !bare && 'seo-table', bare && 'seo-table seo-table--bare', className)}>
      <table aria-label={rest['aria-label']}>{children}</table>
    </div>
  )
}

export interface ChecklistItem {
  id?: string
  tone: Tone
  icon?: React.ReactNode
  content: React.ReactNode
}

/** Vertical list of checks / suggestions with a toned icon per row. */
export function Checklist({ items, className }: { items: ChecklistItem[]; className?: string }) {
  return (
    <ul className={cx('seo-checklist', className)}>
      {items.map((item, index) => (
        <li
          className={cx('seo-checklist__item', item.tone !== 'neutral' && `seo-checklist__item--${item.tone}`)}
          key={item.id ?? index}
        >
          <span className="seo-checklist__icon">{item.icon ?? <Dot tone={item.tone} />}</span>
          <div className="seo-stack seo-stack--tight" style={{ minWidth: 0, flex: 1 }}>
            {item.content}
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ---------- States -------------------------------------------------------- */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="seo-empty">
      <p className="seo-empty__title">{title}</p>
      {description ? <p className="seo-text seo-text--secondary">{description}</p> : null}
      {action}
    </div>
  )
}

/** Centered Payload spinner with a label. */
export function LoadingState({ label }: { label?: string }) {
  return (
    <div className="seo-loading">
      <Spinner loadingText={label} />
    </div>
  )
}

/* ---------- Form controls ------------------------------------------------- */

export interface FieldProps {
  label: React.ReactNode
  description?: React.ReactNode
  /** The control (`<input className="seo-input">`, `<select className="seo-select">`…). */
  children: React.ReactNode
  className?: string
}

/**
 * Label + control + description, for plain inputs outside a Payload form. The label
 * wraps the control, so it is associated without ids.
 */
export function Field({ label, description, children, className }: FieldProps) {
  return (
    <div className={cx('seo-field', className)}>
      <label className="seo-field__control">
        <span className="seo-field__label">{label}</span>
        {children}
      </label>
      {description ? <span className="seo-field__description">{description}</span> : null}
    </div>
  )
}
