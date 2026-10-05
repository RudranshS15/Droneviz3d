'use client'

/**
 * BlurFade — reveals its children (fade + small offset + blur) when scrolled
 * into view.
 *
 * Source: Magic UI (MIT) — registry/magicui/blur-fade.tsx, fetched from
 * https://magicui.design/r/blur-fade.json. Adapted for this project:
 *   - `cn` from ./cn.
 *   - `useInView` is imported from `motion/react` rather than `framer-motion`;
 *     `motion` v14 is the same library under its current name and is the package
 *     this project installs.
 *   - The `blur` filter is dropped entirely, which the upstream version does not
 *     do: the opacity + offset reveal is what communicates "this arrived", and an
 *     animated blur is the part that actually bothers people under
 *     `prefers-reduced-motion`. Content is fully visible either way — this is a
 *     reveal, never a gate on reading, and it never leaves text half-drawn.
 */

import { useRef } from 'react'
import {
  AnimatePresence,
  motion,
  useInView,
  type MotionProps,
  type UseInViewOptions,
  type Variants,
} from 'motion/react'

type MarginType = UseInViewOptions['margin']

interface BlurFadeProps extends MotionProps {
  children: React.ReactNode
  className?: string
  variant?: {
    hidden: { y: number }
    visible: { y: number }
  }
  duration?: number
  delay?: number
  offset?: number
  direction?: 'up' | 'down' | 'left' | 'right'
  inView?: boolean
  inViewMargin?: MarginType
}

export function BlurFade({
  children,
  className,
  variant,
  duration = 0.4,
  delay = 0,
  offset = 6,
  direction = 'down',
  inView = false,
  inViewMargin = '-50px',
  ...props
}: BlurFadeProps) {
  const ref = useRef(null)
  const inViewResult = useInView(ref, { once: true, margin: inViewMargin })
  const isInView = !inView || inViewResult
  const axis = direction === 'left' || direction === 'right' ? 'x' : 'y'
  const from = direction === 'right' || direction === 'down' ? -offset : offset

  const defaultVariants: Variants = {
    hidden: { [axis]: from, opacity: 0 },
    visible: { [axis]: 0, opacity: 1 },
  }
  const combinedVariants = variant ?? defaultVariants

  return (
    <AnimatePresence>
      <motion.div
        ref={ref}
        initial="hidden"
        animate={isInView ? 'visible' : 'hidden'}
        exit="hidden"
        variants={combinedVariants}
        transition={{ delay: 0.04 + delay, duration, ease: 'easeOut' }}
        className={className}
        {...props}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}