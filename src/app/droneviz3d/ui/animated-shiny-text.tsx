/**
 * AnimatedShinyText — a highlight that sweeps across a short piece of text.
 *
 * Source: Magic UI (MIT) — registry/magicui/animated-shiny-text.tsx, fetched from
 * https://magicui.design/r/animated-shiny-text.json. Adapted for this project:
 *   - `cn` from ./cn.
 *   - Tailwind 4 syntax translated to Tailwind 3: `bg-linear-to-r` → `bg-gradient-to-r`,
 *     `bg-size-[…]`/`bg-position-[…]` → inline `backgroundSize`/`backgroundPosition`,
 *     `via-50%` (a v4 stop-position utility) → `via-[50%]`, and `animate-shiny-text`
 *     is defined in tailwind.config.ts.
 *   - `text-neutral-600/70 dark:text-neutral-400/70` is dropped: this app is
 *     dark-only and the caller sets the colour.
 *
 * Reserved for the eyebrow badge, where it draws the eye to the one line that
 * says what this is. `motion-safe:` keeps it static under reduced motion — the
 * text stays readable, it just stops moving.
 */

import { type ComponentPropsWithoutRef, type CSSProperties, type FC } from 'react'

import { cn } from './cn'

export interface AnimatedShinyTextProps extends ComponentPropsWithoutRef<'span'> {
  shimmerWidth?: number
}

export const AnimatedShinyText: FC<AnimatedShinyTextProps> = ({
  children,
  className,
  shimmerWidth = 100,
  ...props
}) => {
  return (
    <span
      style={
        {
          '--shiny-width': `${shimmerWidth}px`,
          backgroundSize: 'var(--shiny-width) 100%',
          backgroundPosition: '0 0',
        } as CSSProperties
      }
      className={cn(
        'mx-auto max-w-md',
        'motion-safe:animate-shiny-text bg-clip-text bg-no-repeat',
        'bg-gradient-to-r from-transparent via-[50%] to-transparent',
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}