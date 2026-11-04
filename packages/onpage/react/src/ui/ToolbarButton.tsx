'use client'

import type { ReactNode } from 'react'

/** An icon button in a toolbar: labelled for assistive tech, with the label (or a hint) as its tooltip. */
export function ToolbarButton({
  label,
  hint,
  icon,
  onClick,
  disabled,
  danger,
  testId,
}: {
  label: string
  hint?: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  testId: string
}) {
  return (
    <button
      type="button"
      className={`po-btn${danger ? ' is-danger' : ''}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={hint ?? label}
      data-testid={testId}
    >
      {icon}
    </button>
  )
}
