export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

export const inferMediaFormat = (url: string, mimeType?: string): string | undefined => {
  if (mimeType) {
    const subtype = mimeType.split('/')[1]
    if (subtype) {
      return subtype.split(';')[0]?.trim().toLowerCase() || undefined
    }
  }
  try {
    const filename = new URL(url, 'https://payload-plugin-socials.invalid').pathname
      .split('/')
      .pop()
    const extensionIndex = filename?.lastIndexOf('.') ?? -1
    return extensionIndex > 0 ? filename?.slice(extensionIndex + 1).toLowerCase() : undefined
  } catch {
    return undefined
  }
}
