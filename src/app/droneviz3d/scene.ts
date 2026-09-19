/**
 * How far from the model centre (in model radii) a flight path pose can sit and
 * still count as "over the reconstruction".
 */
export const PATH_REACH = 1.6

/**
 * Bounds covering the model plus the part of the flight path directly over it.
 * Exported for testing: this is what decides whether a 1.4 km flight leg drags
 * the framing out until the reconstruction is a speck.
 */
export function boundsIncludingNearPath(bounds: Bounds3, path: readonly Vec3[]): Bounds3 {
  if (path.length === 0 || bounds.radius <= 0) return bounds
  const reach = bounds.radius * PATH_REACH
  // Measured on the ground plane on purpose: cruise altitude is exactly what the
  // path view exists to reveal, so it must not be what excludes a pose.
  const near = path.filter(
    (p) => Math.hypot(p.x - bounds.center.x, p.y - bounds.center.y) <= reach
  )
  if (near.length === 0) return bounds

  // The union box of the model bounds and the near poses: covering both without
  // re-deriving anything keeps the model fully framed in the path view.
  const min = { ...bounds.min }
  const max = { ...bounds.max }
  for (const p of near) {
    min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z)
    max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z)
  }
  const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 }
  return { min, max, center, radius: Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2 }
}

/**
 * scene.ts — turn stored reconstruction data into what the viewer renders.
 *
 * This is the seam between the pipeline's data model and the renderer. It
 * converts the georeferenced flight poses back into the local ENU frame the
 * model is drawn in, splits the drone track out of the point cloud, and frames
 * the scene. Keeping it out of the React component makes the conversion
 * testable — a lat/lng sign error here would silently misplace the flight path.
 */

import { lngLatToLocal } from './geometry'
import { Bounds3, Vec3, boundingSphere } from './viewer-camera'
import { Point3D, ReconstructionPose, isTrajectoryPoint } from './reconstruct'
import { TrackedObject } from './grounding'

export interface SceneOrigin { lat: number; lng: number }

export interface SceneModel {
  /** model points (ground + objects), drone-track markers removed */
  points: Point3D[]
  /** the drone-track markers pulled out of the cloud, in cloud order */
  trackMarkers: Point3D[]
  /** the flight path as local ENU positions, from the georeferenced poses */
  trajectoryPath: Vec3[]
  objects: TrackedObject[]
  /** framing bounds: the model, not the kilometres-long flight leg */
  bounds: Bounds3
  /**
   * Framing bounds for the model *plus the nearby part of the flight path*.
   * A drone cruises far above a flat reconstruction, so the default view can sit
   * entirely below the path; this is what the viewer's "fit flight path" action
   * frames. Poses further than `PATH_REACH` model radii away are left out: a
   * kilometre-long flight leg would otherwise shrink the model to a speck.
   */
  pathBounds: Bounds3
  /** WGS84 origin of the local frame, when usable */
  origin: SceneOrigin | null
  /** true when the stored model has no geometry to draw */
  empty: boolean
}

export interface BuildSceneInput {
  pointCloud: readonly Point3D[]
  trajectory: readonly ReconstructionPose[]
  trackedObjects: readonly TrackedObject[]
  metadata: { gpsLat: string; gpsLng: string }
  /** fraction of far outliers ignored when framing (see boundingSphere) */
  trimFraction?: number
}

export function parseOrigin(metadata: { gpsLat: string; gpsLng: string }): SceneOrigin | null {
  const lat = Number.parseFloat(metadata.gpsLat)
  const lng = Number.parseFloat(metadata.gpsLng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

export function buildSceneModel(input: BuildSceneInput): SceneModel {
  const origin = parseOrigin(input.metadata)

  const points: Point3D[] = []
  const trackMarkers: Point3D[] = []
  for (const p of input.pointCloud) {
    if (isTrajectoryPoint(p)) trackMarkers.push(p)
    else points.push(p)
  }

  // The georeferenced poses round-trip back to the local ENU frame exactly, so
  // the drawn flight path lands on the markers regardless of flight length.
  const trajectoryPath: Vec3[] = []
  if (origin) {
    for (const pose of input.trajectory) {
      const local = lngLatToLocal(origin, { lat: pose.lat, lng: pose.lng })
      trajectoryPath.push({ x: local.x, y: local.y, z: pose.altitude })
    }
  } else {
    for (const p of trackMarkers) trajectoryPath.push({ x: p.x, y: p.y, z: p.z })
  }

  // Frame on the reconstruction (ground + objects), never on the flight leg.
  const framing: Vec3[] = points.length > 0 ? points : trackMarkers
  const objectCenters: Vec3[] = input.trackedObjects.map((t) => t.center)
  const bounds = boundingSphere([...framing, ...objectCenters], input.trimFraction ?? 0.02)
  const pathBounds = boundsIncludingNearPath(bounds, trajectoryPath)

  return {
    points,
    trackMarkers,
    trajectoryPath,
    objects: [...input.trackedObjects],
    bounds,
    pathBounds,
    origin,
    empty: points.length === 0 && trackMarkers.length === 0,
  }
}
