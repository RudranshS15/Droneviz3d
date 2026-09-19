/**
 * viewer-camera.ts — orbit camera, framing and projection for the 3D viewer.
 *
 * The model is produced in the local ENU frame (x = East, y = North, z = Up,
 * meters) — see geometry.ts. The viewer must never re-interpret those axes:
 * instead of hard-coding a "y is up" camera, every screen position here is
 * derived from an explicit camera basis with world up = +z, so
 *   - the ground plane is always horizontal on screen and heights rise on screen,
 *   - the orientation gizmo is drawn from the same basis as the points, so it
 *     can never disagree with what is rendered,
 *   - elevation is clamped away from the poles so `right`/`up` stay well defined.
 *
 * Everything in this module is pure so it can be unit tested without a DOM.
 */

export interface Vec3 { x: number; y: number; z: number }

export const WORLD_UP: Vec3 = { x: 0, y: 0, z: 1 }

/** Vertical field of view for the orbit camera (45°). */
export const DEFAULT_FOV_Y = (45 * Math.PI) / 180

/** Elevation is clamped short of the poles: with the camera exactly overhead the
 *  world-up cross product degenerates and screen-up becomes arbitrary. */
export const MIN_ELEVATION = (-85 * Math.PI) / 180
export const MAX_ELEVATION = (85 * Math.PI) / 180

export const MIN_DISTANCE = 1
export const MAX_DISTANCE = 20000

export interface Viewport { width: number; height: number }

export interface OrbitCamera {
  /** the point the camera orbits, in local ENU meters */
  target: Vec3
  /** radians. Bearing from the target to the camera: 0 = camera due South of the
   *  target looking North; +90° = camera due East looking West. */
  azimuth: number
  /** radians above the horizon; clamped to ±85° */
  elevation: number
  /** meters from target to eye */
  distance: number
  /** vertical field of view, radians */
  fovY: number
}

export interface ViewBasis {
  eye: Vec3
  /** unit vector from the eye toward the target */
  forward: Vec3
  /** unit screen-right vector */
  right: Vec3
  /** unit screen-up vector (never the world up unless the camera is level) */
  up: Vec3
}

export function clampElevation(elevation: number): number {
  if (!Number.isFinite(elevation)) return 0
  return Math.max(MIN_ELEVATION, Math.min(MAX_ELEVATION, elevation))
}

export function clampDistance(distance: number): number {
  if (!Number.isFinite(distance)) return MIN_DISTANCE
  return Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, distance))
}

export function degToRad(d: number): number {
  return (d * Math.PI) / 180
}

export function radToDeg(r: number): number {
  return (r * 180) / Math.PI
}

/** Unit vector from the target to the eye. */
export function orbitDirection(cam: OrbitCamera): Vec3 {
  const el = clampElevation(cam.elevation)
  const ce = Math.cos(el)
  return {
    x: Math.sin(cam.azimuth) * ce,
    y: -Math.cos(cam.azimuth) * ce,
    z: Math.sin(el),
  }
}

/**
 * Orthonormal camera basis with world up = +z.
 * `forward` points from the eye at the target, `right = forward × worldUp`
 * (normalized), and `up = right × forward`.
 */
export function viewBasis(cam: OrbitCamera): ViewBasis {
  const dir = orbitDirection(cam)
  const distance = clampDistance(cam.distance)
  const eye: Vec3 = {
    x: cam.target.x + dir.x * distance,
    y: cam.target.y + dir.y * distance,
    z: cam.target.z + dir.z * distance,
  }
  const forward: Vec3 = { x: -dir.x, y: -dir.y, z: -dir.z }

  // right = normalize(forward × worldUp)
  let rx = forward.y * WORLD_UP.z - forward.z * WORLD_UP.y
  let ry = forward.z * WORLD_UP.x - forward.x * WORLD_UP.z
  let rz = forward.x * WORLD_UP.y - forward.y * WORLD_UP.x
  const rLen = Math.hypot(rx, ry, rz)
  if (rLen < 1e-9) {
    // Degenerate (looking straight down/up): fall back to a North-facing basis.
    rx = 1; ry = 0; rz = 0
  } else {
    rx /= rLen; ry /= rLen; rz /= rLen
  }
  // up = right × forward
  const ux = ry * forward.z - rz * forward.y
  const uy = rz * forward.x - rx * forward.z
  const uz = rx * forward.y - ry * forward.x

  return { eye, forward, right: { x: rx, y: ry, z: rz }, up: { x: ux, y: uy, z: uz } }
}

