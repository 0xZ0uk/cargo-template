import React from 'react'

import { stegaClean } from '@shipment/onpage-core'

import type { LogosBlock as LogosBlockProps } from '@/payload-types'

import { Media } from '@/components/Media'
import { cn } from '@/utilities/ui'

type Item = NonNullable<LogosBlockProps['items']>[number]

const muted = 'text-muted-foreground transition hover:text-foreground'

/** One logo: the image (greyscale until hover) or, without one, the name as text. */
const Logo: React.FC<{ hidden?: boolean; item: Item }> = ({ hidden, item }) => {
  const logo = typeof item.logo === 'object' ? item.logo : null
  // Check emptiness on the clean string: `trim()` could strip the on-page editor's marker.
  const name = item.name && stegaClean(item.name).trim() ? item.name : null
  if (!logo && !name) return null

  const content = logo ? (
    <>
      <Media
        htmlElement={null}
        imgClassName="h-8 w-auto max-w-40 object-contain grayscale opacity-60 transition group-hover/logo:grayscale-0 group-hover/logo:opacity-100 group-focus-visible/logo:grayscale-0 group-focus-visible/logo:opacity-100"
        pictureClassName="flex"
        resource={logo}
      />
      {/* The alt comes from the media; fall back to the company name when it has none. */}
      {!logo.alt && name && <span className="sr-only">{name}</span>}
    </>
  ) : (
    <span
      className={cn(
        'text-xl font-semibold tracking-tight whitespace-nowrap',
        muted,
        'group-hover/logo:text-foreground group-focus-visible/logo:text-foreground',
      )}
    >
      {name}
    </span>
  )

  return item.url ? (
    <a
      aria-label={name ? stegaClean(name) : undefined}
      className="group/logo flex items-center rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      href={item.url}
      rel="noopener"
      tabIndex={hidden ? -1 : undefined}
      target="_blank"
    >
      {content}
    </a>
  ) : (
    <div className="group/logo flex items-center">{content}</div>
  )
}

export const LogosBlock: React.FC<LogosBlockProps> = ({ items, title, variant }) => {
  const list = items ?? []

  return (
    <div className="container">
      {title && (
        <p className="text-center text-sm font-medium text-balance text-muted-foreground">
          {title}
        </p>
      )}

      {list.length > 0 && variant === 'grid' && (
        <ul className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6', title && 'mt-8')}>
          {list.map((item, index) => (
            <li
              className="flex h-24 items-center justify-center rounded-xl border bg-card px-4"
              key={item.id ?? index}
            >
              <Logo item={item} />
            </li>
          ))}
        </ul>
      )}

      {list.length > 0 && variant === 'marquee' && (
        <div
          className={cn(
            'group/marquee relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_10%,#000_90%,transparent)] motion-reduce:[mask-image:none]',
            title && 'mt-8',
          )}
        >
          <div className="flex w-max animate-marquee hover:[animation-play-state:paused] focus-within:[animation-play-state:paused] motion-reduce:w-full motion-reduce:animate-none motion-reduce:justify-center">
            <ul className="flex min-w-screen shrink-0 items-center justify-around gap-x-14 pr-14 motion-reduce:min-w-0 motion-reduce:flex-wrap motion-reduce:gap-y-6 motion-reduce:pr-0">
              {list.map((item, index) => (
                <li key={item.id ?? index}>
                  <Logo item={item} />
                </li>
              ))}
            </ul>
            {/* The track holds the list twice and `animate-marquee` shifts it by half its width,
                so the loop has no jump. The copy is hidden from assistive tech and from
                reduced-motion visitors, who get the wrapping row above. */}
            <ul
              aria-hidden="true"
              className="flex min-w-screen shrink-0 items-center justify-around gap-x-14 pr-14 motion-reduce:hidden"
            >
              {list.map((item, index) => (
                <li key={item.id ?? index}>
                  <Logo hidden item={item} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {list.length > 0 && variant !== 'grid' && variant !== 'marquee' && (
        <ul
          className={cn(
            'flex flex-wrap items-center justify-center gap-x-10 gap-y-6 md:gap-x-14',
            title && 'mt-8',
          )}
        >
          {list.map((item, index) => (
            <li key={item.id ?? index}>
              <Logo item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
