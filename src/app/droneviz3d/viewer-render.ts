/**
 * viewer-render.ts — canvas rendering for the 3D viewer.
 *
 * All screen positions come from viewer-camera, which works in the model's
 * native ENU frame (x = East, y = North, z = Up). The renderer therefore draws
 * the ground plane horizontally, heights rising on screen, and a gizmo built
 * from the same camera basis — it cannot disagree with what it renders.
 *
 * The drawing surface is typed as a small structural interface rather than
 * CanvasRenderingContext2D so the renderer can be exercised in tests with a
 * recording stub instead of a browser.
 */

import { confidenceColor } from './confidence'
import { TrackedObject } from './grounding'
import { Point3D } from './reconstruct'
import {
  Bounds3, GizmoAxis, OrbitCamera, ProjectedMarker, Vec3, ViewBasis, Viewport,
  attenuatedSize, gizmoAxes, projectPoint, viewBasis,
} from './viewer-camera'

/**
 * The exact slice of the 2D canvas API this renderer uses. A real
 * CanvasRenderingContext2D satisfies it directly, and tests can satisfy it with
 * a recording stub instead of a DOM.
 */
export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'font' | 'globalAlpha'
  | 'textAlign' | 'textBaseline'
  | 'fillRect' | 'clearRect' | 'beginPath' | 'closePath' | 'moveTo' | 'lineTo'
  | 'arc' | 'stroke' | 'fill' | 'fillText' | 'save' | 'restore'
>

export interface RenderPalette {
  background: string
  text: string
  muted: string
  accent: string
  grid: string
  selection: string
}

/** Matches the site's design tokens (tokens.ts) so the canvas sits in the page. */
export const VIEWER_PALETTE: RenderPalette = {
  background: '#09090b',
  text: '#e7e5e4',
  muted: '#a8a29e',
  accent: '#d4a053',
  grid: 'rgba(168, 162, 158, 0.18)',
  selection: '#22d3ee',
}

export type ColorMode = 'rgb' | 'confidence'

export interface SceneInput {
  camera: OrbitCamera
  viewport: Viewport
  bounds: Bounds3
  points: readonly Point3D[]
  /** flight path in local ENU metres */
  trajectoryPath: readonly Vec3[]
  objects: readonly TrackedObject[]
  /** base point size in pixels at the camera's reference depth */
  pointSize: number
  colorMode: ColorMode
  showDetections: boolean
  showTrajectory: boolean
  selectedIndex: number | null
  palette?: RenderPalette
}

export interface RenderStats {
  drawnPoints: number
  culledPoints: number
  markers: ProjectedMarker[]
  drawnTrajectorySegments: number
  /**
   * True when at least one point of the flight path landed inside the viewport.
   * A track that cruises at 120 m over a 15 m-tall model is easily framed
   * entirely off-screen, and a toggle that appears to do nothing is worse than
   * no toggle — the viewer uses this to say so and offer a fit action.
   */
  trajectoryVisible: boolean
}

const GRID_DIVISIONS = 8
const MARKER_RADIUS = 6
const GIZMO_RADIUS = 26
const GIZMO_ORIGIN = { x: 34, y: 34 }

/** Project the object centres to screen space so a click can select one. */
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

function drawGroundGrid(
  ctx: Ctx2D, camera: OrbitCamera, basis: ViewBasis, bounds: Bounds3, viewport: Viewport, color: string
): void {
  if (bounds.radius <= 0) return
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  const { min, max } = bounds
  for (let i = 0; i <= GRID_DIVISIONS; i++) {
    const t = i / GRID_DIVISIONS
    const x = min.x + (max.x - min.x) * t
    const y = min.y + (max.y - min.y) * t

    const alongY0 = projectPoint(camera, basis, { x, y: min.y, z: 0 }, viewport)
    const alongY1 = projectPoint(camera, basis, { x, y: max.y, z: 0 }, viewport)
    if (alongY0 && alongY1) {
      ctx.beginPath()
      ctx.moveTo(alongY0.x, alongY0.y)
      ctx.lineTo(alongY1.x, alongY1.y)
      ctx.stroke()
    }

    const alongX0 = projectPoint(camera, basis, { x: min.x, y, z: 0 }, viewport)
    const alongX1 = projectPoint(camera, basis, { x: max.x, y, z: 0 }, viewport)
    if (alongX0 && alongX1) {
      ctx.beginPath()
      ctx.moveTo(alongX0.x, alongX0.y)
      ctx.lineTo(alongX1.x, alongX1.y)
      ctx.stroke()
    }
  }
}

