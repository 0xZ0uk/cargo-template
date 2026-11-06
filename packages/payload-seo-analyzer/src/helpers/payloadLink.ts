/**
 * Payload `link` field reader, split out so the block walker and the link extractors share
 * it without importing each other.
 */

// ---------------------------------------------------------------------------
// Payload link field extractor
// Handles both structured links ({type, url, reference}) and resolves
// reference links when populated (depth >= 1).
// ---------------------------------------------------------------------------

export function extractPayloadLink(
  link: unknown,
): { url: string; text: string } | null {
  if (!link || typeof link !== 'object') return null
  const l = link as Record<string, unknown>

  const label = (typeof l.label === 'string' ? l.label : '') as string

  if (l.type === 'custom' && typeof l.url === 'string' && l.url) {
    return { url: l.url, text: label }
  }

  if (l.type === 'reference' && l.reference) {
    const ref = l.reference as Record<string, unknown>
    // Populated reference: { value: { slug: '...' } } or { value: { slug }, relationTo }
    if (ref.value && typeof ref.value === 'object') {
      const val = ref.value as Record<string, unknown>
      if (typeof val.slug === 'string') {
        return { url: `/${val.slug}`, text: label }
      }
    }
    // Direct slug on reference (some formats)
    if (typeof ref.slug === 'string') {
      return { url: `/${ref.slug}`, text: label }
    }
  }

  // Fallback: direct url field
  if (typeof l.url === 'string' && l.url) {
    return { url: l.url, text: label }
  }

  return null
}
