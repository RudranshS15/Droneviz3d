/**
 * viewer-frame.ts — what the viewer draws, decided without a canvas.
 *
 * The viewer used to be a hand-written 2D canvas renderer (viewer-render.ts): it
 * projected every point on the CPU, sorted them back-to-front and filled squares.
 * The scene is now drawn by three.js through React Three Fiber, which does the
 * projection and the culling on the GPU — but the decisions that users actually
 * notice are still pure: which geometry exists, what colour each vertex gets,
 * which markers a click can hit, whether the flight path is on screen, and which
 * labels are legible this frame.
 *
 * So this module keeps exactly those decisions, with no framework import, and the
 * React components in viewer-scene.tsx are thin translators of its output. That
 * split is what makes the new drawing path testable in Node, the same way the 2D
 * renderer was through its recording canvas stub.
 *
 * All screen positions come from viewer-camera, which works in the model's native
 * ENU frame (x = East, y = North, z = Up), so the ground plane stays horizontal
 * and the orientation gizmo is built from the same camera basis as everything
 * else and cannot disagree with what is rendered.
 */

import { bandFor } from './confidence'
import { TrackedObject } from './grounding'
import { Point3D } from './reconstruct'
import {
  Bounds3, GizmoAxis, OrbitCamera, ProjectedPoint, ProjectedMarker, Vec3, ViewBasis, Viewport,
  gizmoAxes, projectPoint, viewBasis,
} from './viewer-camera'
import { LabelPlacement, declutterLabels } from './viewer-labels'

export interface RenderPalette {
  background: string
  text: string
  muted: string
  accent: string
  grid: string
  selection: string
}

/** Matches the site's design tokens (tokens.ts) so the scene sits in the page. */
export const VIEWER_PALETTE: RenderPalette = {
  background: '#09090b',
  text: '#e7e5e4',
  muted: '#a8a29e',
  accent: '#d4a053',
  grid: 'rgba(168, 162, 158, 0.18)',
  selection: '#22d3ee',
}

export type ColorMode = 'rgb' | 'confidence'

/** Ground-grid lines per axis, matching the 2D renderer's grid. */
export const GRID_DIVISIONS = 8
/** The orientation gizmo's on-screen length, in pixels. */
export const GIZMO_RADIUS = 26
/** How far past the marker the take-off label sits, matching the old label. */
const TAKEOFF_DX = 8
const TAKEOFF_DY = -8

/**
 * Everything the annotation frame needs. The cloud itself is not here: its
 * geometry is built once per colour mode by buildCloudGeometry and never changes
 * with the camera.
 */
export interface SceneInput {
  camera: OrbitCamera
  viewport: Viewport
  bounds: Bounds3
  /** flight path in local ENU metres */
  trajectoryPath: readonly Vec3[]
  objects: readonly TrackedObject[]
  showDetections: boolean
  showTrajectory: boolean
  selectedIndex: number | null
}

/** One object that is visible in this frame, with its screen annotation. */
export interface DetectionAnnotation {
  /** index of the object in the scene, so a click maps back to the model */
  index: number
  x: number
  y: number
  text: string
  selected: boolean
  /** false when the label was dropped because it would overlap another */
  labelled: boolean
}

export interface TrajectoryFrame {
  /**
   * True when at least one point of the flight path landed inside the viewport.
   * A track that cruises at 120 m over a 15 m-tall model is easily framed
   * entirely off-screen, and a toggle that appears to do nothing is worse than
   * no toggle — the viewer uses this to say so and offer a fit action.
   */
  visible: boolean
  /** Consecutive pose pairs that project in front of the near plane. */
  drawnSegments: number
  /** Screen position of the take-off end, offset for its label. Null when culled. */
  takeoff: { x: number; y: number } | null
}

export interface ViewerFrame {
  /** Projected object centres — exactly the set a click is matched against. */
  markers: ProjectedMarker[]
  /** One entry per detected object visible in this frame, in scene order. */
  annotations: DetectionAnnotation[]
  /**
   * How many labels are actually legible this frame. A dense detection set is
   * deduped to screen space, so this is usually fewer than the object count — the
   * viewer says so rather than letting the user think labels are missing.
   */
  labelsDrawn: number
  trajectory: TrajectoryFrame
  /** Axis directions for the corner gizmo, from the same camera basis. */
  gizmo: GizmoAxis[]
}

/** `building 90%` — the class and the fused cross-keyframe score. */
export function labelText(object: TrackedObject): string {
  return `${object.label} ${(object.score * 100).toFixed(0)}%`
}

