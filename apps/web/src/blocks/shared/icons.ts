/**
 * Icons editors can pick (the `icon` field). Client-safe; `@/components/Icon` maps each name
 * to its Lucide component. To add one, add it here and in that map (TypeScript checks both).
 * Keep the list curated: every icon is in the bundle of pages that use icons.
 */
export const iconNames = [
  'arrow-right',
  'award',
  'bar-chart',
  'bell',
  'book-open',
  'briefcase',
  'calendar',
  'check',
  'circle-check',
  'clock',
  'cloud',
  'code',
  'credit-card',
  'gauge',
  'gift',
  'globe',
  'heart',
  'layers',
  'layout',
  'leaf',
  'lightbulb',
  'lock',
  'mail',
  'map-pin',
  'message-circle',
  'phone',
  'puzzle',
  'rocket',
  'search',
  'settings',
  'shield-check',
  'smile',
  'sparkles',
  'star',
  'target',
  'thumbs-up',
  'trending-up',
  'truck',
  'users',
  'wand',
  'wrench',
  'zap',
] as const

export type IconName = (typeof iconNames)[number]

/** `arrow-right` → `Arrow right`, for the select's labels. */
export const iconLabel = (name: IconName) =>
  name.charAt(0).toUpperCase() + name.slice(1).replaceAll('-', ' ')
