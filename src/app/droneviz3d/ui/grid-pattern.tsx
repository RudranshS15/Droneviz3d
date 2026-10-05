/**
 * GridPattern — an SVG grid, optionally with individual squares highlighted.
 *
 * Source: Magic UI (MIT) — registry/magicui/grid-pattern.tsx, fetched from
 * https://magicui.design/r/grid-pattern.json. Adapted for this project:
 *   - `cn` from ./cn.
 *   - The upstream default fill/stroke (`fill-gray-400/30 stroke-gray-400/30`)
 *     is removed. The landing page already draws its own grid at 2% opacity;
 *     a second, brighter grid in the same place would just be noise, so the
 *     caller here always passes the colour it wants.
 *
 * The `id` for the `<pattern>` comes from `useId()` rather than a prop, so two
 * grids on one page cannot collide — and it is stable between the server render
 * and hydration, which a counter-based id would not be.
 */

import { useId } from 'react'

import { cn } from './cn'

interface GridPatternProps extends React.SVGProps<SVGSVGElement> {
  width?: number
  height?: number
  x?: number
  y?: number
  squares?: Array<[x: number, y: number]>
  strokeDasharray?: string
  className?: string
  [key: string]: unknown
}

export function GridPattern({
  width = 40,
  height = 40,
  x = -1,
  y = -1,
  strokeDasharray = '0',
  squares,
  className,
  ...props
}: GridPatternProps) {
  const id = useId()

  return (
    <svg
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
      {...props}
    >
      <defs>
        <pattern id={id} width={width} height={height} patternUnits="userSpaceOnUse" x={x} y={y}>
          <path d={`M.5 ${height}V.5H${width}`} fill="none" strokeDasharray={strokeDasharray} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${id})`} />
      {squares && (
        <svg x={x} y={y} className="overflow-visible">
          {squares.map(([sx, sy]) => (
            <rect
              strokeWidth="0"
              key={`${sx}-${sy}`}
              width={width - 1}
              height={height - 1}
              x={sx * width + 1}
              y={sy * height + 1}
            />
          ))}
        </svg>
      )}
    </svg>
  )
}