/**
 * Project the object centres to screen space so a click can select one. The
 * marker's `index` is the object's index in the array it came from; objects
 * behind the near plane produce no marker, so they can never be picked.
 */
export function projectObjects(
  objects: readonly TrackedObject[],
  camera: OrbitCamera,
  basis: ViewBasis,
  viewport: Viewport,
  minDepth = 0
): ProjectedMarker[] {
  const markers: ProjectedMarker[] = []
  objects.forEach((o, index) => {
    const p = projectPoint(camera, basis, o.center, viewport)
    if (p && p.depth > minDepth) markers.push({ index, x: p.x, y: p.y })
  })
  return markers
}

function projectTrajectory(scene: SceneInput, basis: ViewBasis): TrajectoryFrame {
  const { camera, viewport, trajectoryPath } = scene
  if (trajectoryPath.length === 0) return { visible: false, drawnSegments: 0, takeoff: null }

  let visible = false
  let drawnSegments = 0
  let previous: ProjectedPoint | null = null
  for (const pose of trajectoryPath) {
    const s = projectPoint(camera, basis, pose, viewport)
    if (!s) { previous = null; continue }
    if (s.x >= 0 && s.x <= viewport.width && s.y >= 0 && s.y <= viewport.height) visible = true
    if (previous) drawnSegments += 1
    previous = s
  }

  const start = projectPoint(camera, basis, trajectoryPath[0], viewport)
  return {
    visible,
    drawnSegments,
    takeoff: start ? { x: start.x + TAKEOFF_DX, y: start.y + TAKEOFF_DY } : null,
  }
}

/**
 * Decide everything the DOM overlay and the picking path need for one frame.
 * Hidden layers contribute nothing at all, so a hidden marker can never be
 * selected and a hidden label can never be drawn.
 */
export function frameScene(scene: SceneInput): ViewerFrame {
  const basis = viewBasis(scene.camera)
  const frame: ViewerFrame = {
    markers: [], annotations: [], labelsDrawn: 0,
    trajectory: { visible: false, drawnSegments: 0, takeoff: null },
    gizmo: gizmoAxes(basis, GIZMO_RADIUS),
  }

  if (scene.showTrajectory) frame.trajectory = projectTrajectory(scene, basis)
  if (!scene.showDetections) return frame

  const annotations: DetectionAnnotation[] = []
  const placements: LabelPlacement[] = []
  scene.objects.forEach((object, index) => {
    const center = projectPoint(scene.camera, basis, object.center, scene.viewport)
    if (!center) return
    const text = labelText(object)
    annotations.push({
      index, x: center.x, y: center.y, text,
      selected: scene.selectedIndex === index, labelled: false,
    })
    placements.push({
      index, x: center.x, y: center.y, text,
      score: object.score, selected: scene.selectedIndex === index,
    })
  })

  const labelled = new Set(declutterLabels(placements).map((placement) => placement.index))
  for (const annotation of annotations) annotation.labelled = labelled.has(annotation.index)

  frame.annotations = annotations
  frame.labelsDrawn = labelled.size
  frame.markers = annotations.map((a) => ({ index: a.index, x: a.x, y: a.y }))
  return frame
}

// ---------------------------------------------------------------------------
// Geometry for the GPU-drawn layers
// ---------------------------------------------------------------------------

export interface CloudGeometry {
  /** x, y, z per point, in the model's ENU metres */
  positions: Float32Array
  /** r, g, b, a per point, 0..1 — alpha carries the confidence-mode ramp */
  colors: Float32Array
  count: number
}

/**
 * RGBA floats matching confidenceColor()'s band colour and its alpha ramp. The
 * 2D renderer blended that alpha against the background when it filled each
 * square, so the value is reproduced here rather than re-invented.
 */
export function confidenceColorRgba(confidence: number, baseAlpha = 0.55): [number, number, number, number] {
  const band = bandFor(confidence)
  const c = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0
  const alpha = Math.max(0.15, Math.min(0.95, baseAlpha + c * 0.4))
  return [band.rgb[0] / 255, band.rgb[1] / 255, band.rgb[2] / 255, alpha]
}

/**
 * Positions and per-point colours for the cloud. Positions never change with the
 * camera; colours change only when the colour mode does, so the caller can hold
 * one buffer per mode instead of rebuilding it per frame.
 */
