import { Link } from '@tanstack/react-router'
import React from 'react'

import { Button } from '@/components/ui/button'

export const NotFound: React.FC = () => {
  return (
    <div className="container py-28">
      <div className="prose max-w-none">
        <h1 style={{ marginBottom: 0 }}>404</h1>
        <p className="mb-4">This page could not be found.</p>
      </div>
      <Button asChild variant="default">
        <Link to="/">Go home</Link>
      </Button>
    </div>
  )
}
