'use client'

/**
 * ShineBorder — a slow specular sweep along an element's border.
 *
 * Source: Magic UI (MIT) — registry/magicui/shine-border.tsx, fetched from
 * https://magicui.design/r/shine-border.json. Adapted for this project:
 *   - `cn` from ./cn.
 *   - Tailwind 4's `size-full` is Tailwind 3's `w-full h-full`.
 *   - The `@keyframes shine` rule upstream ships as a registry cssVar is written
 *     into tailwind.config.ts instead, so the animation utility is available by
 *     name (`animate-shine`) rather than injected per component.
 *
 * It is decorative and inert: `pointer-events-none` and `aria-hidden`, so it can
 * never intercept a click or be announced. `motion-safe:` keeps it still for
 * readers who asked for less motion.
 */

import * as React from 'react'

import { cn } from './cn'

interface ShineBorderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Width of the border in pixels @default 1 */
  borderWidth?: number
  /** Duration of the animation in seconds @default 14 */
  duration?: number
  /** Colour of the border, a single colour or an array @default "#000000" */
  shineColor?: string | string[]
}

export function ShineBorder({
  borderWidth = 1,
  duration = 14,
  shineColor = '#000000',
  className,
  style,
  ...props
}: ShineBorderProps) {
  return (
    <div
      aria-hidden="true"
      style={
        {
          '--border-width': `${borderWidth}px`,
          '--duration': `${duration}s`,
          backgroundImage: `radial-gradient(transparent,transparent, ${
            Array.isArray(shineColor) ? shineColor.join(',') : shineColor
          },transparent,transparent)`,
          backgroundSize: '300% 300%',
          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          padding: 'var(--border-width)',
          ...style,
        } as React.CSSProperties
      }
      className={cn(
        'motion-safe:animate-shine pointer-events-none absolute inset-0 w-full h-full rounded-[inherit] will-change-[background-position]',
        className
      )}
      {...props}
    />
  )
}