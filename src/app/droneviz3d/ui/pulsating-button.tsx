'use client'

/**
 * PulsatingButton — a button with a pulsing halo, for the one primary action.
 *
 * Source: Magic UI (MIT) — registry/magicui/pulsating-button.tsx, fetched from
 * https://magicui.design/r/pulsating-button.json. Adapted for this project:
 *   - `cn` from ./cn.
 *   - `bg-primary text-primary-foreground` (shadcn theme variables this project
 *     does not define) is dropped; the caller supplies its own colours.
 *   - The upstream keyframes derive the halo colour with `oklch(from var(--bg) …)`,
 *     a CSS Color 5 relative-colour function that Safari and older Firefox do not
 *     support and that the JSDOM-free test environment cannot resolve either.
 *     `--pulse-color` is therefore always set explicitly here — from the caller's
 *     `pulseColor` prop, or measured off the button's own computed background by
 *     the layout effect below — so the animation never depends on `oklch()`.
 *     The `pulse-ripple` variant was dropped with it. The keyframe is named
 *     `pulse-ring` in tailwind.config.ts rather than `pulse`, because Tailwind
 *     already owns that name for `animate-pulse`.
 *
 * The halo is a sibling `<span aria-hidden>` behind the label, so it cannot be
 * clicked or announced. It is `motion-safe:`, so under reduced motion the button
 * is simply a button.
 */

import React, { useImperativeHandle, useLayoutEffect, useRef } from 'react'

import { cn } from './cn'

interface PulsatingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pulseColor?: string
  duration?: string
  distance?: string
}

export const PulsatingButton = React.forwardRef<HTMLButtonElement, PulsatingButtonProps>(
  ({ className, children, pulseColor, duration = '2s', distance = '6px', ...props }, ref) => {
    const innerRef = useRef<HTMLButtonElement>(null)
    useImperativeHandle(ref, () => innerRef.current!)

    useLayoutEffect(() => {
      const button = innerRef.current
      if (!button) return
      if (pulseColor) {
        button.style.setProperty('--pulse-color', pulseColor)
        return
      }
      // Read the button's own background so the halo matches it, without the
      // oklch() relative-colour syntax the upstream default relies on.
      const sync = () => {
        const bg = getComputedStyle(button).backgroundColor
        if (bg && bg !== 'rgba(0, 0, 0, 0)') button.style.setProperty('--pulse-color', bg)
      }
      sync()
      const observer = new MutationObserver(sync)
      observer.observe(button, { attributes: true })
      return () => observer.disconnect()
    }, [pulseColor])

    return (
      <button
        ref={innerRef}
        className={cn(
          'relative flex cursor-pointer items-center justify-center rounded-xl px-7 py-3 text-center',
          className
        )}
        style={
          {
            '--duration': duration,
            '--distance': distance,
          } as React.CSSProperties
        }
        {...props}
      >
        <span className="relative z-10">{children}</span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] motion-safe:animate-pulse-ring"
        />
      </button>
    )
  }
)

PulsatingButton.displayName = 'PulsatingButton'