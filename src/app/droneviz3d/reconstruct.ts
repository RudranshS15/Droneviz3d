/**
 * reconstruct.ts — geometry synthesis from grounded detections.
 *
 * The reconstruction is driven by LocateAnything-3B detections: every building /
 * vehicle / tree box seen on a keyframe is projected through the camera model onto
 * the ground plane, deduplicated across keyframes (multi-view corroboration), and
 * the 3D point cloud + mesh are generated from those grounded objects — not from
 * random noise. Same flight data ⇒ same model, byte for byte.
 *
 * What is synthesized (and labeled as such in the UI): surface texture detail and
 * fine geometry between detected objects, since a single straight pass with no
 * stereo overlap cannot recover those photogrammetrically. This is stated plainly
 * in the UI and in privacy/legal docs.
 */

import {
  CameraModel, FlightParams, hashString, localToLngLat, mulberry32, poseAt, poseToLngLat,
} from './geometry'
import {
  GroundingResponse, KeyframePlan, ProjectedDetection, TrackedObject,
  projectBoxToGround, deduplicateDetections,
} from './grounding'
import { ValidatedFlightData } from './validator'
import { ReconstructStage } from './pipeline'

export interface Point3D {
  x: number; y: number; z: number
  r: number; g: number; b: number
  confidence: number
}

/**
 * Colour of the drone-track markers.
 *
 * The pipeline no longer embeds markers in the point cloud: the flight path is
 * exported separately as `trajectory` and the viewer draws it from those poses.
 * Embedding them used to inflate point counts, skew mean confidence (each marker
 * claimed 0.95) and write drone positions into every download as if they were
 * scene geometry. The colour and predicate are kept so a model persisted by an
 * older version is still split back out correctly by scene.ts.
 * No class colour in CLASS_COLORS collides with it.
 */
export const TRAJECTORY_RGB = { r: 60, g: 150, b: 220 } as const

export function isTrajectoryPoint(p: { r: number; g: number; b: number }): boolean {
  return p.r === TRAJECTORY_RGB.r && p.g === TRAJECTORY_RGB.g && p.b === TRAJECTORY_RGB.b
}

export interface ReconstructionPose {
  lat: number; lng: number; altitude: number
  pitch: number; yaw: number
  timeOffset: number; frameIndex: number
}

/**
 * Why an observation scored low. The pipeline currently measures none of the
 * specific conditions below, so every annotation it emits carries `'unknown'`.
 * The named causes are kept as the vocabulary a real detector or telemetry check
 * would report once one exists — assigning them by array position (which an
 * earlier version did) fabricated an explanation for every low-confidence object.
 */
export type ConfidenceCause =
  | 'unknown'
  | 'occlusion' | 'motion_blur' | 'low_parallax' | 'dynamic_object' | 'lighting' | 'gps_noise'

export interface ConfidenceAnnotation {
  x: number; y: number; z: number
  score: number
  cause: ConfidenceCause
  explanation: string
  affectedFrames: [number, number]
}

export interface ReconstructionMetrics {
  totalPoints: string
  accuracy: string
  processingTime: string
  coverage: string
  confidenceScore: string
  groundedObjects: string
  groundedLabels: string
  /** how many keyframes were sampled for grounding (a measured input) */
  keyframesSampled: string
  /**
   * How many keyframes were actually decoded from the upload. `keyframesSampled`
   * is the plan (a constant 24); this is what the decoder returned, so a clip the
   * browser could only partly seek shows up as fewer frames rather than as a
   * silent assumption that all 24 existed. Added by the store, which is where
   * the decode result is known; `'n/a (no decode)'` in simulated mode.
   */
  keyframesExtracted?: string
  /** where the detections came from — the model, or the simulated adapter */
  groundingSource: string
  /**
   * For simulated runs: what the illustrative scene was actually seeded from.
   * Present only when the detections are simulated, so a real-model run never
   * claims a synthesized seed — the honesty rule runs in both directions.
   */
  synthesisBasis?: string
  /**
   * One sentence naming what was measured and what was synthesized, so no
   * consumer has to infer it from the geometry. Object positions and extents
   * come from detections; object *heights* and the surface between them do not.
   */
  synthesis: string
  provenance: string
}