export function buildCloudGeometry(points: readonly Point3D[], colorMode: ColorMode): CloudGeometry {
  const count = points.length
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const p = points[i]
    positions[i * 3] = p.x
    positions[i * 3 + 1] = p.y
    positions[i * 3 + 2] = p.z
    if (colorMode === 'confidence') {
      const [r, g, b, a] = confidenceColorRgba(p.confidence)
      colors[i * 4] = r
      colors[i * 4 + 1] = g
      colors[i * 4 + 2] = b
      colors[i * 4 + 3] = a
    } else {
      colors[i * 4] = p.r / 255
      colors[i * 4 + 1] = p.g / 255
      colors[i * 4 + 2] = p.b / 255
      colors[i * 4 + 3] = 1
    }
  }
  return { positions, colors, count }
}

/**
 * Line-segment vertex pairs for the ground grid at z = 0, one line each way per
 * division. Empty for a scene with no bounds, so nothing is drawn for an empty
 * cloud — the same rule the 2D renderer applied.
 */
export function groundGridSegments(bounds: Bounds3, divisions = GRID_DIVISIONS): Float32Array {
  if (!(bounds.radius > 0)) return new Float32Array(0)
  const out: number[] = []
  const { min, max } = bounds
  for (let i = 0; i <= divisions; i++) {
    const t = i / divisions
    const x = min.x + (max.x - min.x) * t
    const y = min.y + (max.y - min.y) * t
    out.push(x, min.y, 0, x, max.y, 0)
    out.push(min.x, y, 0, max.x, y, 0)
  }
  return new Float32Array(out)
}

/**
 * The four ground-plane corners of an object's footprint, in the order the 2D
 * renderer connected them. Heights are synthesized from the detection, so the
 * footprint — not a box up to `viewingAltitude` — is what is drawn.
 */
export function detectionFootprint(object: TrackedObject): [Vec3, Vec3, Vec3, Vec3] {
  const { center, halfExtentX, halfExtentY } = object
  return [
    { x: center.x + halfExtentX, y: center.y + halfExtentY, z: 0 },
    { x: center.x + halfExtentX, y: center.y - halfExtentY, z: 0 },
    { x: center.x - halfExtentX, y: center.y - halfExtentY, z: 0 },
    { x: center.x - halfExtentX, y: center.y + halfExtentY, z: 0 },
  ]
}

export interface SegmentGeometry {
  positions: Float32Array
  colors: Float32Array
}

/**
 * Outline segments for every object's footprint, coloured by selection. Eight
 * vertices per object (four edges), so one draw call covers the whole layer.
 */
export function detectionFootprintSegments(
  objects: readonly TrackedObject[],
  selectedIndex: number | null,
  colors: { plain: string; selected: string } = { plain: VIEWER_PALETTE.accent, selected: VIEWER_PALETTE.selection }
): SegmentGeometry {
  const positions: number[] = []
  const vertexColors: number[] = []
  const plain = hexToRgb(colors.plain)
  const selected = hexToRgb(colors.selected)
  for (let i = 0; i < objects.length; i++) {
    const corners = detectionFootprint(objects[i])
    const color = i === selectedIndex ? selected : plain
    for (let c = 0; c < 4; c++) {
      const a = corners[c]
      const b = corners[(c + 1) % 4]
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
      vertexColors.push(color[0], color[1], color[2], color[0], color[1], color[2])
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(vertexColors) }
}

/** Consecutive pose pairs for the flight path. Empty for a path of one point. */
export function trajectorySegments(path: readonly Vec3[]): Float32Array {
  if (path.length < 2) return new Float32Array(0)
  const out: number[] = []
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    out.push(a.x, a.y, a.z, b.x, b.y, b.z)
  }
  return new Float32Array(out)
}

/** Pose positions, drawn as dots so the flight direction is readable. */
export function trajectoryDots(path: readonly Vec3[]): Float32Array {
  const out = new Float32Array(path.length * 3)
  path.forEach((pose, i) => {
    out[i * 3] = pose.x
    out[i * 3 + 1] = pose.y
    out[i * 3 + 2] = pose.z
  })
  return out
}

/** `#rrggbb` (or `#rgb`) to 0..1 floats. Palette colours only; no alpha support
 *  is needed because these are opaque outlines. */
export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const int = Number.parseInt(full, 16)
  if (!Number.isFinite(int) || full.length !== 6) return [1, 1, 1]
  return [((int >> 16) & 0xff) / 255, ((int >> 8) & 0xff) / 255, (int & 0xff) / 255]
}
