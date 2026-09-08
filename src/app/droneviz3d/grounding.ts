/**
 * grounding.ts — semantic visual grounding with NVIDIA LocateAnything-3B.
 *
 * LocateAnything-3B (nvidia/LocateAnything-3B on Hugging Face; code in NVlabs/Eagle
 * under Embodied/) is a fast vision-language grounding model built on Parallel Box
 * Decoding (PBD): each bounding box / point is decoded as an atomic unit in a single
 * forward pass instead of token-by-token. Architecture: Moon-ViT vision encoder +
 * Qwen2.5 language decoder bridged by an MLP projector. Apache-2.0 code, NVIDIA
 * model license.
 *
 * Output format (coordinates are integers in [0, 1000] relative to the image):
 *   box:   <ref>label</ref><box><x1><y1><x2><y2></box>
 *   point: <box><x><y></box>
 *   none:  <box>none</box>
 *
 * This module defines the full adapter surface (types, parser, keyframe plan,
 * detection → ground projection, confidence scoring) and a simulated adapter that
 * implements the same interface. The simulated adapter exists because the model
 * requires a GPU runtime (H100 / RTX 4090 class, `la_flash` attention runtime)
 * that a browser-only deployment cannot host; see `grounding-worker.py` for the
 * real backend that plugs into `createLocateAnythingAdapter` via `groundingUrl`.
 */

import {
  CameraModel, CameraPoseLocal, FlightParams, Vec3,
  hashString, mulberry32, rayThroughImagePoint, intersectGround,
  groundDistance, poseAt, cameraFov,
} from './geometry'

// ---------- LocateAnything output types ----------

/** A parsed LocateAnything detection. Coordinates are image-relative [0, 1]. */
export interface GroundingBox {
  /** Object class / free-text label from the query */
  label: string
  /** normalized [0,1], top-left origin */
  x1: number; y1: number; x2: number; y2: number
  /** keyframe this detection came from */
  keyframeIndex: number
  /** 0..1 — heuristic score derived from box regularity + label match */
  score: number
}

/** A parsed LocateAnything point output (e.g. from `worker.point(...)`). */
export interface GroundingPoint {
  label: string
  /** normalized [0,1], top-left origin */
  x: number; y: number
  keyframeIndex: number
  score: number
}

// ---------- Output parser (matches the reference `parse_boxes`) ----------

const BOX_RE = /<ref>([^<]*)<\/ref><box><(\d+)><(\d+)><(\d+)><(\d+)><\/box>/g
const POINT_RE = /<box><(\d+)><(\d+)><\/box>/g
const NONE_RE = /<box>none<\/box>/

/**
 * Parse a raw LocateAnything answer string into detections.
 * Mirrors the reference parser in the LocateAnything README (divide by 1000),
 * extended to carry the `<ref>` label and keyframe index.
 */
