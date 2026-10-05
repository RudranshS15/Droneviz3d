'use client'

/**
 * BorderBeam — a light bar that runs around the running step while it is both
 * on screen and actually running.
 *
 * Source: Magic UI (MIT) — registry/magicui/border-beam.tsx, fetched from
 * https://magicui.design/r/border-beam.json. Adapted for this project:
 *   - `cn` from ./cn.
 *   - Tailwind 4 syntax translated to Tailwind 3: `bg-linear-to-l` → `bg-gradient-to-l`,
 *     `from-(--color-from)` → `from-[var(--color-from)]`, the `border-(length:…)`
 *     and `mask-[…]`/`mask-intersect`/`[mask-clip:…]` utilities have no v3
 *     equivalent and are written as inline styles instead.
 *   - The upstream `mask-intersect` is replaced by explicit `maskComposite`
 *     (and `WebkitMaskComposite`) so the bar is clipped to the border ring.
 *
 * `active` exists so the beam can be switched off rather than merely hidden: the
 * processing page mounts this on the step that is running, and a frozen beam on
 * a stalled step would be a lie about progress.
 */

import { motion, type MotionStyle, type Transition } from 'motion/react'

import { cn } from './cn'

interface BorderBeamProps {
  /** Length of the beam, in px. */
  size?: number
  /** Seconds for one lap. */
  duration?: number
  delay?: number
  colorFrom?: string
  colorTo?: string
  transition?: Transition
  className?: string
  style?: React.CSSProperties
  reverse?: boolean
  /** Starting position around the ring, 0–100. */
  initialOffset?: number
  borderWidth?: number
  /** When false the beam is not rendered at all. */
  active?: boolean
}

export const BorderBeam = ({
  className,
  size = 50,
  delay = 0,
  duration = 6,
  colorFrom = '#ffaa40',
  colorTo = '#9c40ff',
  transition,
  style,
  reverse = false,
  initialOffset = 0,
  borderWidth = 1,
  active = true,
}: BorderBeamProps) => {
  if (!active) return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-[inherit] border-transparent"
      style={{
        borderWidth: `${borderWidth}px`,
        borderStyle: 'solid',
        mask: 'linear-gradient(transparent,transparent),linear-gradient(#000,#000)',
        WebkitMask: 'linear-gradient(transparent,transparent),linear-gradient(#000,#000)',
        WebkitMaskComposite: 'xor',
        maskComposite: 'exclude',
        maskClip: 'padding-box,border-box',
        WebkitMaskClip: 'padding-box,border-box',
      }}
    >
      <motion.div
        className={cn(
          'absolute aspect-square',
          'bg-gradient-to-l from-[var(--color-from)] via-[var(--color-to)] to-transparent',
          className
        )}
        style={
          {
            width: size,
            offsetPath: `rect(0 auto auto 0 round ${size}px)`,
            '--color-from': colorFrom,
            '--color-to': colorTo,
            ...style,
          } as MotionStyle
        }
        initial={{ offsetDistance: `${initialOffset}%` }}
        animate={{
          offsetDistance: reverse
            ? [`${100 - initialOffset}%`, `${-initialOffset}%`]
            : [`${initialOffset}%`, `${100 + initialOffset}%`],
        }}
        transition={{
          repeat: Infinity,
          ease: 'linear',
          duration,
          delay: -delay,
          ...transition,
        }}
      />
    </div>
  )
}