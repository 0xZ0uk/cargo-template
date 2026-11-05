/**
 * The embed allowlist. `toEmbed` turns a page URL an editor pastes (a YouTube watch link, a
 * Calendly profile…) into the iframe `src` for that provider, or `null` for anything else. The
 * Embed block only ever renders an iframe from this function's output: never an arbitrary URL.
 * Pure and client-safe (the admin's `validate` and the component both use it).
 */

export type EmbedSource = { provider: string; src: string }

/** Provider names, for admin messages. */
export const embedProviderNames = [
  'YouTube',
  'Vimeo',
  'Loom',
  'Spotify',
  'Google Maps',
  'Calendly',
] as const

const ID = /^[A-Za-z0-9_-]+$/

const isId = (value: string | undefined): value is string => !!value && ID.test(value)

/** `/a/b/` → `['a', 'b']`; an empty segment in the middle (`/a//b`) is kept so it fails `ID`. */
const segments = (pathname: string): string[] => {
  const parts = pathname.split('/').slice(1)
  if (parts.at(-1) === '') parts.pop()
  return parts
}

/** `90`, `90s`, `1m30s`, `1h2m3s` → seconds. `null` when it isn't a time. */
const parseSeconds = (value: string | null): number | null => {
  if (!value) return null
  if (/^\d+$/.test(value)) return Number(value)
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value)
  if (!match || !match[0]) return null
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
}

const youtube = (id: string | undefined, params: URLSearchParams): EmbedSource | null => {
  if (!isId(id)) return null
  const start = parseSeconds(params.get('start') ?? params.get('t'))
  return {
    provider: 'YouTube',
    src: `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`,
  }
}

const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
const vimeoHosts = new Set(['vimeo.com', 'www.vimeo.com'])
const loomHosts = new Set(['loom.com', 'www.loom.com'])
const calendlyHosts = new Set(['calendly.com', 'www.calendly.com'])
const spotifyTypes = new Set(['track', 'album', 'playlist', 'episode', 'show'])

/**
 * Supported forms:
 * - YouTube: `youtube.com/watch?v=ID`, `youtu.be/ID`, `youtube.com/shorts/ID`, `youtube.com/embed/ID`
 * - Vimeo: `vimeo.com/ID`, `player.vimeo.com/video/ID`
 * - Loom: `loom.com/share/ID`, `loom.com/embed/ID`
 * - Spotify: `open.spotify.com/{track|album|playlist|episode|show}/ID`
 * - Google Maps: `https://www.google.com/maps/embed?...` (the "Embed a map" link), unchanged
 * - Calendly: `calendly.com/<user>[/<event>]`
 *
 * https only. Anything else, including bad IDs, returns `null`.
 */
export const toEmbed = (input: string): EmbedSource | null => {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null

  const host = url.hostname.toLowerCase()
  const path = segments(url.pathname)
  const [first, second] = path

  if (youtubeHosts.has(host)) {
    if (first === 'watch' && path.length === 1)
      return youtube(url.searchParams.get('v') ?? '', url.searchParams)
    if ((first === 'shorts' || first === 'embed') && path.length === 2)
      return youtube(second, url.searchParams)
    return null
  }

  if (host === 'youtu.be') return path.length === 1 ? youtube(first, url.searchParams) : null

  if (vimeoHosts.has(host)) {
    return path.length === 1 && isId(first) && /^\d+$/.test(first)
      ? { provider: 'Vimeo', src: `https://player.vimeo.com/video/${first}` }
      : null
  }

  if (host === 'player.vimeo.com') {
    return path.length === 2 && first === 'video' && isId(second) && /^\d+$/.test(second)
      ? { provider: 'Vimeo', src: `https://player.vimeo.com/video/${second}` }
      : null
  }

  if (loomHosts.has(host)) {
    return path.length === 2 && (first === 'share' || first === 'embed') && isId(second)
      ? { provider: 'Loom', src: `https://www.loom.com/embed/${second}` }
      : null
  }

  if (host === 'open.spotify.com') {
    return path.length === 2 && spotifyTypes.has(first ?? '') && isId(second)
      ? { provider: 'Spotify', src: `https://open.spotify.com/embed/${first}/${second}` }
      : null
  }

  if (host === 'www.google.com') {
    return path.length === 2 && first === 'maps' && second === 'embed' && url.search.length > 1
      ? { provider: 'Google Maps', src: url.href }
      : null
  }

  if (calendlyHosts.has(host)) {
    if (path.length < 1 || path.length > 2 || !path.every((part) => isId(part))) return null
    const params = new URLSearchParams(url.search)
    params.set('embed_type', 'Inline')
    return {
      provider: 'Calendly',
      src: `https://calendly.com/${path.join('/')}?${params.toString()}`,
    }
  }

  return null
}
