// 480×320 wireframe for the block pickers (default variant). Neutral greys on white; no text.
const star = (x: number, y: number) =>
  `<path transform="translate(${x} ${y})" d="M6 0l1.8 4.1 4.2.4-3.2 2.8 1 4.3L6 9.4 2.2 11.6l1-4.3L0 4.5l4.2-.4z" fill="#a3a3a3"/>`

const stars = (x: number, y: number) =>
  [0, 1, 2, 3, 4].map((index) => star(x + index * 15, y)).join('')

const card = (x: number) => `
  <rect x="${x}" y="158" width="130" height="118" rx="8" fill="#ffffff" stroke="#e5e5e5" stroke-width="2"/>
  ${stars(x + 14, 174)}
  <rect x="${x + 14}" y="200" width="90" height="8" rx="4" fill="#404040"/>
  <rect x="${x + 14}" y="218" width="100" height="6" rx="3" fill="#d4d4d4"/>
  <rect x="${x + 14}" y="230" width="84" height="6" rx="3" fill="#d4d4d4"/>
  <circle cx="${x + 22}" cy="256" r="8" fill="#e5e5e5"/>
  <rect x="${x + 36}" y="252" width="52" height="8" rx="4" fill="#a3a3a3"/>`

export const reviewsThumbnail = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320" fill="none">
  <rect width="480" height="320" fill="#ffffff"/>
  <rect x="170" y="28" width="140" height="14" rx="4" fill="#404040"/>
  <rect x="140" y="52" width="200" height="8" rx="4" fill="#d4d4d4"/>
  <rect x="204" y="76" width="72" height="34" rx="6" fill="#404040"/>
  ${stars(202, 122)}
  <rect x="180" y="142" width="120" height="6" rx="3" fill="#d4d4d4"/>
  ${card(30)}
  ${card(175)}
  ${card(320)}
</svg>
`