export function parseLocateAnythingOutput(
  answer: string,
  keyframeIndex: number,
  labels: readonly string[]
): { boxes: GroundingBox[]; points: GroundingPoint[] } {
  const boxes: GroundingBox[] = []
  const points: GroundingPoint[] = []

  let m: RegExpExecArray | null
  BOX_RE.lastIndex = 0
  while ((m = BOX_RE.exec(answer)) !== null) {
    const label = m[1] || labels[0] || 'object'
    const [x1, y1, x2, y2] = [m[2], m[3], m[4], m[5]].map(Number)
    if ([x1, y1, x2, y2].some((v) => Number.isNaN(v))) continue
    // Normalize + clamp; the model emits values in [0, 1000].
    const nx1 = clamp01(Math.min(x1, x2) / 1000)
    const ny1 = clamp01(Math.min(y1, y2) / 1000)
    const nx2 = clamp01(Math.max(x1, x2) / 1000)
    const ny2 = clamp01(Math.max(y1, y2) / 1000)
    if (nx2 - nx1 < 0.002 || ny2 - ny1 < 0.002) continue // degenerate box
    boxes.push({
      label, x1: nx1, y1: ny1, x2: nx2, y2: ny2, keyframeIndex,
      score: boxScore(nx2 - nx1, ny2 - ny1, label, labels),
    })
  }

  POINT_RE.lastIndex = 0
  while ((m = POINT_RE.exec(answer)) !== null) {
    const x = Number(m[1]) / 1000
    const y = Number(m[2]) / 1000
    if (Number.isNaN(x) || Number.isNaN(y)) continue
    points.push({ label: labels[0] || 'object', x: clamp01(x), y: clamp01(y), keyframeIndex, score: 0.75 })
  }

  return { boxes, points }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/**
 * Heuristic detection score. Real deployments should replace this with the
 * model's native token logprobs (available from the worker answer payload).
 * Penalizes extreme aspect ratios and labels that were not requested.
 */
function boxScore(w: number, h: number, label: string, labels: readonly string[]): number {
  const aspect = w / Math.max(h, 1e-6)
  const aspectPenalty = aspect > 8 || aspect < 1 / 8 ? 0.15 : 0
  const labelPenalty = labels.length > 0 && !labels.includes(label) ? 0.1 : 0
  return Math.max(0.3, Math.min(0.98, 0.9 - aspectPenalty - labelPenalty))
}

// ---------- Keyframe plan ----------

export interface KeyframePlan {
  /** number of keyframes sent to LocateAnything */
  count: number
  /** normalized progress t of each keyframe along the flight path */
  times: number[]
  /** frame indices in the source video */
  frameIndices: number[]
}

export const TARGET_KEYFRAMES = 24

/**
 * Uniform keyframe sampling along the single flight pass. 24 frames give dense
 * coverage for a straight pass while keeping inference cost bounded
 * (24 frames × ~25.6k input tokens each, well under the batch runtime's limits).
 */
export function planKeyframes(durationSec: number, fps = 30): KeyframePlan {
  const count = Math.max(2, TARGET_KEYFRAMES)
  const times = Array.from({ length: count }, (_, i) => (count === 1 ? 0 : i / (count - 1)))
  return {
    count,
    times,
    frameIndices: times.map((t) => Math.round(t * durationSec * fps)),
  }
}

// ---------- Detection → ground projection ----------

/** World-space footprint of one detection, projected onto the ground plane. */
export interface ProjectedDetection {
  label: string
  /** center in local ENU meters */
  center: Vec3
  /** ground footprint half-extents in meters (from box size × GSD) */
  halfExtentX: number
  halfExtentY: number
  score: number
  keyframeIndex: number
  /** meters above ground where the observation was made */
  viewingAltitude: number
}

/**
 * Ground sampling distance at the box center: meters per image pixel,
 * derived from the pinhole model with the documented full-frame assumption.
 */
export function groundSampleDistance(
  pose: CameraPoseLocal,
  cam: CameraModel,
  boxCenterV: number
): number {
  const { vfov } = cameraFov(cam)
  // Slant range to the ground point under the box center (pinhole approximation).
  const halfH = Math.tan(vfov / 2)
  const offset = (boxCenterV * 2 - 1) * halfH
  const pitch = pose.pitch
  // Depression angle of the ray through the box center.
  const rayPitch = pitch - Math.atan(offset) // negative downward
  if (rayPitch >= -1e-4) return Number.POSITIVE_INFINITY // ray never hits ground
  const slantRange = pose.z / -Math.sin(rayPitch)
  const pixelsPerVfov = cam.frameHeight
  // Vertical ground extent covered by the full frame at that slant range.
  const frameGroundHeight = slantRange * (2 * halfH)
  return frameGroundHeight / pixelsPerVfov
}

/**
 * Project one LocateAnything box onto the ground plane via the camera model.
 * Returns null when the box center ray points above the horizon.
 */
export function projectBoxToGround(
  box: GroundingBox,
  pose: CameraPoseLocal,
  cam: CameraModel
): ProjectedDetection | null {
  const u = (box.x1 + box.x2) / 2
  const v = (box.y1 + box.y2) / 2
  const origin: Vec3 = { x: pose.x, y: pose.y, z: pose.z }
  const dir = rayThroughImagePoint(pose, cam, u, v)
  const hit = intersectGround(origin, dir)
  if (!hit) return null

  // Footprint: project the box edges through the same ray bundle.
  const gsd = groundSampleDistance(pose, cam, v)
  if (!Number.isFinite(gsd)) return null
  const wPx = (box.x2 - box.x1) * cam.frameWidth
  const hPx = (box.y2 - box.y1) * cam.frameHeight

  return {
    label: box.label,
    center: hit,
    halfExtentX: (wPx * gsd) / 2,
    halfExtentY: (hPx * gsd) / 2,
    score: box.score,
    keyframeIndex: box.keyframeIndex,
    viewingAltitude: pose.z,
  }
}

// ---------- Deduplication across keyframes ----------

export interface TrackedObject {
  label: string
  center: Vec3
  halfExtentX: number
  halfExtentY: number
  /** fused score: mean of contributing detections weighted by their scores */
  score: number
  observations: number
  /** best (highest-scoring) contributing detection */
  best: ProjectedDetection
}

const DEDUP_RADIUS_M = 2.5

/**
 * Merge per-keyframe detections into tracked objects: two detections are the
 * same object when their ground centers are within `DEDUP_RADIUS_M` and their
 * labels match. Score fusion is a weighted mean; observing the same object from
 * several keyframes raises confidence (multi-view corroboration).
 */
export function deduplicateDetections(dets: ProjectedDetection[]): TrackedObject[] {
  const tracked: TrackedObject[] = []
  for (const d of dets) {
    const match = tracked.find(
      (t) => t.label === d.label && groundDistance(t.center, d.center) <= DEDUP_RADIUS_M
    )
    if (match) {
      const wSum = match.score * match.observations + d.score
      match.center = {
        x: (match.center.x * match.observations + d.center.x) / (match.observations + 1),
        y: (match.center.y * match.observations + d.center.y) / (match.observations + 1),
        z: 0,
      }
      match.halfExtentX = Math.max(match.halfExtentX, d.halfExtentX)
      match.halfExtentY = Math.max(match.halfExtentY, d.halfExtentY)
      match.observations += 1
      match.score = wSum / match.observations
      if (d.score > match.best.score) match.best = d
    } else {
      tracked.push({
        label: d.label, center: d.center,
        halfExtentX: d.halfExtentX, halfExtentY: d.halfExtentY,
        score: d.score, observations: 1, best: d,
      })
    }
  }
  // Multi-view corroboration bonus: each extra observation adds confidence.
  for (const t of tracked) {
    t.score = Math.min(0.98, t.score + Math.min(0.08, (t.observations - 1) * 0.02))
  }
  return tracked
}

// ---------- Adapter surface ----------

export interface GroundingRequest {
  /** PNG/JPEG blob of the keyframe */
  image: Blob
  keyframeIndex: number
  labels: readonly string[]
}

export interface GroundingResponse {
  boxes: GroundingBox[]
  points: GroundingPoint[]
  /** raw model output, kept for debugging */
  raw?: string
  /** inference backend used */
  source: 'locateanything-3b' | 'simulated'
}

/**
 * Adapter that runs LocateAnything-3B. Real deployments point `groundingUrl`
 * at the Python worker (see grounding-worker.py) which hosts the model.
 */
export type LocateAnythingAdapter = (
  requests: readonly GroundingRequest[]
) => Promise<GroundingResponse[]>

// ---------- Simulated adapter (same interface, deterministic) ----------

/**
 * Deterministic scene generator that mimics what LocateAnything-3B would detect
 * on a drone keyframe: building footprints and vehicles arranged in blocks.
 * Produces synthetic raw output strings in the exact PBD token format, then runs
 * them through the real parser — so swapping in the real model changes nothing
 * downstream.
 */
export function createSimulatedLocateAnythingAdapter(flight: FlightParams): LocateAnythingAdapter {
  const seed = hashString(`${flight.gpsLat.toFixed(6)},${flight.gpsLng.toFixed(6)},${flight.altitude},${flight.heading}`)
  const rand = mulberry32(seed)

  // Deterministic scene: grid of building blocks + scattered vehicles.
  const buildings: { cx: number; cy: number; w: number; d: number; h: number }[] = []
  const GRID = 4
  const SPACING = 18
  for (let gx = -GRID; gx <= GRID; gx++) {
    for (let gy = -GRID; gy <= GRID; gy++) {
      if (rand() < 0.45) continue
      buildings.push({
        cx: gx * SPACING + (rand() - 0.5) * 6,
        cy: gy * SPACING + (rand() - 0.5) * 6,
        w: 8 + rand() * 10,
        d: 8 + rand() * 10,
        h: 4 + rand() * 14,
      })
    }
  }
  const vehicles: { cx: number; cy: number }[] = []
  for (let i = 0; i < 26; i++) {
    vehicles.push({ cx: (rand() - 0.5) * 160, cy: (rand() - 0.5) * 160 })
  }

  const LABELS = ['building', 'vehicle', 'tree'] as const

  return async (requests) =>
    requests.map((req) => {
      const pose = poseAt(flight, req.keyframeIndex / Math.max(1, TARGET_KEYFRAMES - 1), req.keyframeIndex)
      const cam: CameraModel = {
        focal35: 24, frameWidth: 3840, frameHeight: 2160,
      }
      let raw = ''
      const emitBox = (label: string, x1: number, y1: number, x2: number, y2: number) => {
        const f = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 1000)
        raw += `<ref>${label}</ref><box><${f(x1)}><${f(y1)}><${f(x2)}><${f(y2)}></box>`
      }

      // Project each scene object into this keyframe's frustum and emit a box
      // for the ones that would be visible — this is what the real model sees.
      for (const b of [...buildings.map((s) => ({ ...s, label: 'building' as const })),
                        ...vehicles.map((v) => ({ ...v, w: 4.5, d: 2, h: 1.5, label: 'vehicle' as const }))]) {
        // Project the footprint center-top and center-ground to get image extent.
        const pts = [
          projectToImage(pose, cam, { x: b.cx, y: b.cy, z: 0 }),
          projectToImage(pose, cam, { x: b.cx, y: b.cy, z: b.h }),
        ]
        if (!pts[0] || !pts[1]) continue
        const u0 = Math.min(pts[0].u, pts[1].u)
        const u1 = Math.max(pts[0].u, pts[1].u)
        const v0 = Math.min(pts[0].v, pts[1].v)
        const v1 = Math.max(pts[0].v, pts[1].v)
        // Widen slightly so the box covers the full footprint, not just its center line.
        const growU = 0.012
        const growV = 0.01
        const bx1 = Math.max(0, u0 - growU)
        const bx2 = Math.min(1, u1 + growU)
        const by1 = Math.max(0, v0 - growV)
        const by2 = Math.min(1, v1 + growV)
        if (bx2 - bx1 < 0.004 || by2 - by1 < 0.004) continue
        if (bx1 >= 1 || bx2 <= 0 || by1 >= 1 || by2 <= 0) continue
        emitBox(b.label, bx1, by1, bx2, by2)
      }
      if (rand() < 0.08) raw += '<box>none</box>'
      void LABELS

      const parsed = parseLocateAnythingOutput(raw, req.keyframeIndex, req.labels)
      return { ...parsed, raw, source: 'simulated' as const }
    })
}