export interface ReconstructionResult {
  points: Point3D[]
  trajectory: ReconstructionPose[]
  annotations: ConfidenceAnnotation[]
  metrics: ReconstructionMetrics
  /** georeferenced bounds for the UI */
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }
  /**
   * Which grounding backend actually produced the detections behind this model.
   * Inferred from the responses themselves, so a worker failure that fell back
   * to the simulated adapter can never be presented as a real run.
   */
  groundingSource: GroundingSource
}

/** Where the detections that drive the reconstruction came from. */
export type GroundingSource = 'locateanything-3b' | 'simulated'

// ---------- Height field from tracked objects ----------

export interface HeightCell {
  /** max height in meters at this cell — a class prior, not a measurement */
  h: number
  label: string
  score: number
}

/**
 * Rasterize tracked objects into a height field: buildings become extruded
 * blocks, vehicles low pads, trees medium domes. Cell size ~1.5 m keeps memory
 * bounded while resolving typical building footprints.
 *
 * IMPORTANT — the heights are not measured. A single nadir-ish pass with no
 * stereo overlap cannot recover an object's height, so each class is given a
 * plausible prior (`CLASS_HEIGHT_PRIOR`) plus seeded jitter only to keep the
 * silhouette from looking like a stamped grid. The footprint (where the object
 * is, and how wide) comes from the detections; the vertical extent is
 * illustrative. Do not present these heights as observed geometry.
 */
export const CLASS_HEIGHT_PRIOR: Record<string, { base: number; jitter: number }> = {
  building: { base: 6, jitter: 14 },
  vehicle: { base: 1.5, jitter: 0 },
  tree: { base: 3, jitter: 4 },
}

/** One sentence, shown in the UI and written into exports, naming the synthesis. */
export const SYNTHESIS_NOTE =
  'Object footprints and positions are projected from detections; object heights and all surface points between objects are synthesized class-based estimates, not measured geometry.'
export function buildHeightField(tracked: TrackedObject[], extent: number, seed: number): Map<string, HeightCell> {
  const rand = mulberry32(seed ^ 0x9e3779b9)
  const CELL = 1.5
  const cells = new Map<string, HeightCell>()
  const half = extent / 2

  const put = (x: number, y: number, h: number, label: string, score: number) => {
    const key = `${Math.round(x / CELL)},${Math.round(y / CELL)}`
    const prev = cells.get(key)
    if (!prev || h > prev.h) cells.set(key, { h, label, score })
  }

  for (const t of tracked) {
    const isBuilding = t.label === 'building'
    const isTree = t.label === 'tree'
    // Class prior, not a measurement — see CLASS_HEIGHT_PRIOR above.
    const prior = CLASS_HEIGHT_PRIOR[t.label] ?? CLASS_HEIGHT_PRIOR.vehicle
    const baseH = prior.base + rand() * prior.jitter
    const jitter = 0.15
    for (let x = t.center.x - t.halfExtentX; x <= t.center.x + t.halfExtentX; x += CELL) {
      for (let y = t.center.y - t.halfExtentY; y <= t.center.y + t.halfExtentY; y += CELL) {
        // Buildings: flat roof with slight parapet noise; trees: dome; vehicles: flat pad.
        const nx = (x - t.center.x) / Math.max(t.halfExtentX, 0.1)
        const ny = (y - t.center.y) / Math.max(t.halfExtentY, 0.1)
        const edge = Math.max(Math.abs(nx), Math.abs(ny))
        let h = baseH
        if (isTree) h = baseH * Math.max(0.25, 1 - edge * edge)
        else if (isBuilding) h = baseH * (edge > 0.92 ? 0.85 : 1)
        put(x, y, h + (rand() - 0.5) * jitter, t.label, t.score)
      }
    }
    // Extend footprint to full cell coverage at the boundary.
    const ex = t.center.x + t.halfExtentX
    const ey = t.center.y + t.halfExtentY
    put(ex, ey, baseH, t.label, t.score)
    put(ex - CELL, ey, baseH, t.label, t.score)
    put(ex, ey - CELL, baseH, t.label, t.score)
    put(ex - CELL, ey - CELL, baseH, t.label, t.score)
  }
  void half
  return cells
}