/** Pixels per unit at unit depth. */
export function focalLengthPx(cam: OrbitCamera, viewport: Viewport): number {
  const fov = Math.max(0.05, cam.fovY)
  return Math.max(1, viewport.height / 2) / Math.tan(fov / 2)
}

export interface ProjectedPoint { x: number; y: number; depth: number }

/** Nearest depth the camera will draw; anything closer is culled. */
export const NEAR_PLANE = 0.5

/**
 * Project a world point to screen pixels. Returns null for points behind the
 * near plane. Screen y grows downward, so screen-up maps to `up`.
 */
export function projectPoint(
  cam: OrbitCamera,
  basis: ViewBasis,
  p: Vec3,
  viewport: Viewport
): ProjectedPoint | null {
  const dx = p.x - basis.eye.x
  const dy = p.y - basis.eye.y
  const dz = p.z - basis.eye.z
  const depth = dx * basis.forward.x + dy * basis.forward.y + dz * basis.forward.z
  if (depth <= NEAR_PLANE) return null
  const right = dx * basis.right.x + dy * basis.right.y + dz * basis.right.z
  const up = dx * basis.up.x + dy * basis.up.y + dz * basis.up.z
  const focal = focalLengthPx(cam, viewport)
  return {
    x: viewport.width / 2 + (right / depth) * focal,
    y: viewport.height / 2 - (up / depth) * focal,
    depth,
  }
}

/** Project a world *direction* (ignores translation) — used for the gizmo. */
export function projectDirection(basis: ViewBasis, dir: Vec3): { right: number; up: number; depth: number } {
  return {
    right: dir.x * basis.right.x + dir.y * basis.right.y + dir.z * basis.right.z,
    up: dir.x * basis.up.x + dir.y * basis.up.y + dir.z * basis.up.z,
    depth: dir.x * basis.forward.x + dir.y * basis.forward.y + dir.z * basis.forward.z,
  }
}

// ---------------------------------------------------------------------------
// Scene bounds + framing
// ---------------------------------------------------------------------------

export interface Bounds3 { min: Vec3; max: Vec3; center: Vec3; radius: number }

function boundsOf(points: readonly Vec3[]): Bounds3 {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.z < minZ) minZ = p.z
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
    if (p.z > maxZ) maxZ = p.z
  }
  if (!Number.isFinite(minX)) {
    const zero = { x: 0, y: 0, z: 0 }
    return { min: zero, max: zero, center: zero, radius: 0 }
  }
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 }
  const radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ }, center, radius }
}

/**
 * Bounding sphere used to frame the scene.
 *
 * A small minority of points can sit far outside the reconstruction: the drone
 * track is stored as sparse markers that extend for kilometres along the flight
 * leg, while the reconstructed corridor is a few hundred metres across. Framing
 * on the raw min/max would therefore zoom out until the model is a speck, so the
 * farthest `trimFraction` of points (by distance from the centroid) is left out
 * of the *framing* bounds — they are still rendered when their layer is enabled.
 * Trimming only engages on clouds large enough for the percentile to mean
 * something.
 */