function drawPointCloud(
  ctx: Ctx2D, scene: SceneInput, basis: ViewBasis
): { drawn: number; culled: number } {
  const { camera, viewport, points, pointSize, colorMode } = scene
  const projected: { x: number; y: number; size: number; color: string; depth: number }[] = []
  let culled = 0

  for (const p of points) {
    const s = projectPoint(camera, basis, p, viewport)
    if (!s) { culled += 1; continue }
    // Cheap off-screen rejection before we pay for sorting.
    if (s.x < -32 || s.x > viewport.width + 32 || s.y < -32 || s.y > viewport.height + 32) { culled += 1; continue }
    projected.push({
      x: s.x,
      y: s.y,
      size: attenuatedSize(pointSize, s.depth, camera.distance),
      color: colorMode === 'confidence' ? confidenceColor(p.confidence) : `rgb(${p.r}, ${p.g}, ${p.b})`,
      depth: s.depth,
    })
  }

  // Painter's algorithm: far to near.
  projected.sort((a, b) => b.depth - a.depth)
  for (const p of projected) {
    ctx.fillStyle = p.color
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
  }
  return { drawn: projected.length, culled }
}

function drawTrajectory(
  ctx: Ctx2D, scene: SceneInput, basis: ViewBasis, palette: RenderPalette
): { segments: number; visible: boolean } {
  const { camera, viewport, trajectoryPath } = scene
  if (trajectoryPath.length === 0) return { segments: 0, visible: false }

  ctx.strokeStyle = palette.accent
  ctx.lineWidth = 1.5
  let segments = 0
  let visible = false
  let previous: { x: number; y: number } | null = null
  for (const pose of trajectoryPath) {
    const s = projectPoint(camera, basis, pose, viewport)
    if (!s) { previous = null; continue }
    if (s.x >= 0 && s.x <= viewport.width && s.y >= 0 && s.y <= viewport.height) visible = true
    if (previous) {
      ctx.beginPath()
      ctx.moveTo(previous.x, previous.y)
      ctx.lineTo(s.x, s.y)
      ctx.stroke()
      segments += 1
    }
    previous = { x: s.x, y: s.y }
    ctx.fillStyle = palette.accent
    ctx.beginPath()
    ctx.arc(s.x, s.y, 2, 0, Math.PI * 2)
    ctx.fill()
  }

  // Mark the take-off end of the pass so the direction of flight is unambiguous.
  const start = projectPoint(camera, basis, trajectoryPath[0], viewport)
  if (start) {
    ctx.fillStyle = palette.text
    ctx.font = '10px monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('take-off', start.x + 8, start.y - 8)
  }
  return { segments, visible }
}

interface DetectionDraw { object: TrackedObject; x: number; y: number; corners: { x: number; y: number }[] }

