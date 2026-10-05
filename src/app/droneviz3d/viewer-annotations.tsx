'use client'

/**
 * viewer-annotations.tsx — the screen-space overlay: marker rings, object
 * labels, the take-off label and the orientation gizmo.
 *
 * These are DOM elements rather than geometry drawn into the WebGL canvas. That
 * is deliberate: they are annotations, not scene, so they keep exact pixel sizes
 * at any zoom, stay crisp on any display, and can be asserted without a GPU. The
 * old canvas renderer drew them as part of its frame, which is why the results
 * page preview lost them when the scene moved to three.js — both surfaces now
 * render this one component from the same pure frame, so they cannot drift apart
 * again.
 *
 * Positions come from viewer-frame.ts, which projects with the same camera the
 * scene is drawn with.
 */

import { VIEWER_PALETTE } from './viewer-frame'
import type { ViewerFrame } from './viewer-frame'
import { LABEL_DY, LABEL_OFFSET_X } from './viewer-labels'

export interface SceneAnnotationsProps {
  frame: ViewerFrame | null
  /** Where the gizmo sits, so a small preview can place it differently. */
  gizmoClassName?: string
  showGizmo?: boolean
}

export function SceneAnnotations({
  frame,
  gizmoClassName = 'top-4 right-4',
  showGizmo = true,
}: SceneAnnotationsProps) {
  if (!frame) return null

  return (
    <>
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {frame.annotations.map((annotation) => (
          <span
            key={annotation.index}
            className={`absolute rounded-full border ${
              annotation.selected ? 'border-cyan-400' : 'border-[#d4a053]'
            }`}
            style={{
              left: annotation.x - (annotation.selected ? 8 : 6),
              top: annotation.y - (annotation.selected ? 8 : 6),
              width: annotation.selected ? 16 : 12,
              height: annotation.selected ? 16 : 12,
            }}
          />
        ))}
        {frame.annotations.filter((annotation) => annotation.labelled).map((annotation) => (
          <span
            key={`label-${annotation.index}`}
            className={`absolute whitespace-nowrap text-[11px] leading-none ${
              annotation.selected ? 'text-cyan-300' : 'text-[#e7e5e4]'
            }`}
            style={{
              left: annotation.x + LABEL_OFFSET_X,
              top: annotation.y + LABEL_DY,
              transform: 'translateY(-50%)',
            }}
          >
            {annotation.text}
          </span>
        ))}
        {frame.trajectory.takeoff && (
          <span
            className="absolute font-mono text-[10px] text-[#e7e5e4]"
            style={{
              left: frame.trajectory.takeoff.x,
              top: frame.trajectory.takeoff.y,
              transform: 'translateY(-50%)',
            }}
          >
            take-off
          </span>
        )}
      </div>

      {showGizmo && (
        <svg
          viewBox="0 0 52 52"
          className={`pointer-events-none absolute w-[52px] h-[52px] ${gizmoClassName}`}
          aria-hidden="true"
        >
          <circle cx="26" cy="26" r={26 * 0.42} fill="rgba(9, 9, 11, 0.55)" />
          {frame.gizmo.map((axis) => {
            const x = 26 + axis.dx
            const y = 26 + axis.dy
            const color = axis.key === 'U' ? VIEWER_PALETTE.accent : VIEWER_PALETTE.text
            return (
              <g key={axis.key} opacity={axis.depth <= 0 ? 1 : 0.45}>
                <line x1="26" y1="26" x2={x} y2={y} stroke={color} strokeWidth={2} />
                <circle cx={x} cy={y} r={4} fill={color} />
                <text
                  x={x} y={y + 3.5} textAnchor="middle" fontSize="10"
                  fontFamily="monospace" fill={VIEWER_PALETTE.background}
                >
                  {axis.key}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </>
  )
}