// ---------- Real adapter (POSTs keyframes to the LocateAnything worker) ----------

/**
 * Adapter that sends real keyframes to the LocateAnything-3B worker via the
 * Next.js proxy route. The proxy (src/app/api/ground) holds WORKER_TOKEN and
 * WORKER_URL server-side, so the token never reaches the browser bundle.
 * Falls back to the simulated adapter in the store when the worker is unreachable.
 */
export function createLocateAnythingAdapter(proxyUrl = '/api/ground'): LocateAnythingAdapter {
  return async (requests) => {
    const form = new FormData()
    for (const req of requests) {
      // The worker stores frames as image/* parts; name them so the proxy can
      // cap per-frame size.
      form.append('frames', req.image, `keyframe-${req.keyframeIndex}.jpg`)
    }
    const labels = requests[0]?.labels ?? ['building', 'vehicle', 'tree']
    form.append('labels', labels.join(','))

    let res: Response
    try {
      res = await fetch(proxyUrl, { method: 'POST', body: form })
    } catch {
      throw new Error('Grounding proxy unreachable — is the dev/prod server running?')
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try {
        const body = await res.json()
        if (body?.error) detail = body.error
      } catch { /* non-JSON error body */ }
      throw new Error(`Grounding failed (${detail})`)
    }

    const data: { results?: { boxes?: { label?: string; x1?: number; y1?: number; x2?: number; y2?: number; score?: number }[]; raw?: string }[] } = await res.json()
    if (!Array.isArray(data.results) || data.results.length !== requests.length) {
      throw new Error('Grounding proxy returned an unexpected response shape')
    }

    return data.results.map((r, i) => {
      const keyframeIndex = requests[i].keyframeIndex
      const boxes: GroundingBox[] = (r.boxes ?? [])
        .filter((b) => typeof b?.x1 === 'number' && typeof b?.x2 === 'number' && typeof b?.y1 === 'number' && typeof b?.y2 === 'number')
        .map((b) => ({
          label: String(b.label ?? labels[0] ?? 'object').slice(0, 64),
          x1: clamp01(b.x1!), y1: clamp01(b.y1!), x2: clamp01(b.x2!), y2: clamp01(b.y2!),
          keyframeIndex,
          score: typeof b.score === 'number' ? Math.max(0, Math.min(1, b.score)) : 0.9,
        }))
        .filter((b) => b.x2 - b.x1 >= 0.002 && b.y2 - b.y1 >= 0.002)
      return { boxes, points: [], raw: r.raw, source: 'locateanything-3b' as const }
    })
  }
}

