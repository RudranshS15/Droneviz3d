/**
 * hero-points.ts — deterministic geometry behind the landing hero's point field.
 *
 * Decorative only: an abstract scanned surface, not a model of anything, and the
 * canvas that draws it is `aria-hidden`. It is deterministic by construction —
 * the same seed yields identical points in the server render and in the browser —
 * because a `Math.random()` field renders differently on each side of hydration.
 * That is not hypothetical: the before/after illustration on the same page did
 * exactly that, so every load logged a hydration mismatch.
 *
 * Colours come from `tokens.ts`, the palette `viewer-render.ts` matches, so the
 * hero and the viewer cannot drift apart. The maths lives here, separate from the
 * canvas, so it can be tested without a DOM.
 */

import { mulberry32 } from './geometry'

export interface HeroPoint {
  /** horizontal position in field units, [-1, 1] */
  x: number
  /** height of the abstract surface, [0, 1] */
  y: number
  /** depth position in field units, [-1, 1] */
  z: number
  /** stable per-point material selector in [0, 1) */
  tone: number
}

export interface ProjectedPoint {
  /** screen position in view units, roughly [-1, 1] */
  x: number
  y: number
  /** camera-space distance; larger is farther away */
  depth: number
  /** 1 for the nearest point, 0 for the farthest — drives size and opacity */
  fade: number
  /** the source point's material selector, carried through for the painter */
  tone: number
}

export interface HeroView {
  /** rotation about the vertical axis, radians */
  yaw: number
  /** downward tilt of the camera, radians */
  tilt: number
  /** focal length in view units */
  scale: number
  /** how far the camera sits from the field centre */
  distance: number
}

export type HeroMaterial = 'chalk' | 'stone' | 'amber' | 'copper'

export const HERO_FIELD_SIZE = 1400
export const HERO_SEED = 0x5eed1e
/** One dot per this many canvas pixels keeps the density the same at any size. */
const PIXELS_PER_DOT = 900
const MIN_FIELD = 350
const MAX_FIELD = 2200

const TAU = Math.PI * 2
/** Camera height above the mean surface, and how flat the surface reads. */
const CAMERA_LIFT = 0.45
const SURFACE_FLATTEN = 0.6
/** Floor on camera distance so a wrapped point cannot divide by ~zero. */
const MIN_DEPTH = 0.15

/**
 * How many dots a canvas of this size should carry.
 *
 * A fixed count is wrong at both extremes: on a narrow panel 1400 dots overlap
 * into a bright smear (measured: peak alpha 228 of 255), and on a large screen
 * the same field reads as a sparse speckle. Scaling with area holds the density
 * constant, and clamping keeps a degenerate canvas from asking for a zero-length
 * or enormous field.
 */
export function heroFieldSize(width: number, height: number): number {
  const area = Math.max(0, width) * Math.max(0, height)
  return Math.round(Math.min(MAX_FIELD, Math.max(MIN_FIELD, area / PIXELS_PER_DOT)))
}

/** The three phase offsets that make one seed's surface unique. */
export function heroPhases(seed: number = HERO_SEED): [number, number, number] {
  const rng = mulberry32(seed)
  return [rng() * TAU, rng() * TAU, rng() * TAU]
}

/**
 * Stable height of the abstract surface at (x, z), in [0, 1].
 *
 * A seeded sum of sines plus a rounded centre dome: smooth enough that the
 * projected field reads as a scanned terrain rather than noise, bounded so no
 * sample can escape the draw area, and free of randomness so it can be called
 * (and tested) directly.
 */
export function surfaceHeight(x: number, z: number, phases: readonly number[]): number {
  const [p0, p1, p2] = phases
  const swell = (Math.sin(x * 3.1 + p0) + Math.cos(z * 2.3 + p1)) * 0.5
  const detail = Math.sin((x + z) * 5.7 + p2) * 0.3
  const dome = Math.max(0, 1 - Math.hypot(x, z)) * 0.5
  const height = (swell + detail) * 0.28 + dome
  return Math.min(1, Math.max(0, height))
}

/**
 * Deterministic field of surface samples, uniformly spread over the unit disc.
 *
 * Same seed → identical points, in the same order, on every machine.
 */
export function buildHeroField(count: number = HERO_FIELD_SIZE, seed: number = HERO_SEED): HeroPoint[] {
  const phases = heroPhases(seed)
  // A separate stream so the point layout does not shift with the phase count.
  const rng = mulberry32(seed ^ 0x9e3779b9)
  const points: HeroPoint[] = []
  for (let i = 0; i < Math.max(0, count); i += 1) {
    const angle = rng() * TAU
    const radius = Math.sqrt(rng())
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    points.push({ x, y: surfaceHeight(x, z, phases), z, tone: rng() })
  }
  return points
}

/**
 * Rotate, tilt and project the field. Output is in view units — the caller only
 * maps it to pixels — and `fade` is normalised across this projection, so the
 * nearest point is always 1 and the farthest always 0 regardless of the view.
 */
export function projectField(points: readonly HeroPoint[], view: HeroView): ProjectedPoint[] {
  const cosYaw = Math.cos(view.yaw)
  const sinYaw = Math.sin(view.yaw)
  const cosTilt = Math.cos(view.tilt)
  const sinTilt = Math.sin(view.tilt)

  const projected = points.map((point) => {
    const rx = point.x * cosYaw - point.z * sinYaw
    const rz = point.x * sinYaw + point.z * cosYaw
    const ry = (point.y - CAMERA_LIFT) * SURFACE_FLATTEN
    const ty = ry * cosTilt - rz * sinTilt
    const tz = ry * sinTilt + rz * cosTilt
    const depth = Math.max(MIN_DEPTH, tz + view.distance)
    const zoom = view.scale / depth
    return { x: rx * zoom, y: -ty * zoom, depth, tone: point.tone }
  })

  let nearest = Infinity
  let farthest = -Infinity
  for (const point of projected) {
    if (point.depth < nearest) nearest = point.depth
    if (point.depth > farthest) farthest = point.depth
  }
  const span = farthest - nearest

  return projected.map((point) => ({
    x: point.x,
    y: point.y,
    depth: point.depth,
    tone: point.tone,
    fade: span > 0 ? 1 - (point.depth - nearest) / span : 1,
  }))
}

/**
 * Most of the field is neutral chalk and stone; copper and amber are sparse
 * accents, the same restraint the viewer uses for its scene.
 */
export function pointMaterial(tone: number): HeroMaterial {
  if (tone < 0.06) return 'copper'
  if (tone < 0.18) return 'amber'
  if (tone < 0.55) return 'stone'
  return 'chalk'
}
