import React from 'react'

import { cn } from '@/utilities/ui'

/** The `section` group every block gets from `defineBlock` (see `sectionField`). */
export type SectionSettings = {
  anchor?: string | null
  background?: 'dark' | 'default' | 'muted' | null
  spacing?: 'lg' | 'md' | 'none' | 'sm' | null
}

const spacing = {
  none: '',
  sm: 'py-8 md:py-12',
  md: 'py-16 md:py-24',
  lg: 'py-24 md:py-32',
} as const

const background = {
  default: '',
  muted: 'bg-muted',
  // `data-theme="dark"` switches the shadcn tokens inside, so the block's own `bg-card`,
  // `text-muted-foreground` and so on stay readable without a dark variant per block.
  dark: 'bg-background text-foreground',
} as const

/**
 * The outer element of every block: background, vertical spacing and anchor id from the
 * block's section settings. `RenderBlocks` adds it; blocks render their content inside
 * (usually in a `container`).
 */
export const Section: React.FC<{
  blockType: string
  children: React.ReactNode
  settings?: SectionSettings | null
}> = ({ blockType, children, settings }) => {
  const bg = settings?.background ?? 'default'

  return (
    <section
      className={cn(background[bg], spacing[settings?.spacing ?? 'md'])}
      data-block={blockType}
      data-theme={bg === 'dark' ? 'dark' : undefined}
      id={settings?.anchor || undefined}
    >
      {children}
    </section>
  )
}