// ---------- Point cloud synthesis ----------

const CLASS_COLORS: Record<string, [number, number, number]> = {
  building: [138, 131, 122],
  vehicle: [88, 96, 110],
  tree: [64, 110, 62],
  object: [110, 110, 110],
}

function colorFor(label: string, rand: () => number, shade: number): [number, number, number] {
  const base = CLASS_COLORS[label] ?? CLASS_COLORS.object
  const k = 0.82 + shade * 0.36
  return [
    Math.max(0, Math.min(255, Math.round(base[0] * k))),
    Math.max(0, Math.min(255, Math.round(base[1] * k))),
    Math.max(0, Math.min(255, Math.round(base[2] * k))),
  ]
}

/**
 * Synthesize the point cloud from the height field. Density is higher on object
 * surfaces (buildings, trees, vehicles) than on open ground; confidence comes
 * from grounding score + observation count, with plausible degradation near
 * footprint edges.
 */
function synthesizePointCloud(
  cells: Map<string, HeightCell>,
  tracked: TrackedObject[],
  flight: FlightParams,
  seed: number
): Point3D[] {
  const rand = mulberry32(seed ^ 0x51ed270b)
  const points: Point3D[] = []
  const CELL = 1.5

  // 1. Object surfaces: 2–6 samples per cell depending on class.
  for (const [key, cell] of cells) {
    const [gx, gy] = key.split(',').map(Number)
    const cx = gx * CELL
    const cy = gy * CELL
    const n = cell.label === 'building' ? 6 : cell.label === 'tree' ? 4 : 2
    for (let i = 0; i < n; i++) {
      const px = cx + (rand() - 0.5) * CELL
      const py = cy + (rand() - 0.5) * CELL
      const pz = cell.h * (0.75 + rand() * 0.25)
      const [r, g, b] = colorFor(cell.label, rand, rand())
      const conf = Math.max(0.35, Math.min(0.97, cell.score * (0.9 + rand() * 0.1)))
      points.push({ x: px, y: py, z: pz, r, g, b, confidence: conf })
    }
  }

  // 2. Open ground between objects: uniform sparse carpet inside the observed corridor.
  const halfExtent = corridorHalfExtent(tracked, flight)
  const GROUND_STEP = 4
  for (let x = -halfExtent; x <= halfExtent; x += GROUND_STEP) {
    for (let y = -halfExtent; y <= halfExtent; y += GROUND_STEP) {
      if (cells.has(`${Math.round(x / CELL)},${Math.round(y / CELL)}`)) continue
      const jitterX = x + (rand() - 0.5) * GROUND_STEP * 0.6
      const jitterY = y + (rand() - 0.5) * GROUND_STEP * 0.6
      const [r, g, b] = colorFor('object', rand, rand())
      points.push({
        x: jitterX, y: jitterY, z: (rand() - 0.5) * 0.3,
        r, g, b,
        confidence: 0.45 + rand() * 0.25,
      })
    }
  }

  // 3. No drone-track markers here. The flight path is a separate layer built
  //    from `trajectory` poses (see scene.ts) because a marker is not scene
  //    geometry: including it inflated totalPoints, pulled mean confidence up
  //    toward 0.95 and put drone coordinates into PLY/OBJ/CSV exports.
  return points
}

/**
 * Share of the defined reconstruction area covered by observed object
 * footprints, 0..1. Counts distinct height-field cells (1.5 m) so overlapping
 * footprints are not double-counted — two detections of the same building do not
 * claim twice the area.
 *
 * `extent` is the side length (metres) of the square modelled area. An area
 * share is a defensible statement; the value this replaced divided the object
 * *count* by a constant and printed it as a percentage without multiplying by
 * 100, so twelve objects displayed as "0.6%".
 */
export const HEIGHT_CELL_M = 1.5

export function footprintCoverage(
  cells: ReadonlyMap<string, unknown>,
  extent: number
): number {
  if (!Number.isFinite(extent) || extent <= 0) return 0
  return Math.min(1, (cells.size * HEIGHT_CELL_M * HEIGHT_CELL_M) / (extent * extent))
}

