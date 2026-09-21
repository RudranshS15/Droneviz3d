/**
 * Tests for viewer-render.ts.
 *
 * The renderer draws through a small structural canvas interface, so it can be
 * exercised with a recording stub. That lets us assert the things users actually
 * rely on — independent layers, adjustable point size, a selection highlight —
 * without a browser.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  Ctx2D, LABEL_HEIGHT, MAX_LABELS, SceneInput, VIEWER_PALETTE,
  declutterLabels, labelBox, labelWidth, projectObjects, renderScene,
} from '../src/app/droneviz3d/viewer-render'
import { Viewport, boundingSphere, frameCamera, viewBasis } from '../src/app/droneviz3d/viewer-camera'
import { confidenceColor } from '../src/app/droneviz3d/confidence'
import { Point3D } from '../src/app/droneviz3d/reconstruct'
import { TrackedObject } from '../src/app/droneviz3d/grounding'

interface Fill { style: string; x: number; y: number; w: number; h: number }

class RecordingCtx implements Ctx2D {
  fillStyle = ''
  strokeStyle = ''
  lineWidth = 0
  font = ''
  globalAlpha = 1
  textAlign: 'left' | 'center' | 'right' = 'left'
  textBaseline: 'top' | 'middle' | 'bottom' | 'alphabetic' = 'alphabetic'
  fills: Fill[] = []
  texts: string[] = []
  /** strokeStyle recorded at each stroke() call */
  strokeStyles: string[] = []
  arcs = 0

  fillRect(x: number, y: number, w: number, h: number): void {
    this.fills.push({ style: this.fillStyle, x, y, w, h })
  }
  clearRect(): void { /* unused by the renderer */ }
  beginPath(): void { /* no-op */ }
  closePath(): void { /* no-op */ }
  moveTo(): void { /* no-op */ }
  lineTo(): void { /* no-op */ }
  arc(): void { this.arcs += 1 }
  stroke(): void { this.strokeStyles.push(this.strokeStyle) }
  fill(): void { this.fills.push({ style: this.fillStyle, x: 0, y: 0, w: 0, h: 0 }) }
  /** every fillText call, with the position it was drawn at */
  textCalls: { text: string; x: number; y: number }[] = []
  fillText(text: string, x = 0, y = 0): void {
    this.texts.push(text)
    this.textCalls.push({ text, x, y })
  }
  save(): void { /* no-op */ }
  restore(): void { /* no-op */ }

  /** point fills are square fillRects that are not the background fill */
  get pointFills(): Fill[] {
    return this.fills.filter((f) => f.w > 0 && f.w < this.backgroundWidth && f.w === f.h)
  }
  backgroundWidth = -1
}

const VIEWPORT: Viewport = { width: 800, height: 600 }

function points(): Point3D[] {
  return [
    { x: -10, y: -10, z: 0, r: 10, g: 20, b: 30, confidence: 0.9 },
    { x: 10, y: 10, z: 0, r: 40, g: 50, b: 60, confidence: 0.2 },
    { x: 0, y: 0, z: 12, r: 70, g: 80, b: 90, confidence: 0.6 },
  ]
}

function objects(): TrackedObject[] {
  const mk = (x: number, y: number, label: string): TrackedObject => {
    const hit = {
      label, center: { x, y, z: 0 }, halfExtentX: 4, halfExtentY: 2,
      score: 0.9, keyframeIndex: 0, viewingAltitude: 120,
    }
    return { label, center: { x, y, z: 0 }, halfExtentX: 4, halfExtentY: 2, score: 0.9, observations: 1, hits: [hit], best: hit }
  }
  return [mk(6, 6, 'building'), mk(-8, 4, 'vehicle')]
}

function scene(overrides: Partial<SceneInput> = {}): SceneInput {
  const cloud = points()
  const bounds = boundingSphere([...cloud, { x: 0, y: 0, z: 0 }], 0)
  const viewport = overrides.viewport ?? VIEWPORT
  return {
    camera: frameCamera(bounds, viewport),
    viewport,
    bounds,
    points: cloud,
    // A flight leg that passes low over the model, so it is inside the frame.
    trajectoryPath: [{ x: -15, y: -15, z: 12 }, { x: 15, y: 15, z: 12 }],
    objects: objects(),
    pointSize: 3,
    colorMode: 'rgb',
    showDetections: true,
    showTrajectory: true,
    selectedIndex: null,
    palette: VIEWER_PALETTE,
    ...overrides,
  }
}

function render(input: SceneInput): { ctx: RecordingCtx; stats: ReturnType<typeof renderScene> } {
  const ctx = new RecordingCtx()
  ctx.backgroundWidth = input.viewport.width + 1
  const stats = renderScene(ctx, input)
  return { ctx, stats }
}

test('renders a framed model: every point drawn, background first', () => {
  const { ctx, stats } = render(scene())
  assert.equal(stats.drawnPoints, 3)
  assert.equal(stats.culledPoints, 0)
  assert.equal(ctx.fills[0].style, VIEWER_PALETTE.background)
  assert.equal(ctx.fills[0].w, VIEWPORT.width)
  assert.equal(ctx.pointFills.length, 3)
  for (const fill of ctx.pointFills) {
    assert.ok(fill.x > 0 && fill.x < VIEWPORT.width, 'drawn inside the viewport')
    assert.ok(fill.y > 0 && fill.y < VIEWPORT.height)
  }
})

