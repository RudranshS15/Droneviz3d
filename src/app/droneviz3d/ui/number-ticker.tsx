'use client'

/**
 * NumberTicker — counts a number up when it scrolls into view.
 *
 * Source: Magic UI (MIT) — registry/magicui/number-ticker.tsx, fetched from
 * https://magicui.design/r/number-ticker.json. Adapted for this project:
 *   - `cn` now comes from ./cn instead of a shadcn `@/lib/utils`.
 *   - the upstream `text-black dark:text-white` is dropped; this app is dark-only
 *     and the caller supplies its own colour.
 *
 * Used on the results page, where the point count and object count are the two
 * numbers a reader actually wants counted up. Motion is opt-out: the
 * `prefers-reduced-motion` branch writes the final value immediately, because a
 * number that animates for two seconds is exactly what that setting asks us not
 * to do.
 */

import { useEffect, useRef, type ComponentPropsWithoutRef } from 'react'
import { useInView, useMotionValue, useSpring } from 'motion/react'

import { cn } from './cn'

interface NumberTickerProps extends ComponentPropsWithoutRef<'span'> {
  value: number
  startValue?: number
  direction?: 'up' | 'down'
  delay?: number
  decimalPlaces?: number
}

export function NumberTicker({
  value,
  startValue = 0,
  direction = 'up',
  delay = 0,
  className,
  decimalPlaces = 0,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const motionValue = useMotionValue(direction === 'down' ? value : startValue)
  const springValue = useSpring(motionValue, { damping: 60, stiffness: 100 })
  const isInView = useInView(ref, { once: true, margin: '0px' })

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!isInView) return
    if (reduced) {
      // No spring: the final value, now.
      motionValue.jump(direction === 'down' ? startValue : value)
      return
    }
    const timer = setTimeout(() => {
      motionValue.set(direction === 'down' ? startValue : value)
    }, delay * 1000)
    return () => clearTimeout(timer)
  }, [motionValue, isInView, delay, value, direction, startValue])

  useEffect(
    () =>
      springValue.on('change', (latest) => {
        if (ref.current) {
          ref.current.textContent = Intl.NumberFormat('en-US', {
            minimumFractionDigits: decimalPlaces,
            maximumFractionDigits: decimalPlaces,
          }).format(Number(latest.toFixed(decimalPlaces)))
        }
      }),
    [springValue, decimalPlaces]
  )

  return (
    <span
      ref={ref}
      className={cn('inline-block tabular-nums tracking-wider', className)}
      {...props}
    >
      {startValue}
    </span>
  )
}