export function boundingSphere(points: readonly Vec3[], trimFraction = 0.02): Bounds3 {
  if (points.length === 0) return boundsOf(points)
  const trimCount = points.length > 500 ? Math.floor(points.length * Math.max(0, trimFraction)) : 0
  if (trimCount === 0) return boundsOf(points)

  let sx = 0, sy = 0, sz = 0
  for (const p of points) { sx += p.x; sy += p.y; sz += p.z }
  const mean = { x: sx / points.length, y: sy / points.length, z: sz / points.length }

  const distances = points.map((p) => Math.hypot(p.x - mean.x, p.y - mean.y, p.z - mean.z))
  const sorted = [...distances].sort((a, b) => a - b)
  const cutoff = sorted[points.length - trimCount - 1]

  const kept: Vec3[] = []
  for (let i = 0; i < points.length; i++) if (distances[i] <= cutoff) kept.push(points[i])
  return kept.length > 0 ? boundsOf(kept) : boundsOf(points)
}

/**
 * Distance at which a sphere of `radius` exactly fits the viewport, honouring
 * both the vertical and horizontal field of view, with a little margin.
 */
export function fitDistance(radius: number, fovY: number, aspect: number, margin = 1.12): number {
  const r = Math.max(radius, 0.5)
  const vFov = Math.max(0.05, fovY)
  const a = Math.max(0.05, aspect)
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * a)
  const dV = r / Math.sin(vFov / 2)
  const dH = r / Math.sin(hFov / 2)
  return clampDistance(margin * Math.max(dV, dH))
}

/** The eight corners of a bounds box. */
export function boundsCorners(bounds: Bounds3): Vec3[] {
  const corners: Vec3[] = []
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) corners.push({ x, y, z })
    }
  }
  return corners
}

/**
 * Distance at which the bounds box exactly fills the viewport, measured by
 * projecting its eight corners through the real camera.
 *
 * A bounding-sphere fit is correct but conservative: reconstruction footprints
 * are wide and flat, so the sphere is far larger than the model on screen and
 * the model ends up small in frame. This starts from the safe sphere distance and
 * then scales it until the corners reach the frame edge (with a small margin).
 * The step is damped because the extent ratio overshoots when applied undamped —
 * measured convergence is monotonic at 0.6 over about six passes.
 */
export function fitDistanceToBounds(
  bounds: Bounds3,
  camera: OrbitCamera,
  viewport: Viewport,
  margin = 1.08
): number {
  const aspect = viewport.width / Math.max(1, viewport.height)
  if (!(bounds.radius > 0)) return fitDistance(bounds.radius, camera.fovY, aspect, margin)

  let distance = fitDistance(bounds.radius, camera.fovY, aspect, 1)
  const corners = boundsCorners(bounds)
  const halfW = Math.max(1, viewport.width / 2)
  const halfH = Math.max(1, viewport.height / 2)

  for (let pass = 0; pass < 8; pass++) {
    const probe: OrbitCamera = { ...camera, distance }
    const basis = viewBasis(probe)
    let worst = 0
    for (const corner of corners) {
      const p = projectPoint(probe, basis, corner, viewport)
      if (!p) continue
      worst = Math.max(worst, Math.abs(p.x - halfW) / halfW, Math.abs(p.y - halfH) / halfH)
    }
    if (worst <= 0 || !Number.isFinite(worst)) break
    const target = worst * margin
    if (Math.abs(target - 1) < 0.005) break
    distance = clampDistance(distance * (1 + (target - 1) * 0.6))
  }
  return distance
}

/** The default view: from the South, ~28° above the horizon, framed to fit. */
export function frameCamera(
  bounds: Bounds3,
  viewport: Viewport,
  fovY = DEFAULT_FOV_Y,
  azimuth = 0,
  elevation = degToRad(28)
): OrbitCamera {
  const camera: OrbitCamera = {
    target: bounds.center,
    azimuth,
    elevation: clampElevation(elevation),
    distance: MIN_DISTANCE,
    fovY,
  }
  return { ...camera, distance: fitDistanceToBounds(bounds, camera, viewport) }
}

