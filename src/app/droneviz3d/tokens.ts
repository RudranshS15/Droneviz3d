/**
 * Design tokens — single source of truth for DroneViz3D palette.
 * T3 — Mapped Type: ColorToken is the key union, ThemeColors maps every token to its hex.
 */

export const colors = {
  field: '#0c0a09', chalk: '#e7e5e4', stone: '#a8a29e', copper: '#c27a3a',
  amber: '#d4a053', moss: '#4d7c5e', surface: '#1c1917', border: '#292524',
} as const

export type ColorToken = keyof typeof colors
export type ThemeColors = Record<ColorToken, string>
export type AlphaMap = { readonly [K in ColorToken]: (opacity: number) => string }

export function alpha(token: ColorToken, opacity: number): string {
  const hex = colors[token]
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

export const rgba: AlphaMap = Object.fromEntries(
  Object.keys(colors).map((key) => [key, (opacity: number) => alpha(key as ColorToken, opacity)])
) as AlphaMap

export const tw = {
  bg: `bg-[${colors.field}]`, surface: `bg-[${colors.surface}]`, border: `border-[${colors.border}]`,
  text: `text-[${colors.chalk}]`, textMuted: `text-[${colors.stone}]`, accent: `text-[${colors.copper}]`,
  accentBg: `bg-[${colors.copper}]`, badge: `text-[${colors.amber}]`,
  moss: `text-[${colors.moss}]`, mossBg: `bg-[${colors.moss}]`,
} as const

export type TwToken = keyof typeof tw