// ---------- Browser-side keyframe extraction from the uploaded video ----------

/**
 * Decode the uploaded video in the browser and export a JPEG per requested
 * timestamp. Frames are downscaled to `maxDim` so a 4K source does not blow up
 * inference cost. This keeps the raw video on-device: only the sampled
 * keyframes are sent to the grounding worker (in worker mode).
 */
export async function extractKeyframes(
  videoFile: File,
  timesSec: readonly number[],
  maxDim = 1280
): Promise<Blob[]> {
  const url = URL.createObjectURL(videoFile)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')

  const blobs: Blob[] = []
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('Video could not be decoded'))
      // Some browsers fire neither if the source is cached; guard with a timeout.
      setTimeout(() => resolve(), 10_000)
    })

    // MediaRecorder-produced webm files often report duration = Infinity until
    // the first frame is decoded; wait briefly for a real duration.
    if (!Number.isFinite(video.duration)) {
      await new Promise<void>((resolve) => {
        const done = () => resolve()
        video.ondurationchange = done
        setTimeout(done, 5_000)
      })
    }
    const knownDuration = Number.isFinite(video.duration) ? video.duration : Infinity

    for (const t of timesSec) {
      // Guard against non-finite targets (an unknown duration can leak
      // Infinity into the plan) and seek only within the actual clip.
      const target = Number.isFinite(t) ? Math.max(0, t) : 0
      if (target > knownDuration) continue
      video.currentTime = target
      await new Promise<void>((resolve) => {
        const done = () => resolve()
        video.onseeked = done
        video.onerror = done
        setTimeout(done, 5_000)
      })
      const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight, 1))
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
      if (blob) blobs.push(blob)
    }
  } finally {
    URL.revokeObjectURL(url)
    video.removeAttribute('src')
    video.load()
  }

  if (blobs.length === 0) throw new Error('No keyframes could be extracted from the video')
  return blobs
}

