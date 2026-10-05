/**
 * Tests for viewer-frame.ts — the replacement for the canvas renderer suite.
 *
 * The viewer no longer draws with the 2D canvas API; three.js does, driven by
 * React components. What is asserted here is the equivalent of what the old
 * recording-canvas tests asserted: the drawing decisions that users depend on.
 * Independent layers, adjustable point size, a selection highlight, and the
 * report of whether the flight path is actually on screen all still exist — they
 * now take the form of geometry buffers and a frame description rather than
 * fillRect calls, so these tests read those instead of a stub canvas.
 *
 * Point-size *appearance* is not asserted here: the uniform in the point shader
 * mirrors `attenuatedSize` (clamped 0.5x–2.5x against the camera distance), and
 * that function's own behaviour is covered by viewer-camera.test.ts.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { confidenceColor } from '../src/app/droneviz3d/confidence'
import { TrackedObject } from '../src/app/droneviz3d/grounding'
import { Point3D } from '../src/app/droneviz3d/reconstruct'
import {
  GRID_DIVISIONS, SceneInput, VIEWER_PALETTE, buildCloudGeometry, confidenceColorRgba,
  detectionFootprint, detectionFootprintSegments, frameScene, groundGridSegments, hexToRgb,
  projectObjects, trajectoryDots, trajectorySegments,
} from '../src/app/droneviz3d/viewer-frame'
import { MAX_LABELS, labelBox } from '../src/app/droneviz3d/viewer-labels'
import { Viewport, boundingSphere, frameCamera, projectPoint, viewBasis } from '../src/app/droneviz3d/viewer-camera'

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
    // A flight leg that passes low over the model, so it is inside the frame.
    trajectoryPath: [{ x: -15, y: -15, z: 12 }, { x: 15, y: 15, z: 12 }],
    objects: objects(),
    showDetections: true,
    showTrajectory: true,
    selectedIndex: null,
    ...overrides,
  }
}

// ---------- The frame: markers, labels, layers, trajectory ----------

test('markers are exactly the projectable objects, and hidden detections cannot be picked', () => {
  const s = scene()
  const frame = frameScene(s)
  assert.equal(frame.markers.length, 2)
  frame.markers.forEach((marker, i) => {
    assert.equal(marker.index, i, 'marker index maps onto the object array')
    assert.ok(Number.isFinite(marker.x) && Number.isFinite(marker.y))
  })

  // The frame's markers are the same set projectObjects exposes to a caller.
  assert.deepEqual(frame.markers, projectObjects(s.objects, s.camera, viewBasis(s.camera), s.viewport))

  const hidden = frameScene(scene({ showDetections: false }))
  assert.equal(hidden.markers.length, 0, 'a hidden marker must not be selectable')
  assert.equal(hidden.annotations.length, 0)
  assert.ok(hidden.trajectory.drawnSegments > 0, 'the path layer is unaffected by the detection toggle')
})

test('label text reports the object class and its fused score', () => {
  const frame = frameScene(scene())
  assert.deepEqual(frame.annotations.map((a) => a.text), ['building 90%', 'vehicle 90%'])
  assert.equal(frame.labelsDrawn, frame.annotations.filter((a) => a.labelled).length,
    'the reported count is what the overlay will draw')
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

test('dense detections are decluttered to screen space instead of stacked', () => {
  const objects = crowdedObjects(30)
  const frame = frameScene(scene({ objects }))

  assert.ok(frame.labelsDrawn > 0, 'the densest cluster still gets a label')
  assert.ok(frame.labelsDrawn < objects.length, 'colliding labels are dropped, not stacked')
  assert.ok(frame.labelsDrawn <= MAX_LABELS, 'and never more than the cap')
  assert.equal(frame.annotations.length, objects.length, 'every object is still outlined')

  const boxes = frame.annotations.filter((a) => a.labelled).map((a) => labelBox(a))
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      const overlaps = a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
      assert.ok(!overlaps, 'two drawn labels overlap')
    }
  }
})

test('the selected object keeps its label when labels collide', () => {
  const objects = crowdedObjects(30)
  const selected = frameScene(scene({ objects, selectedIndex: 17 }))
  assert.ok(
    selected.annotations.find((a) => a.index === 17)?.labelled,
    'the selected object is always labelled'
  )

  // With nothing selected the tie-break is scene order, so the selected object is
  // not labelled by luck: it is labelled because it is selected.
  const unattended = frameScene(scene({ objects }))
  assert.ok(!unattended.annotations.find((a) => a.index === 17)?.labelled)
})

test('the frame reports whether the flight path is actually on screen', () => {
  assert.equal(frameScene(scene()).trajectory.visible, true)

  // A drone cruising far above a flat, tightly framed reconstruction: the path
  // exists but is outside the viewport, and the viewer needs to know that.
  const overhead = frameScene(scene({
    trajectoryPath: [{ x: -15, y: -15, z: 400 }, { x: 15, y: 15, z: 400 }],
  }))
  assert.equal(overhead.trajectory.visible, false)

  assert.equal(frameScene(scene({ showTrajectory: false })).trajectory.visible, false)
  assert.equal(frameScene(scene({ showTrajectory: false })).trajectory.drawnSegments, 0)
})

test('the take-off end is projected and offset for its label', () => {
  const s = scene()
  const frame = frameScene(s)
  const start = projectPoint(s.camera, viewBasis(s.camera), s.trajectoryPath[0], s.viewport)
  assert.ok(start, 'the take-off end is in front of the near plane')
  assert.deepEqual(frame.trajectory.takeoff, { x: start.x + 8, y: start.y - 8 })

  assert.equal(frameScene(scene({ trajectoryPath: [] })).trajectory.takeoff, null)
})

test('the gizmo is built from the same basis, labelled E, N and U, far axes first', () => {
  const frame = frameScene(scene())
  assert.deepEqual([...frame.gizmo.map((a) => a.key)].sort(), ['E', 'N', 'U'])
  for (let i = 1; i < frame.gizmo.length; i++) {
    assert.ok(frame.gizmo[i - 1].depth >= frame.gizmo[i].depth, 'far axes are painted first')
  }
})

test('an empty scene still produces a gizmo and no annotations', () => {
  const frame = frameScene(scene({ objects: [], trajectoryPath: [] }))
  assert.equal(frame.markers.length, 0)
  assert.equal(frame.annotations.length, 0)
  assert.equal(frame.labelsDrawn, 0)
  assert.equal(frame.trajectory.drawnSegments, 0)
  assert.equal(frame.gizmo.length, 3, 'the orientation gizmo is drawn for an empty scene too')
})

test('an object at the camera eye is behind the near plane and cannot be picked', () => {
  const s = scene()
  const atEye = [...s.objects, { ...s.objects[0], center: viewBasis(s.camera).eye }]
  assert.equal(projectObjects(atEye, s.camera, viewBasis(s.camera), s.viewport).length, 2)
  assert.equal(frameScene(scene({ objects: atEye })).markers.length, 2)
})

// ---------- Geometry for the GPU-drawn layers ----------

test('cloud geometry carries one position and one colour per point', () => {
  const cloud = points()
  const rgb = buildCloudGeometry(cloud, 'rgb')
  assert.equal(rgb.count, 3)
  assert.equal(rgb.positions.length, 9)
  assert.equal(rgb.colors.length, 12)
  assert.deepEqual([...rgb.positions.slice(0, 3)], [-10, -10, 0])
  // Colours are 0..1 floats, from the point's own RGB, fully opaque.
  assert.ok(Math.abs(rgb.colors[0] - 10 / 255) < 1e-6)
  assert.equal(rgb.colors[3], 1)

  const conf = buildCloudGeometry(cloud, 'confidence')
  const expected = confidenceColorRgba(0.9)
  assert.ok(Math.abs(conf.colors[0] - expected[0]) < 1e-6)
  assert.ok(Math.abs(conf.colors[3] - expected[3]) < 1e-6)
  assert.notEqual(conf.colors[0], rgb.colors[0], 'confidence mode ignores the baked-in colour')
})

test('confidence geometry matches the colour the rest of the app shows', () => {
  // confidenceColor returns "rgba(r, g, b, a)"; the geometry carries the same
  // value as floats. They are written in two places, so they are pinned together.
  for (const value of [0, 0.2, 0.55, 0.9, 1]) {
    const parsed = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(confidenceColor(value))
    assert.ok(parsed, `confidenceColor(${value}) parses`)
    const [r, g, b, a] = confidenceColorRgba(value)
    assert.equal(Number(parsed[1]), Math.round(r * 255))
    assert.equal(Number(parsed[2]), Math.round(g * 255))
    assert.equal(Number(parsed[3]), Math.round(b * 255))
    assert.ok(Math.abs(Number(parsed[4]) - a) < 1e-3)
  }
})

test('an empty cloud produces empty buffers rather than a draw call', () => {
  const empty = buildCloudGeometry([], 'rgb')
  assert.equal(empty.count, 0)
  assert.equal(empty.positions.length, 0)
  assert.equal(empty.colors.length, 0)
})

test('ground grid spans the bounds at z = 0, one line each way per division', () => {
  const s = scene()
  const grid = groundGridSegments(s.bounds)
  const vertices = grid.length / 3
  assert.equal(vertices, 4 * (GRID_DIVISIONS + 1), 'two segments per division, two ends each')
  for (let i = 2; i < grid.length; i += 3) assert.equal(grid[i], 0, 'the grid lies on the ground plane')
  for (let i = 0; i < grid.length; i += 3) {
    assert.ok(grid[i] >= s.bounds.min.x - 1e-6 && grid[i] <= s.bounds.max.x + 1e-6)
  }

  const noBounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, center: { x: 0, y: 0, z: 0 }, radius: 0 }
  assert.equal(groundGridSegments(noBounds).length, 0, 'nothing is drawn for an empty scene')
})

test('footprints are ground-plane rectangles around each object', () => {
  const object = objects()[0]
  const corners = detectionFootprint(object)
  assert.equal(corners.length, 4)
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  assert.equal(Math.min(...xs), object.center.x - object.halfExtentX)
  assert.equal(Math.max(...xs), object.center.x + object.halfExtentX)
  assert.equal(Math.min(...ys), object.center.y - object.halfExtentY)
  assert.equal(Math.max(...ys), object.center.y + object.halfExtentY)
  for (const corner of corners) assert.equal(corner.z, 0)

  const plain = detectionFootprintSegments([object], null)
  assert.equal(plain.positions.length / 3, 8, 'four edges per object, two ends each')
  assert.equal(plain.colors.length / 3, 8)
})

test('selecting an object colours its footprint with the selection colour', () => {
  const plain = detectionFootprintSegments([objects()[1]], null)
  const selected = detectionFootprintSegments([objects()[1]], 0)
  const selection = hexToRgb(VIEWER_PALETTE.selection)
  const accent = hexToRgb(VIEWER_PALETTE.accent)

  // The buffers are Float32Array, so compare with a tolerance rather than exactly.
  const closeTo = (actual: Float32Array, expected: number[]) =>
    expected.every((value, i) => Math.abs(actual[i] - value) < 1e-6)
  assert.ok(closeTo(plain.colors, accent))
  assert.ok(closeTo(selected.colors, selection))
  assert.notDeepEqual(plain.colors, selected.colors, 'the selected object is drawn in the selection colour')
})

test('trajectory geometry is consecutive pose pairs plus one dot per pose', () => {
  const path = scene().trajectoryPath
  const segments = trajectorySegments(path)
  assert.equal(segments.length, 6, 'one pair of poses')
  assert.deepEqual([...segments], [-15, -15, 12, 15, 15, 12])

  const dots = trajectoryDots(path)
  assert.equal(dots.length, 6, 'one dot per pose')
  assert.equal(trajectorySegments([path[0]]).length, 0, 'a single pose has no segments')
})

test('hexToRgb reads the palette format and falls back safely', () => {
  const [r, g, b] = hexToRgb('#d4a053')
  assert.ok(Math.abs(r - 0xd4 / 255) < 1e-6)
  assert.ok(Math.abs(g - 0xa0 / 255) < 1e-6)
  assert.ok(Math.abs(b - 0x53 / 255) < 1e-6)
  assert.deepEqual(hexToRgb('#fff'), [1, 1, 1])
  assert.deepEqual(hexToRgb('not-a-colour'), [1, 1, 1])
})
