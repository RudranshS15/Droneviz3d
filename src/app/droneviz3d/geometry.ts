/**
 * geometry.ts — shared deterministic math for the reconstruction pipeline.
 *
 * Conventions
 * -----------
 * Local frame (meters): x = East, y = North, z = Up. Origin is the user-supplied
 * GPS reference point. Geoid flattening is ignored (fine for < 2 km footprints).
 *
 * All randomness is seeded (mulberry32) so a given upload always reconstructs
 * to the same model — no Math.random() anywhere in the pipeline.
 */

// ---------- Seeded PRNG ----------

export function hashString(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- Geodesy ----------

export interface LngLat { lat: number; lng: number }

const METERS_PER_DEG_LAT = 111_320

export function metersPerDegLng(lat: number): number {
  return METERS_PER_DEG_LAT * Math.max(0.01, Math.cos((lat * Math.PI) / 180))
}

export function lngLatToLocal(origin: LngLat, p: LngLat): { x: number; y: number } {
  return {
    x: (p.lng - origin.lng) * metersPerDegLng(origin.lat),
    y: (p.lat - origin.lat) * METERS_PER_DEG_LAT,
  }
}

export function localToLngLat(origin: LngLat, x: number, y: number): LngLat {
  return {
    lat: origin.lat + y / METERS_PER_DEG_LAT,
    lng: origin.lng + x / metersPerDegLng(origin.lat),
  }
}

// ---------- Flight trajectory ----------

/** Degrees → radians */
export const deg2rad = (d: number) => (d * Math.PI) / 180

export interface FlightParams {
  gpsLat: number
  gpsLng: number
  altitude: number
  speed: number
  heading: number
  durationSec: number
  rtkCorrections: boolean
}

export interface CameraPoseLocal {
  /** local ENU meters */
  x: number
  y: number
  z: number
  /** radians, 0 = North, clockwise */
  yaw: number
  /** radians, negative = gimbal tilted down from horizon */
  pitch: number
  /** normalized progress along the pass, 0..1 */
  t: number
  frameIndex: number
  timeOffset: number
}

/**
 * Single-pass trajectory: a straight line at constant ground speed and altitude,
 * starting at the GPS reference point, oriented along `heading`.
 *
 * ASSUMED, NOT RECOVERED. This is a model of the flight, built from five scalars
 * (start point, altitude, speed, heading, duration) — it is not a trajectory
 * recovered from the video or from a flight log. Turns, hovering, altitude
 * changes and camera rotation all invalidate it, and `ASSUMED_GIMBAL_PITCH`
 * below stands in for gimbal telemetry that a single-file upload does not carry.
 * The UI labels the drawn path "assumed" for this reason; recovering the real
 * path needs time-aligned telemetry and calibrated camera poses.
 */
export const TRAJECTORY_ASSUMED = true

/** Documented fallback when the flight log has no gimbal telemetry. */
export const ASSUMED_GIMBAL_PITCH = -75 // degrees from horizon

export function poseAt(flight: FlightParams, t: number, frameIndex = 0): CameraPoseLocal {
  const totalDistance = Math.max(0, flight.speed * flight.durationSec)
  const yawRad = deg2rad(flight.heading)
  const d = t * totalDistance
  return {
    x: Math.sin(yawRad) * d,
    y: Math.cos(yawRad) * d,
    z: flight.altitude,
    yaw: yawRad,
    pitch: deg2rad(ASSUMED_GIMBAL_PITCH),
    t,
    frameIndex,
    timeOffset: t * flight.durationSec,
  }
}

export function poseToLngLat(flight: FlightParams, pose: CameraPoseLocal): LngLat {
  return localToLngLat({ lat: flight.gpsLat, lng: flight.gpsLng }, pose.x, pose.y)
}

// ---------- Camera model ----------

export interface CameraModel {
  /** 35mm-equivalent focal length entered by the user (mm) */
  focal35: number
  frameWidth: number
  frameHeight: number
}

export const FULL_FRAME_WIDTH_MM = 36
export const FULL_FRAME_HEIGHT_MM = 24
/** Full-frame diagonal, mm — the quantity a 35mm-equivalent focal length preserves. */
export const FULL_FRAME_DIAGONAL_MM = Math.hypot(FULL_FRAME_WIDTH_MM, FULL_FRAME_HEIGHT_MM)

/**
 * Horizontal / vertical field of view for the camera, in radians.
 *
 * The convention: `focal35` is a 35mm *equivalent* focal length, so it preserves
 * the diagonal angle of view of a full-frame (36×24 mm) sensor. That diagonal is
 * then spread over the frame's real aspect ratio — a 16:9 frame is wider and
 * shorter than 3:2, so its horizontal FOV is larger and its vertical FOV smaller
 * for the same focal length.
 *
 * The previous version hard-coded 36×24 mm for both axes, which ignored
 * `frameWidth` / `frameHeight` entirely: a 3840×2160 upload was modelled as a
 * 3:2 sensor, so every ray through a corner of the frame was off. A calibrated
 * camera (fx, fy, cx, cy + distortion) would be better still; the UI collects a
 * 35mm-equivalent focal length, so this is the correct conversion for that input.
 */
export function cameraFov(cam: CameraModel): { hfov: number; vfov: number } {
  const f = Math.max(1, cam.focal35)
  const w = cam.frameWidth
  const h = cam.frameHeight
  // Fall back to the 3:2 full-frame aspect when the frame size is unusable, so a
  // bad input degrades to the old behaviour instead of producing NaN angles.
  const aspect = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : FULL_FRAME_WIDTH_MM / FULL_FRAME_HEIGHT_MM
  const sensorW = FULL_FRAME_DIAGONAL_MM / Math.sqrt(1 + 1 / (aspect * aspect))
  const sensorH = sensorW / aspect
  return {
    hfov: 2 * Math.atan(sensorW / (2 * f)),
    vfov: 2 * Math.atan(sensorH / (2 * f)),
  }
}

export interface Vec3 { x: number; y: number; z: number }

/**
 * Ray direction through a normalized image point (u, v in 0..1, v measured from
 * the top edge) in world (ENU) coordinates for the given camera pose.
 */
export function rayThroughImagePoint(
  pose: CameraPoseLocal,
  cam: CameraModel,
  u: number,
  v: number
): Vec3 {
  const { hfov, vfov } = cameraFov(cam)
  // Camera basis: forward = view direction, right, up.
  const cp = Math.cos(pose.pitch)
  const forward: Vec3 = {
    x: Math.sin(pose.yaw) * cp,
    y: Math.cos(pose.yaw) * cp,
    z: Math.sin(pose.pitch),
  }
  const worldUp: Vec3 = { x: 0, y: 0, z: 1 }
  // right = normalize(forward × worldUp)
  let rx = forward.y * worldUp.z - forward.z * worldUp.y
  let ry = forward.z * worldUp.x - forward.x * worldUp.z
  let rz = forward.x * worldUp.y - forward.y * worldUp.x
  const rLen = Math.hypot(rx, ry, rz) || 1
  rx /= rLen; ry /= rLen; rz /= rLen
  // up' = right × forward
  const ux = ry * forward.z - rz * forward.y
  const uy = rz * forward.x - rx * forward.z
  const uz = rx * forward.y - ry * forward.x

  const halfW = Math.tan(hfov / 2)
  const halfH = Math.tan(vfov / 2)
  const a = (u * 2 - 1) * halfW
  const b = (1 - v * 2) * halfH // image v grows downward; camera up is +v

  const dx = forward.x + a * rx + b * ux
  const dy = forward.y + a * ry + b * uy
  const dz = forward.z + a * rz + b * uz
  const len = Math.hypot(dx, dy, dz) || 1
  return { x: dx / len, y: dy / len, z: dz / len }
}

/** Intersect a ray from `origin` with the z = 0 ground plane. Returns null for upward rays. */
export function intersectGround(origin: Vec3, dir: Vec3): Vec3 | null {
  if (dir.z >= -1e-6) return null
  const t = -origin.z / dir.z
  return { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: 0 }
}

/** Distance between two local points on the ground plane. */
export function groundDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
