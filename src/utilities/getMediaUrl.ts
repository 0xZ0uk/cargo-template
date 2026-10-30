/**
 * Appends a cache tag (usually the media doc's `updatedAt`) so browsers refetch a file after
 * it's replaced. Payload serves uploads from `/api/media/file/...`, so URLs stay relative.
 */
export const getMediaUrl = (url: string | null | undefined, cacheTag?: string | null): string => {
  if (!url) return ''

  if (cacheTag && cacheTag !== '') {
    cacheTag = encodeURIComponent(cacheTag)
  }

  return cacheTag ? `${url}?${cacheTag}` : url
}