test('rgb mode uses the point colours; confidence mode uses the shared scale', () => {
  const rgb = render(scene({ colorMode: 'rgb' }))
  assert.ok(rgb.ctx.pointFills.some((f) => f.style === 'rgb(10, 20, 30)'))
  assert.ok(rgb.ctx.pointFills.some((f) => f.style === 'rgb(70, 80, 90)'))

  const conf = render(scene({ colorMode: 'confidence' }))
  const styles = new Set(conf.ctx.pointFills.map((f) => f.style))
  assert.ok(styles.has(confidenceColor(0.9)))
  assert.ok(styles.has(confidenceColor(0.2)))
  assert.ok(!styles.has('rgb(10, 20, 30)'), 'confidence mode ignores baked-in colour')
})

test('point size is adjustable and applied to every point', () => {
  const small = render(scene({ pointSize: 1 }))
  const large = render(scene({ pointSize: 8 }))
  const average = (fills: Fill[]) => fills.reduce((s, f) => s + f.w, 0) / fills.length
  assert.ok(average(large.ctx.pointFills) > average(small.ctx.pointFills) * 2)
  for (const fill of large.ctx.pointFills) assert.ok(fill.w > 0)
})

test('detections and trajectory toggle independently', () => {
  const all = render(scene())
  assert.equal(all.stats.markers.length, 2)
  assert.ok(all.stats.drawnTrajectorySegments > 0)

  const noDetections = render(scene({ showDetections: false }))
  assert.equal(noDetections.stats.markers.length, 0, 'hidden markers cannot be selected')
  assert.ok(noDetections.stats.drawnTrajectorySegments > 0, 'the path layer is unaffected')
  assert.ok(!noDetections.ctx.texts.includes('building 90%'))

  const noTrajectory = render(scene({ showTrajectory: false }))
  assert.equal(noTrajectory.stats.drawnTrajectorySegments, 0)
  assert.equal(noTrajectory.stats.markers.length, 2, 'the detection layer is unaffected')
  assert.ok(!noTrajectory.ctx.texts.includes('take-off'))

  const neither = render(scene({ showDetections: false, showTrajectory: false }))
  assert.equal(neither.stats.markers.length, 0)
  assert.equal(neither.stats.drawnTrajectorySegments, 0)
  assert.equal(neither.stats.drawnPoints, 3, 'the model itself still renders')
})

test('the renderer reports whether the flight path is actually on screen', () => {
  const visible = render(scene())
  assert.equal(visible.stats.trajectoryVisible, true)

  // A drone cruising far above a flat, tightly framed reconstruction: the path
  // is drawn but outside the viewport, and the viewer needs to know that.
  const overhead = scene({
    trajectoryPath: [{ x: -15, y: -15, z: 400 }, { x: 15, y: 15, z: 400 }],
  })
  const hidden = render(overhead)
  assert.equal(hidden.stats.trajectoryVisible, false)

  // Hidden because the layer is off is reported the same way (nothing on screen).
  assert.equal(render(scene({ showTrajectory: false })).stats.trajectoryVisible, false)
})

test('label text reports the object class and its fused score', () => {
  const { ctx } = render(scene())
  assert.ok(ctx.texts.includes('building 90%'))
  assert.ok(ctx.texts.includes('vehicle 90%'))
  assert.ok(ctx.texts.includes('E') && ctx.texts.includes('N') && ctx.texts.includes('U'), 'gizmo axes are labelled')
})

/** A dense detection set: many objects whose markers land on top of each other. */
function crowdedObjects(count: number): TrackedObject[] {
  return Array.from({ length: count }, (_, i) => {
    const label = `b${i}`
    const hit = {
      label, center: { x: 6 + (i % 4) * 0.25, y: 6 + Math.floor(i / 4) * 0.25, z: 0 },
      halfExtentX: 4, halfExtentY: 2, score: 0.9, keyframeIndex: 0, viewingAltitude: 120,
    }
    return { label, center: hit.center, halfExtentX: 4, halfExtentY: 2, score: 0.9, observations: 1, hits: [hit], best: hit }
  })
}

/** The label boxes the renderer actually drew, computed exactly as it did. */
function drawnLabelBoxes(ctx: RecordingCtx): { text: string; minX: number; minY: number; maxX: number; maxY: number }[] {
  return ctx.textCalls
    .filter((call) => /^b\d+ \d+%$/.test(call.text))
    .map((call) => ({
      text: call.text,
      minX: call.x,
      maxX: call.x + labelWidth(call.text),
      minY: call.y - LABEL_HEIGHT / 2,
      maxY: call.y + LABEL_HEIGHT / 2,
    }))
}

