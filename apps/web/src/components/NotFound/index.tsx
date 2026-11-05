import { Link } from '@tanstack/react-router'
import React from 'react'

import { buttonVariants } from '@/components/ui/button'

export const NotFound: React.FC = () => {
  return (
    <div className="container py-28">
      <div className="prose max-w-none">
        <h1 style={{ marginBottom: 0 }}>404</h1>
        <p className="mb-4">This page could not be found.</p>
      </div>
      <Link className={buttonVariants()} to="/">
        Go home
      </Link>
    </div>
  )
}
