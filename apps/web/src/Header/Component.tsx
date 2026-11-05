import { Link } from '@tanstack/react-router'
import React from 'react'

import type { Header as HeaderType } from '@/payload-types'

import { Logo } from '@/components/Logo/Logo'
import { HeaderNav } from './Nav'

interface HeaderProps {
  data: HeaderType
}

export const Header: React.FC<HeaderProps> = ({ data }) => {
  return (
    <header className="container relative z-20">
      <div className="py-8 flex justify-between">
        <Link to="/">
          <Logo loading="eager" priority="high" className="invert dark:invert-0" />
        </Link>
        <HeaderNav data={data} />
      </div>
    </header>
  )
}
