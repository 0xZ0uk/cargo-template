// Component tests opt into a DOM with `// @vitest-environment happy-dom`; clean up after each one.
import { afterEach } from 'vitest'

afterEach(async () => {
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react')
    cleanup()
  }
})
