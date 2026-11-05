// 480×320 wireframe for the block pickers. Neutral greys on white; no text.
const card = (x: number) => `
  <rect x="${x}" y="130" width="130" height="150" rx="10" fill="#ffffff" stroke="#e5e5e5" stroke-width="2"/>
  <rect x="${x + 16}" y="150" width="98" height="8" rx="4" fill="#d4d4d4"/>
  <rect x="${x + 16}" y="168" width="86" height="8" rx="4" fill="#d4d4d4"/>
  <rect x="${x + 16}" y="186" width="60" height="8" rx="4" fill="#d4d4d4"/>
  <circle cx="${x + 28}" cy="244" r="12" fill="#a3a3a3"/>
  <rect x="${x + 48}" y="236" width="56" height="7" rx="3.5" fill="#404040"/>
  <rect x="${x + 48}" y="250" width="40" height="6" rx="3" fill="#d4d4d4"/>`

export const testimonialsThumbnail = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320" fill="none">
  <rect width="480" height="320" fill="#ffffff"/>
  <rect x="200" y="36" width="80" height="8" rx="4" fill="#a3a3a3"/>
  <rect x="150" y="56" width="180" height="16" rx="4" fill="#404040"/>
  <rect x="180" y="84" width="120" height="8" rx="4" fill="#d4d4d4"/>${card(32)}${card(175)}${card(318)}
</svg>
`
