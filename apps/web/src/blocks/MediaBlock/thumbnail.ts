// 480×320 wireframe for the block pickers. Neutral greys on white; no text.
export const mediaBlockThumbnail = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320" fill="none">
  <defs><clipPath id="m"><rect x="40" y="48" width="400" height="190" rx="12"/></clipPath></defs>
  <rect width="480" height="320" fill="#ffffff"/>
  <rect x="40" y="48" width="400" height="190" rx="12" fill="#e5e5e5"/>
  <g clip-path="url(#m)">
    <circle cx="368" cy="100" r="16" fill="#d4d4d4"/>
    <path d="M40 238 L150 134 L230 206 L300 158 L440 238 Z" fill="#d4d4d4"/>
    <path d="M120 238 L210 176 L290 238 Z" fill="#a3a3a3"/>
  </g>
  <rect x="170" y="262" width="140" height="8" rx="4" fill="#a3a3a3"/>
  <rect x="200" y="280" width="80" height="8" rx="4" fill="#d4d4d4"/>
</svg>
`