/** Point the camera at `target`, keeping the current viewing direction. */
export function focusCamera(
  cam: OrbitCamera,
  target: Vec3,
  radius: number,
  viewport: Viewport,
  margin = 2.4
): OrbitCamera {
  const aspect = viewport.width / Math.max(1, viewport.height)
  return {
    ...cam,
    target,
    distance: fitDistance(radius, cam.fovY, aspect, margin),
  }
}

/** Named camera orientations the viewer exposes as buttons (keyboard friendly). */
export interface ViewPreset { id: string; label: string; azimuth: number; elevation: number }

export const VIEW_PRESETS: ViewPreset[] = [
  // azimuth 0 = camera due South of the target, looking North.
  { id: 'default', label: 'Oblique', azimuth: 0, elevation: degToRad(28) },
  { id: 'top', label: 'Top-down', azimuth: 0, elevation: degToRad(85) },
  { id: 'east', label: 'From the East', azimuth: degToRad(90), elevation: degToRad(28) },
  { id: 'north', label: 'From the North', azimuth: degToRad(180), elevation: degToRad(28) },
]

// ---------------------------------------------------------------------------
// Orientation gizmo
// ---------------------------------------------------------------------------

export type GizmoAxisKey = 'E' | 'N' | 'U'

export interface GizmoAxis {
  key: GizmoAxisKey
  label: string
  /** screen offset from the gizmo origin, pixels (y grows downward) */
  dx: number
  dy: number
  /** component along the view direction: positive = away from the camera */
  depth: number
}

/**
 * Axis directions for the orientation gizmo, in the model's ENU frame.
 * `radius` is the gizmo's on-screen length in pixels. Drawn with the same
 * camera basis as the points, so the gizmo cannot disagree with the view.
 */
export function gizmoAxes(basis: ViewBasis, radius: number): GizmoAxis[] {
  const axes: { key: GizmoAxisKey; label: string; dir: Vec3 }[] = [
    { key: 'E', label: 'East', dir: { x: 1, y: 0, z: 0 } },
    { key: 'N', label: 'North', dir: { x: 0, y: 1, z: 0 } },
    { key: 'U', label: 'Up', dir: { x: 0, y: 0, z: 1 } },
  ]
  // Paint the far axes first so the near ones overlap them, like a real gizmo.
  return axes
    .map((a) => {
      const s = projectDirection(basis, a.dir)
      return { key: a.key, label: a.label, dx: s.right * radius, dy: -s.up * radius, depth: s.depth }
    })
    .sort((a, b) => b.depth - a.depth)
}

// ---------------------------------------------------------------------------
// Picking + point sizing
// ---------------------------------------------------------------------------

export interface ProjectedMarker { index: number; x: number; y: number }

/**
 * Nearest projected marker to a screen point, within `maxPx`.
 * Returns the marker's `index` (its position in the caller's object array).
 */
export function pickNearestObject(
  markers: readonly ProjectedMarker[],
  sx: number,
  sy: number,
  maxPx = 16
): number | null {
  let best: number | null = null
  let bestDist = maxPx
  for (const m of markers) {
    const d = Math.hypot(m.x - sx, m.y - sy)
    if (d <= bestDist) {
      bestDist = d
      best = m.index
    }
  }
  return best
}

/**
 * Screen size for a point, gently attenuated by depth so nearer points read as
 * nearer without the wild swings of a pure 1/depth law. `basePx` is the user's
 * chosen size and `refDepth` the camera distance, at which the chosen size is
 * exact.
 */
export function attenuatedSize(basePx: number, depth: number, refDepth: number): number {
  const base = Math.max(0.5, basePx)
  const ref = Math.max(1, refDepth)
  const scale = Math.max(0.5, Math.min(2.5, ref / Math.max(depth, 1)))
  return Math.max(0.6, base * scale)
}
