/**
 * Small layout pieces for the socials admin UI, for what `@payloadcms/ui` doesn't export
 * (Payload's own `Card` is a navigation tile, not a panel). Use Payload components first
 * (Button, Pill, Banner, Collapsible, Tabs, Spinner…) and these only to fill the gaps.
 * Styling lives in `./styles.css`, on Payload 4 tokens only.
 *
 * No hooks and no 'use client': the server view (`SocialsAdminView`) renders
 * `ViewHeader` / `ViewBody` too.
 */

import { Banner, Spinner } from '@payloadcms/ui'
import React from 'react'

export type Tone = 'brand' | 'danger' | 'neutral' | 'success' | 'warning'

/** Joins class names, skipping falsy ones. */
export const cx = (...names: Array<false | null | string | undefined>): string =>
  names.filter(Boolean).join(' ')

/** Shown by every socials admin surface when the plugin is `disabled`. */
export const SOCIALS_DISABLED_NOTICE = 'Socials is turned off. Set its encryption key to enable it.'

export function DisabledNotice() {
  return <Banner type="default">{SOCIALS_DISABLED_NOTICE}</Banner>
}

/* ---------- Layout ------------------------------------------------------- */

/** Page header for an admin view: Payload's list-header markup, so it matches built-in views. */
export function ViewHeader({
  description,
  title,
}: {
  description?: React.ReactNode
  title: React.ReactNode
}) {
  return (
    <header className="list-header">
      <div className="list-header__content">
        <div className="list-header__title-and-actions">
          <h1 className="list-header__title">{title}</h1>
        </div>
      </div>
      {description ? <p className="socials-view-header__description">{description}</p> : null}
    </header>
  )
}

/** Body of an admin view, below `ViewHeader`: gutters and vertical rhythm. */
export function ViewBody({ children }: { children: React.ReactNode }) {
  return <div className="socials-view">{children}</div>
}

export interface CardProps {
  /** Right side of the header (Payload `Tabs`, `Button`s, `Pill`s). */
  actions?: React.ReactNode
  'aria-busy'?: boolean
  children?: React.ReactNode
  className?: string
  /** Secondary line under the title. */
  description?: React.ReactNode
  /** Heading level of the title. Default `h3`. */
  headingLevel?: 'h2' | 'h3'
  title?: React.ReactNode
}

/** Bordered panel with an optional header. For collapsible sections use Payload's `Collapsible`. */
export function Card({
  actions,
  children,
  className,
  description,
  headingLevel: Heading = 'h3',
  title,
  ...rest
}: CardProps) {
  return (
    <section aria-busy={rest['aria-busy']} className={cx('socials-card', className)}>
      {title || actions ? (
        <div className="socials-card__header">
          {title ? (
            <div className="socials-card__heading">
              <Heading className="socials-card__title">{title}</Heading>
              {description ? <p className="socials-text--secondary">{description}</p> : null}
            </div>
          ) : null}
          {actions}
        </div>
      ) : null}
      {children !== undefined && children !== null && children !== false ? (
        <div className="socials-card__body">{children}</div>
      ) : null}
    </section>
  )
}

/** Bordered group of related controls with a legend (media pool, channels). */
export function Fieldset({
  children,
  className,
  legend,
}: {
  children: React.ReactNode
  className?: string
  legend: React.ReactNode
}) {
  return (
    <fieldset className={cx('socials-fieldset', className)}>
      <legend className="socials-fieldset__legend">{legend}</legend>
      {children}
    </fieldset>
  )
}

/* ---------- Form controls ------------------------------------------------- */

/**
 * Label + control + description for plain inputs outside a Payload form. The label wraps
 * the control, so it is associated without ids. Controls take `socials-input`,
 * `socials-select` or `socials-textarea`.
 */
export function Field({
  children,
  className,
  description,
  descriptionTone,
  label,
}: {
  children: React.ReactNode
  className?: string
  description?: React.ReactNode
  /** Colours the description, e.g. `danger` for an over-limit character count. */
  descriptionTone?: Tone
  label: React.ReactNode
}) {
  return (
    <div className={cx('socials-field', className)}>
      <label className="socials-field__control">
        <span className="socials-field__label">{label}</span>
        {children}
      </label>
      {description ? (
        <span
          className={cx(
            'socials-field__description',
            descriptionTone &&
              descriptionTone !== 'neutral' &&
              `socials-field__description--${descriptionTone}`,
          )}
        >
          {description}
        </span>
      ) : null}
    </div>
  )
}

/** A checkbox with its label on the same line. */
export function Check({
  checked,
  className,
  label,
  onChange,
  ...rest
}: {
  'aria-label'?: string
  checked: boolean
  className?: string
  label: React.ReactNode
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <label className={cx('socials-check', className)}>
      <input
        aria-label={rest['aria-label']}
        checked={checked}
        className="socials-check__input"
        onChange={onChange}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  )
}

/* ---------- Status -------------------------------------------------------- */

/** Small coloured dot for a status (connected / not connected). */
export function Dot({ tone = 'neutral' }: { tone?: Tone }) {
  return <span aria-hidden="true" className={cx('socials-dot', `socials-dot--${tone}`)} />
}

/** Payload spinner with a label. */
export function LoadingState({ label }: { label: string }) {
  return (
    <div className="socials-loading">
      <Spinner loadingText={label} />
    </div>
  )
}

/** Payload `Pill` style for a tone. */
export const PILL_STYLE = {
  brand: 'dark',
  danger: 'error',
  neutral: 'light',
  success: 'success',
  warning: 'warning',
} as const satisfies Record<Tone, string>