/** Project a world point into normalized image coordinates, or null if behind camera. */
function projectToImage(
  pose: CameraPoseLocal,
  cam: CameraModel,
  world: Vec3
): { u: number; v: number } | null {
  const dx = world.x - pose.x
  const dy = world.y - pose.y
  const dz = world.z - pose.z
  const cp = Math.cos(pose.pitch)
  const forward: Vec3 = { x: Math.sin(pose.yaw) * cp, y: Math.cos(pose.yaw) * cp, z: Math.sin(pose.pitch) }
  const worldUp: Vec3 = { x: 0, y: 0, z: 1 }
  let rx = forward.y * worldUp.z - forward.z * worldUp.y
  let ry = forward.z * worldUp.x - forward.x * worldUp.z
  let rz = forward.x * worldUp.y - forward.y * worldUp.x
  const rLen = Math.hypot(rx, ry, rz) || 1
  rx /= rLen; ry /= rLen; rz /= rLen
  const ux = ry * forward.z - rz * forward.y
  const uy = rz * forward.x - rx * forward.z
  const uz = rx * forward.y - ry * forward.x

  const zf = dx * forward.x + dy * forward.y + dz * forward.z
  if (zf < 0.5) return null
  const xr = dx * rx + dy * ry + dz * rz
  const yu = dx * ux + dy * uy + dz * uz
  const { hfov, vfov } = cameraFov(cam)
  const u = 0.5 + (xr / zf) / (2 * Math.tan(hfov / 2))
  const v = 0.5 - (yu / zf) / (2 * Math.tan(vfov / 2))
  if (u < -0.1 || u > 1.1 || v < -0.1 || v > 1.1) return null
  return { u, v }
}