test('dense detections are decluttered to screen space instead of stacked', () => {
  const objects = crowdedObjects(30)
  const { ctx, stats } = render(scene({ objects }))

  assert.equal(drawnLabelBoxes(ctx).length, stats.labelsDrawn, 'the reported count is what was drawn')
  assert.ok(stats.labelsDrawn > 0, 'the densest cluster still gets a label')
  assert.ok(stats.labelsDrawn < objects.length, 'colliding labels are dropped, not stacked')
  assert.ok(stats.labelsDrawn <= MAX_LABELS, 'and never more than the cap')

  const boxes = drawnLabelBoxes(ctx)
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      const overlaps = a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
      assert.ok(!overlaps, `${a.text} overlaps ${b.text}`)
    }
  }

  assert.ok(ctx.strokeStyles.length > 0, 'every object is still outlined, labelled or not')
})

test('the selected object keeps its label when labels collide', () => {
  const objects = crowdedObjects(30)
  const { ctx } = render(scene({ objects, selectedIndex: 17 }))
  const drawn = drawnLabelBoxes(ctx).map((box) => box.text)
  assert.ok(drawn.includes('b17 90%'), 'the selected object is always labelled')
  assert.ok(drawn.length < objects.length)

  // With nothing selected the tie-break is scene order, so the selected object is
  // not labelled by luck: it is labelled because it is selected.
  const unattended = drawnLabelBoxes(render(scene({ objects })).ctx).map((box) => box.text)
  assert.ok(!unattended.includes('b17 90%'))
})

test('declutterLabels drops collisions and prefers the higher score', () => {
  const placements = [
    { index: 0, x: 100, y: 100, text: 'weak 50%', score: 0.5, selected: false },
    { index: 1, x: 104, y: 101, text: 'strong 95%', score: 0.95, selected: false },
    { index: 2, x: 400, y: 300, text: 'apart 70%', score: 0.7, selected: false },
  ]
  assert.deepEqual(declutterLabels(placements).map((p) => p.index), [1, 2])
})

test('the selected label outranks a higher score, and the cap is enforced', () => {
  const selected = [
    { index: 0, x: 100, y: 100, text: 'winner 99%', score: 0.99, selected: false },
    { index: 1, x: 100, y: 100, text: 'picked 40%', score: 0.4, selected: true },
  ]
  assert.deepEqual(declutterLabels(selected).map((p) => p.index), [1])

  const many = Array.from({ length: 40 }, (_, i) => ({
    index: i, x: (i % 8) * 400, y: Math.floor(i / 8) * 300, text: `o${i} 90%`, score: 0.9, selected: false,
  }))
  assert.equal(declutterLabels(many).length, MAX_LABELS)
  assert.equal(declutterLabels(many, 3).length, 3)
})

test('labelBox reserves more room for longer text', () => {
  const short = labelBox({ x: 0, y: 0, text: 'a' })
  const long = labelBox({ x: 0, y: 0, text: 'a much longer label' })
  assert.equal(long.minX, short.minX)
  assert.ok(long.maxX > short.maxX)
  assert.equal(long.maxY - long.minY, LABEL_HEIGHT)
})

test('selecting an object highlights it with the selection colour', () => {
  const plain = render(scene())
  const selected = render(scene({ selectedIndex: 1 }))
  const usedSelection = (r: { ctx: RecordingCtx }) =>
    r.ctx.fills.some((f) => f.style === VIEWER_PALETTE.selection) ||
    r.ctx.strokeStyles.includes(VIEWER_PALETTE.selection)
  assert.ok(!usedSelection(plain))
  assert.ok(usedSelection(selected), 'the selected object is drawn in the selection colour')
})

test('points at or behind the near plane are culled rather than drawn', () => {
  const base = scene()
  const eye = viewBasis(base.camera).eye
  const cloud = [...base.points, { ...eye, r: 9, g: 9, b: 9, confidence: 0.5 }]
  const { stats } = render(scene({ points: cloud }))
  assert.equal(stats.drawnPoints, 3)
  assert.equal(stats.culledPoints, 1)
})

test('an empty cloud still renders the background, grid and gizmo', () => {
  const { ctx, stats } = render(scene({ points: [], trajectoryPath: [], objects: [] }))
  assert.equal(stats.drawnPoints, 0)
  assert.equal(stats.markers.length, 0)
  assert.ok(ctx.strokeStyles.length > 0, 'the ground grid is still stroked')
  assert.ok(ctx.texts.includes('U'))
})

test('projectObjects exposes the screen positions a click is matched against', () => {
  const s = scene()
  const basis = viewBasis(s.camera)
  const markers = projectObjects(s.objects, s.camera, basis, s.viewport)
  assert.equal(markers.length, 2)
  markers.forEach((marker, i) => {
    assert.equal(marker.index, i, 'marker index maps onto the object array')
    assert.ok(Number.isFinite(marker.x) && Number.isFinite(marker.y))
  })

  // The markers the renderer reports are exactly the pickable ones.
  const { stats } = render(s)
  assert.deepEqual(stats.markers, markers)

  // An object sitting at the camera eye is behind the near plane: not pickable.
  const atEye = [...s.objects, { ...s.objects[0], center: viewBasis(s.camera).eye }]
  assert.equal(projectObjects(atEye, s.camera, basis, s.viewport).length, 2)
})
