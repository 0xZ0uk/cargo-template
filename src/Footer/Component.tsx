import { Link } from '@tanstack/react-router'
import React from 'react'

import type { Footer as FooterType } from '@/payload-types'

import { CMSLink } from '@/components/Link'
import { Logo } from '@/components/Logo/Logo'

export const Footer: React.FC<{ data: FooterType }> = ({ data }) => {
  const navItems = data?.navItems || []

  return (
    <footer className="mt-auto border-t border-border bg-black dark:bg-card text-white">
      <div className="container py-8 gap-8 flex flex-col md:flex-row md:justify-between">
        <Link className="flex items-center" to="/">
          <Logo />
        </Link>

        <nav className="flex flex-col md:flex-row gap-4">
          {navItems.map(({ link }, i) => {
            return <CMSLink className="text-white" key={i} {...link} />
          })}
        </nav>
      </div>
    </footer>
  )
}
