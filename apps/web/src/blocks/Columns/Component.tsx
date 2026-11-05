import React from 'react'

import type { ColumnsBlock as ColumnsBlockProps } from '@/payload-types'

import { SectionHeading } from '@/components/SectionHeading'
import { cn } from '@/utilities/ui'

import { elementComponents, type ColumnElement } from './elements'

// Every layout stacks to one column on phones; extra columns wrap onto a new row. `minmax(0, …)`
// keeps wide media and long words from stretching a track.
const layouts: Record<NonNullable<ColumnsBlockProps['variant']>, string> = {
  halves: 'md:grid-cols-2',
  thirds: 'md:grid-cols-3',
  quarters: 'sm:grid-cols-2 lg:grid-cols-4',
  twoOne: 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]',
  oneTwo: 'md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]',
}

const Element: React.FC<{ element: ColumnElement }> = ({ element }) => {
  const Component = elementComponents[element.blockType] as
    | React.ComponentType<ColumnElement>
    | undefined
  return Component ? <Component {...element} /> : null
}

export const ColumnsBlock: React.FC<ColumnsBlockProps> = ({
  columns,
  description,
  eyebrow,
  title,
  variant,
}) => {
  const layout = layouts[variant ?? 'halves'] ?? layouts.halves
  const hasHeading = Boolean(eyebrow || title || description)

  return (
    <div className="container">
      <SectionHeading
        align="start"
        className={cn('max-w-3xl', hasHeading && 'mb-10 md:mb-14')}
        description={description}
        eyebrow={eyebrow}
        title={title}
      />
      {columns && columns.length > 0 && (
        <div className={cn('grid grid-cols-1 gap-x-10 gap-y-12 md:gap-x-12', layout)}>
          {columns.map((column, index) => (
            <div className="flex min-w-0 flex-col gap-6" key={column.id ?? index}>
              {column.content?.map((element, i) => (
                <Element element={element} key={element.id ?? i} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
