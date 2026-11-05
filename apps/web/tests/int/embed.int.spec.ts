import { describe, expect, it } from 'vitest'

import { toEmbed } from '@/blocks/Embed/providers'

const yt = (id: string, query = '') => `https://www.youtube-nocookie.com/embed/${id}${query}`

describe('toEmbed', () => {
  it.each([
    ['https://www.youtube.com/watch?v=aqz-KE-bpKQ', yt('aqz-KE-bpKQ')],
    ['https://youtube.com/watch?v=aqz-KE-bpKQ&feature=share', yt('aqz-KE-bpKQ')],
    ['https://m.youtube.com/watch?v=aqz-KE-bpKQ', yt('aqz-KE-bpKQ')],
    ['https://youtu.be/aqz-KE-bpKQ', yt('aqz-KE-bpKQ')],
    ['https://www.youtube.com/shorts/abc_DEF-123', yt('abc_DEF-123')],
    ['https://www.youtube.com/embed/aqz-KE-bpKQ', yt('aqz-KE-bpKQ')],
    ['https://youtu.be/aqz-KE-bpKQ?t=90', yt('aqz-KE-bpKQ', '?start=90')],
    ['https://youtu.be/aqz-KE-bpKQ?t=1m30s', yt('aqz-KE-bpKQ', '?start=90')],
    ['https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=42s', yt('aqz-KE-bpKQ', '?start=42')],
    ['https://www.youtube.com/embed/aqz-KE-bpKQ?start=15', yt('aqz-KE-bpKQ', '?start=15')],
    ['  https://youtu.be/aqz-KE-bpKQ  ', yt('aqz-KE-bpKQ')],
  ])('YouTube: %s', (input, src) => {
    expect(toEmbed(input)).toEqual({ provider: 'YouTube', src })
  })

  it.each([
    ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871'],
    ['https://www.vimeo.com/76979871', 'https://player.vimeo.com/video/76979871'],
    ['https://player.vimeo.com/video/76979871', 'https://player.vimeo.com/video/76979871'],
    ['https://player.vimeo.com/video/76979871?h=abc', 'https://player.vimeo.com/video/76979871'],
  ])('Vimeo: %s', (input, src) => {
    expect(toEmbed(input)).toEqual({ provider: 'Vimeo', src })
  })

  it.each([
    ['https://www.loom.com/share/0123abcd4567ef', 'https://www.loom.com/embed/0123abcd4567ef'],
    ['https://loom.com/embed/0123abcd4567ef', 'https://www.loom.com/embed/0123abcd4567ef'],
  ])('Loom: %s', (input, src) => {
    expect(toEmbed(input)).toEqual({ provider: 'Loom', src })
  })

  it.each(['track', 'album', 'playlist', 'episode', 'show'])('Spotify %s', (type) => {
    expect(toEmbed(`https://open.spotify.com/${type}/4uLU6hMCjMI75M1A2tKUQC?si=abc`)).toEqual({
      provider: 'Spotify',
      src: `https://open.spotify.com/embed/${type}/4uLU6hMCjMI75M1A2tKUQC`,
    })
  })

  it('Google Maps: returns the embed URL unchanged', () => {
    const url = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3022.2!2d-73.98'
    expect(toEmbed(url)).toEqual({ provider: 'Google Maps', src: url })
  })

  it('Calendly: adds embed_type=Inline', () => {
    expect(toEmbed('https://calendly.com/acme')).toEqual({
      provider: 'Calendly',
      src: 'https://calendly.com/acme?embed_type=Inline',
    })
    expect(toEmbed('https://calendly.com/acme/30min')).toEqual({
      provider: 'Calendly',
      src: 'https://calendly.com/acme/30min?embed_type=Inline',
    })
    expect(toEmbed('https://calendly.com/acme/30min?month=2026-12&embed_type=Popup')?.src).toBe(
      'https://calendly.com/acme/30min?month=2026-12&embed_type=Inline',
    )
  })

  it.each([
    'https://evil.example/watch?v=aqz-KE-bpKQ',
    'https://youtube.com.evil.example/watch?v=aqz-KE-bpKQ',
    'https://evil.example/https://youtu.be/aqz-KE-bpKQ',
    'https://notyoutube.com/watch?v=aqz-KE-bpKQ',
    'https://vimeo.com.evil.example/76979871',
    'https://example.com/',
    'https://google.com/maps/embed?pb=1',
    'https://maps.google.com/maps/embed?pb=1',
    'https://www.google.com/maps/embed',
    'https://www.google.com/maps?q=Lisbon',
    'https://www.google.com/search?q=maps',
    'https://spotify.com/track/abc',
    'https://open.spotify.com/user/abc',
    'https://open.spotify.com/track/abc/def',
    'https://calendly.evil.example/acme',
    'https://calendly.com/',
    'https://calendly.com/a/b/c',
  ])('rejects other hosts and unsupported paths: %s', (input) => {
    expect(toEmbed(input)).toBeNull()
  })

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'http://www.youtube.com/watch?v=aqz-KE-bpKQ',
    'http://youtu.be/aqz-KE-bpKQ',
    'ftp://youtu.be/aqz-KE-bpKQ',
    '//youtu.be/aqz-KE-bpKQ',
    'https://user:pass@youtu.be/aqz-KE-bpKQ',
    'https://youtu.be:8443/aqz-KE-bpKQ',
    '',
    '   ',
    'not a url',
  ])('rejects non-https and malformed input: %j', (input) => {
    expect(toEmbed(input)).toBeNull()
  })

  it.each([
    'https://www.youtube.com/watch?v=',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v="><script>',
    'https://www.youtube.com/watch?v=abc/../def',
    'https://www.youtube.com/embed/abc%20def',
    'https://www.youtube.com/shorts/abc.def',
    'https://youtu.be/abc$def',
    'https://youtu.be/',
    'https://vimeo.com/not-a-number',
    'https://player.vimeo.com/video/12ab',
    'https://www.loom.com/share/abc!def',
    'https://www.loom.com/share/',
    'https://open.spotify.com/track/abc%2Fdef',
    'https://calendly.com/ac%20me',
    'https://calendly.com/acme.evil',
  ])('rejects bad IDs: %s', (input) => {
    expect(toEmbed(input)).toBeNull()
  })

  it('ignores a bad start time instead of passing it through', () => {
    expect(toEmbed('https://youtu.be/aqz-KE-bpKQ?t="><script>')?.src).toBe(yt('aqz-KE-bpKQ'))
  })
})