function drawDetections(
  ctx: Ctx2D, scene: SceneInput, basis: ViewBasis, palette: RenderPalette, stats: RenderStats
): void {
  const { camera, viewport, objects, selectedIndex } = scene
  const draws: DetectionDraw[] = []

  objects.forEach((object) => {
    const center = projectPoint(camera, basis, object.center, viewport)
    if (!center) return
    const corners: { x: number; y: number }[] = []
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      const corner = projectPoint(camera, basis, {
        x: object.center.x + sx * object.halfExtentX,
        y: object.center.y + sy * object.halfExtentY,
        z: 0,
      }, viewport)
      if (!corner) return
      corners.push({ x: corner.x, y: corner.y })
    }
    draws.push({ object, x: center.x, y: center.y, corners })
    stats.markers.push({ index: stats.markers.length, x: center.x, y: center.y })
  })

  ctx.font = '11px sans-serif'

  // `draws` and `stats.markers` are built in the same order, so a marker index
  // is exactly the index of the object in `scene.objects`.
  draws.forEach((draw, index) => {
    const isSelected = selectedIndex === index
    ctx.strokeStyle = isSelected ? palette.selection : palette.accent
    ctx.lineWidth = isSelected ? 2.5 : 1.5
    ctx.beginPath()
    draw.corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)))
    ctx.closePath()
    ctx.stroke()

    ctx.fillStyle = isSelected ? palette.selection : palette.accent
    ctx.beginPath()
    ctx.arc(draw.x, draw.y, isSelected ? MARKER_RADIUS + 2 : MARKER_RADIUS, 0, Math.PI * 2)
    ctx.stroke()

    ctx.fillStyle = palette.text
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${draw.object.label} ${(draw.object.score * 100).toFixed(0)}%`, draw.x + 10, draw.y + 2)
  })
}

function drawGizmo(
  ctx: Ctx2D, basis: ViewBasis, palette: RenderPalette, radius = GIZMO_RADIUS, origin = GIZMO_ORIGIN
): GizmoAxis[] {
  const axes = gizmoAxes(basis, radius)
  ctx.save()
  ctx.lineWidth = 2
  ctx.font = '10px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  ctx.fillStyle = 'rgba(9, 9, 11, 0.55)'
  ctx.beginPath()
  ctx.arc(origin.x, origin.y, radius * 0.42, 0, Math.PI * 2)
  ctx.fill()

  for (const axis of axes) {
    const x = origin.x + axis.dx
    const y = origin.y + axis.dy
    // Fade axes pointing away from the camera, like a real orientation gizmo.
    const near = axis.depth <= 0
    ctx.globalAlpha = near ? 1 : 0.45
    // The vertical axis is the one users check first; it gets the accent colour.
    const axisColor = axis.key === 'U' ? palette.accent : palette.text
    ctx.strokeStyle = axisColor
    ctx.beginPath()
    ctx.moveTo(origin.x, origin.y)
    ctx.lineTo(x, y)
    ctx.stroke()
    ctx.fillStyle = axisColor
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = palette.background
    ctx.fillText(axis.key, x, y + 0.5)
  }
  ctx.globalAlpha = 1
  ctx.restore()
  return axes
}

/**
 * Draw one frame. Returns stats the DOM overlay can show and the projected
 * object markers a click can be matched against (empty when detections are
 * hidden, so hidden markers can never be selected).
 */
export function renderScene(ctx: Ctx2D, scene: SceneInput): RenderStats {
  const palette = scene.palette ?? VIEWER_PALETTE
  const basis = viewBasis(scene.camera)

  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, scene.viewport.width, scene.viewport.height)

  drawGroundGrid(ctx, scene.camera, basis, scene.bounds, scene.viewport, palette.grid)

  const stats: RenderStats = {
    drawnPoints: 0, culledPoints: 0, markers: [],
    drawnTrajectorySegments: 0, trajectoryVisible: false,
  }

  if (scene.showTrajectory) {
    const path = drawTrajectory(ctx, scene, basis, palette)
    stats.drawnTrajectorySegments = path.segments
    stats.trajectoryVisible = path.visible
  }

  const cloud = drawPointCloud(ctx, scene, basis)
  stats.drawnPoints = cloud.drawn
  stats.culledPoints = cloud.culled

  if (scene.showDetections) {
    drawDetections(ctx, scene, basis, palette, stats)
  }

  drawGizmo(ctx, basis, palette)
  return stats
}

export { drawGizmo }
