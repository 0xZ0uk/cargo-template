// 480×320 wireframe for the block pickers. Neutral greys on white; no text.
const cell = (x: number, y: number) => `
  <rect x="${x}" y="${y}" width="28" height="28" rx="8" fill="#e5e5e5"/>
  <rect x="${x}" y="${y + 42}" width="80" height="10" rx="5" fill="#404040"/>
  <rect x="${x}" y="${y + 62}" width="116" height="7" rx="3.5" fill="#d4d4d4"/>
  <rect x="${x}" y="${y + 77}" width="96" height="7" rx="3.5" fill="#d4d4d4"/>`

export const featuresThumbnail = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320" fill="none">
  <rect width="480" height="320" fill="#ffffff"/>
  <rect x="200" y="32" width="80" height="8" rx="4" fill="#a3a3a3"/>
  <rect x="140" y="52" width="200" height="16" rx="4" fill="#404040"/>
  <rect x="170" y="80" width="140" height="8" rx="4" fill="#d4d4d4"/>
  ${cell(48, 128)}${cell(176, 128)}${cell(304, 128)}
  ${cell(48, 228)}${cell(176, 228)}${cell(304, 228)}
</svg>
`