/** Half-extent of the reconstructed area: covers all detections plus the flight corridor. */
function corridorHalfExtent(tracked: TrackedObject[], flight: FlightParams): number {
  let maxR = 40
  for (const t of tracked) {
    maxR = Math.max(maxR, Math.hypot(t.center.x, t.center.y) + 10)
  }
  maxR = Math.max(maxR, flight.speed * 60 * 0.5) // cover at least the first minute of flight
  return Math.min(160, maxR)
}

// ---------- Trajectory export ----------

function buildTrajectory(flight: FlightParams, count = 40): ReconstructionPose[] {
  const out: ReconstructionPose[] = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    const pose = poseAt(flight, t, i)
    const ll = poseToLngLat(flight, pose)
    out.push({
      lat: ll.lat, lng: ll.lng, altitude: pose.z,
      pitch: (pose.pitch * 180) / Math.PI,
      yaw: (pose.yaw * 180) / Math.PI,
      timeOffset: pose.timeOffset, frameIndex: pose.frameIndex,
    })
  }
  return out
}

// ---------- Confidence annotations ----------

/**
 * Flag the objects the pipeline is least sure about. The *selection* is real —
 * it is the lowest-scoring fused objects — but the *reason* is not diagnosed:
 * nothing here measures occlusion, parallax, blur, lighting, object motion or
 * telemetry quality. So every annotation says `'unknown'` and states the one
 * thing that is actually known about it (how many keyframes saw it). An earlier
 * version cycled through six plausible-sounding causes by array position, which
 * read as a diagnosis while measuring nothing.
 */
function buildAnnotations(
  tracked: TrackedObject[],
  flight: FlightParams,
  keyframeCount: number
): ConfidenceAnnotation[] {
  const out: ConfidenceAnnotation[] = []

  // Single-pass geometry ⇒ objects seen from fewer keyframes rank lowest.
  const sorted = [...tracked].sort((a, b) => a.score - b.score)
  for (let i = 0; i < Math.min(6, sorted.length); i++) {
    const t = sorted[i]
    const views = t.observations === 1 ? 'a single keyframe' : `${t.observations} keyframes`
    const frames: [number, number] = [
      Math.round(t.best.keyframeIndex * (flight.durationSec * 30) / keyframeCount),
      Math.round((t.best.keyframeIndex + 1) * (flight.durationSec * 30) / keyframeCount),
    ]
    out.push({
      x: t.center.x, y: t.center.y, z: 0,
      score: t.score,
      cause: 'unknown',
      explanation: `Lowest-scoring object at this location; seen from ${views}. The cause is not diagnosed — this pipeline does not measure occlusion, parallax, blur or telemetry quality.`,
      affectedFrames: frames,
    })
  }

  return out
}

// ---------- Entry point ----------

export interface ReconstructInput {
  flight: ValidatedFlightData
  videoDurationSec: number
  /** LocateAnything-3B responses, one per keyframe (from the adapter) */
  grounding: GroundingResponse[]
  keyframePlan: KeyframePlan
  /**
   * Called after each internal stage finishes. Lets the UI advance only when
   * work actually completed, instead of running a fixed animation.
   */
  onStage?: (stage: ReconstructStage) => void
}

export interface ReconstructOutput extends ReconstructionResult {
  trackedObjects: TrackedObject[]
  projectedDetections: ProjectedDetection[]
}

/**
 * Full reconstruction from validated flight data + LocateAnything detections.
 * Deterministic: same input ⇒ identical output.
 */
