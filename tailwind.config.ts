import type { Config } from 'tailwindcss'

/**
 * The DroneViz3D palette is applied with arbitrary values (`bg-[#c27a3a]`), so
 * this config stays small. What lives here is what arbitrary values cannot
 * express: the keyframes and animation utilities the adapted components in
 * `./droneviz3d/ui` reference by name.
 *
 * Tailwind 3 — not 4. These are the v3 `keyframes`/`animation` forms, and the
 * component sources were adjusted for it: the upstream registries are written
 * against Tailwind 4 syntax (`bg-linear-to-r`, `mask-[...]`, `border-(length:…)`,
 * `size-full`), none of which Tailwind 3 compiles. Each adaptation is called out
 * in the component it affects.
 */
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      keyframes: {
        shine: {
          '0%': { backgroundPosition: '0% 0%' },
          '50%': { backgroundPosition: '100% 100%' },
          to: { backgroundPosition: '0% 0%' },
        },
        'shiny-text': {
          '0%': { backgroundPosition: 'calc(-1 * var(--shiny-width)) 0' },
          '100%': { backgroundPosition: 'calc(100% + var(--shiny-width)) 0' },
        },
        gradient: {
          to: { backgroundPosition: 'var(--bg-size) 0' },
        },
        // Named `pulse-ring`, not `pulse`: Tailwind 3 already defines a `pulse`
        // keyframe for `animate-pulse`, and overriding it would silently change
        // every existing `animate-pulse` in the app.
        'pulse-ring': {
          '0%, 100%': { boxShadow: '0 0 0 0 var(--pulse-color)' },
          '50%': { boxShadow: '0 0 0 var(--distance) var(--pulse-color)' },
        },
      },
      animation: {
        shine: 'shine var(--duration) infinite linear',
        'shiny-text': 'shiny-text 8s infinite',
        gradient: 'gradient 8s linear infinite',
        'pulse-ring': 'pulse-ring var(--duration) ease-out infinite',
      },
    },
  },
  plugins: [],
}
export default config