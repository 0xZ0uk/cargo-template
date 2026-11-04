'use client'

import type { ReactNode } from 'react'

/** A button that POSTs to `action` and follows the response (the plugin's state-changing endpoints). */
export function PostButton({
  action,
  children,
  className = 'po-btn',
  title,
  testId,
}: {
  action: string
  children: ReactNode
  className?: string
  title?: string
  testId?: string
}) {
  return (
    <form method="post" action={action} style={{ display: 'contents' }}>
      <button type="submit" className={className} title={title} data-testid={testId}>
        {children}
      </button>
    </form>
  )
}