export function reconstruct(input: ReconstructInput): ReconstructOutput {
  const { flight, videoDurationSec, grounding, keyframePlan, onStage } = input
  const cam: CameraModel = {
    focal35: flight.cameraFocalLength,
    frameWidth: flight.cameraWidth,
    frameHeight: flight.cameraHeight,
  }
  const flightParams: FlightParams = {
    gpsLat: flight.gpsLat, gpsLng: flight.gpsLng, altitude: flight.altitude,
    speed: flight.speed, heading: flight.heading,
    durationSec: videoDurationSec, rtkCorrections: flight.rtkCorrections,
  }
  const seed = hashString(
    `${flight.gpsLat.toFixed(6)},${flight.gpsLng.toFixed(6)},${flight.altitude},${flight.heading},${flight.speed},${videoDurationSec.toFixed(1)}`
  )

  // 1. Project every detection box to the ground plane through its keyframe's camera.
  const projected: ProjectedDetection[] = []
  grounding.forEach((resp, kfIdx) => {
    const pose = poseAt(flightParams, keyframePlan.times[kfIdx] ?? kfIdx / Math.max(1, keyframePlan.count - 1), kfIdx)
    for (const box of resp.boxes) {
      const p = projectBoxToGround(box, pose, cam)
      if (p) projected.push(p)
    }
  })
  onStage?.('projection')

  // 2. Deduplicate across keyframes (multi-view corroboration).
  const tracked = deduplicateDetections(projected)
  onStage?.('tracking')

  // 3. Height field + point cloud + trajectory. The cloud holds scene geometry
  //    only; the flight path is the separate `trajectory` array below.
  const extent = corridorHalfExtent(tracked, flightParams) * 2
  const cells = buildHeightField(tracked, extent, seed)
  onStage?.('heightfield')
  const points = synthesizePointCloud(cells, tracked, flightParams, seed)
  onStage?.('pointcloud')
  const trajectory = buildTrajectory(flightParams)

  // 4. Annotations + metrics.
  const annotations = buildAnnotations(tracked, flightParams, keyframePlan.count)
  onStage?.('confidence')
  const avgConf = points.length > 0 ? points.reduce((s, p) => s + p.confidence, 0) / points.length : 0
  const labels = Array.from(new Set(tracked.map((t) => t.label)))
  const coverage = footprintCoverage(cells, extent)
  const source: GroundingSource = grounding.some((r) => r.source === 'locateanything-3b')
    ? 'locateanything-3b'
    : 'simulated'
  const metrics: ReconstructionMetrics = {
    totalPoints: points.length.toLocaleString(),
    accuracy: 'n/a (single pass)',
    processingTime: source === 'locateanything-3b' ? 'server worker + client' : 'client-side only',
    coverage: `${(coverage * 100).toFixed(1)}%`,
    confidenceScore: avgConf.toFixed(2),
    groundedObjects: String(tracked.length),
    groundedLabels: labels.length > 0 ? labels.join(', ') : 'none detected',
    keyframesSampled: String(keyframePlan.count),
    groundingSource: source === 'locateanything-3b'
      ? 'LocateAnything-3B worker'
      : 'simulated adapter (no model was run)',
    synthesis: SYNTHESIS_NOTE,
    provenance: source === 'locateanything-3b'
      ? 'Detections from LocateAnything-3B; geometry synthesised from them + flight metadata'
      : 'Simulated detections seeded from your flight metadata + this clip (illustrative scene, no model was run)',
  }

  // 5. Georeferenced bounds from the scene geometry itself, not the trajectory.
  //    Bounds derived from camera positions are really the flight's bounds: a
  //    north–south pass has zero longitude width even when the reconstructed
  //    scene spans a wide block of ground. The cloud is all scene geometry now
  //    (no track markers), so its extents are the model's extents.
  const origin = { lat: flight.gpsLat, lng: flight.gpsLng }
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const bounds = points.length > 0
    ? (() => {
        const nw = localToLngLat(origin, Math.min(...xs), Math.max(...ys))
        const se = localToLngLat(origin, Math.max(...xs), Math.min(...ys))
        return {
          minLat: se.lat, maxLat: nw.lat,
          minLng: nw.lng, maxLng: se.lng,
        }
      })()
    : (() => {
        const p = poseToLngLat(flightParams, poseAt(flightParams, 0, 0))
        return { minLat: p.lat, maxLat: p.lat, minLng: p.lng, maxLng: p.lng }
      })()
  onStage?.('georef')

  return {
    points, trajectory, annotations, metrics, bounds, groundingSource: source,
    trackedObjects: tracked, projectedDetections: projected,
  }
}
