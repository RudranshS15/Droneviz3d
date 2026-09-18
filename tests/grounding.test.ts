/**
 * Characterization tests for grounding.ts — the LocateAnything-3B adapter seam.
 *
 * Covers the parser (which mirrors the reference `parse_boxes`), the keyframe
 * plan, the detection → ground projection used by reconstruction, cross-keyframe
 * deduplication, and determinism of the simulated adapter.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  GroundingBox, ProjectedDetection, TARGET_KEYFRAMES,
  createSimulatedLocateAnythingAdapter, deduplicateDetections, groundSampleDistance,
  parseLocateAnythingOutput, planKeyframes, projectBoxToGround,
} from '../src/app/droneviz3d/grounding'
import { CameraModel, FlightParams, deg2rad, poseAt } from '../src/app/droneviz3d/geometry'

const LABELS = ['building', 'vehicle', 'tree'] as const
const CAM: CameraModel = { focal35: 24, frameWidth: 3840, frameHeight: 2160 }

// ---------- Parser ----------

test('parser normalizes LocateAnything box coordinates in [0,1000] to [0,1]', () => {
  const { boxes, points } = parseLocateAnythingOutput(
    '<ref>building</ref><box><100><200><300><400></box>', 7, LABELS
  )
  assert.equal(points.length, 0)
  assert.equal(boxes.length, 1)
  assert.deepEqual(boxes[0], {
    label: 'building', x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4, keyframeIndex: 7, score: 0.9,
  })
})

test('parser handles point boxes, `none`, inverted corners and degenerate boxes', () => {
  const point = parseLocateAnythingOutput('<box><500><600></box>', 3, LABELS)
  assert.equal(point.boxes.length, 0)
  assert.deepEqual(point.points[0], { label: 'building', x: 0.5, y: 0.6, keyframeIndex: 3, score: 0.75 })

  const none = parseLocateAnythingOutput('<box>none</box>', 0, LABELS)
  assert.equal(none.boxes.length, 0)
  assert.equal(none.points.length, 0)

  const inverted = parseLocateAnythingOutput('<ref>vehicle</ref><box><400><500><200><100></box>', 1, LABELS)
  assert.deepEqual(
    { x1: inverted.boxes[0].x1, y1: inverted.boxes[0].y1, x2: inverted.boxes[0].x2, y2: inverted.boxes[0].y2 },
    { x1: 0.2, y1: 0.1, x2: 0.4, y2: 0.5 }
  )

  const degenerate = parseLocateAnythingOutput('<ref>tree</ref><box><100><200><100><200></box>', 1, LABELS)
  assert.equal(degenerate.boxes.length, 0)
})

test('parser penalizes extreme aspect ratios and unrequested labels', () => {
  const wide = parseLocateAnythingOutput('<ref>building</ref><box><10><500><900><550></box>', 0, LABELS)
  assert.equal(wide.boxes[0].score, 0.75) // aspect 16:1 → −0.15
  const stray = parseLocateAnythingOutput('<ref>cat</ref><box><100><100><300><300></box>', 0, LABELS)
  assert.equal(stray.boxes[0].score, 0.8) // label not requested → −0.1
})

test('parser defaults a missing <ref> label to the first requested label', () => {
  const { boxes } = parseLocateAnythingOutput('<ref></ref><box><100><100><300><300></box>', 0, LABELS)
  assert.equal(boxes[0].label, 'building')
  const noLabels = parseLocateAnythingOutput('<ref></ref><box><100><100><300><300></box>', 0, [])
  assert.equal(noLabels.boxes[0].label, 'object')
})

test('parser tolerates multiple boxes in one answer', () => {
  const answer =
    '<ref>building</ref><box><100><100><300><300></box>' +
    '<ref>vehicle</ref><box><400><400><500><500></box>'
  const { boxes } = parseLocateAnythingOutput(answer, 5, LABELS)
  assert.equal(boxes.length, 2)
  assert.deepEqual(boxes.map((b) => b.label), ['building', 'vehicle'])
  assert.ok(boxes.every((b) => b.keyframeIndex === 5))
})

// ---------- Keyframe plan ----------

test('planKeyframes samples a fixed number of frames across the pass', () => {
  const plan = planKeyframes(180)
  assert.equal(plan.count, TARGET_KEYFRAMES)
  assert.equal(plan.times.length, TARGET_KEYFRAMES)
  assert.equal(plan.times[0], 0)
  assert.equal(plan.times[plan.count - 1], 1)
  for (let i = 1; i < plan.times.length; i++) {
    assert.ok(plan.times[i] > plan.times[i - 1], 'times are strictly increasing')
  }
  assert.equal(plan.frameIndices[plan.count - 1], 5400) // 180 s × 30 fps
})

// ---------- Ground sampling distance ----------

test('groundSampleDistance is finite and positive for a downward gimbal', () => {
  const pose = poseAt({ ...baseFlight() }, 0, 0)
  const gsd = groundSampleDistance(pose, CAM, 0.5)
  assert.ok(Number.isFinite(gsd) && gsd > 0)
  // vfov 53.13° at 120 m altitude: the vertical frame spans ~124 m ⇒ ~0.0575 m/px.
  assert.ok(Math.abs(gsd - 0.0575) < 0.001, `expected ~0.0575 m/px, got ${gsd}`)
})

test('groundSampleDistance is Infinity for a ray at the horizon', () => {
  const level = { ...poseAt(baseFlight(), 0, 0), pitch: 0 }
  assert.equal(groundSampleDistance(level, CAM, 0.5), Number.POSITIVE_INFINITY)
})

// ---------- Projection ----------

test('a frame-centre box projects onto the ground ahead of the camera', () => {
  const pose = poseAt(baseFlight(), 0, 0)
  const det = projectBoxToGround(box(0.4, 0.4, 0.6, 0.6, 0), pose, CAM)
  assert.ok(det)
  assert.ok(Math.abs(det.center.x) < 1e-9)
  assert.ok(Math.abs(det.center.y - 32.15) < 0.05)
  assert.equal(det.center.z, 0)
  assert.ok(det.halfExtentX > 0 && det.halfExtentY > 0)
  assert.equal(det.keyframeIndex, 0)
  assert.equal(det.viewingAltitude, 120)
})

test('a box above the horizon does not project (no ground hit)', () => {
  const level = { ...poseAt(baseFlight(), 0, 0), pitch: deg2rad(-5) }
  assert.equal(projectBoxToGround(box(0.45, 0.02, 0.55, 0.08, 0), level, CAM), null)
})

test('projection follows the flight heading (0 = North, 90 = East)', () => {
  const north = projectBoxToGround(box(0.4, 0.4, 0.6, 0.6, 0), poseAt(baseFlight(), 0, 0), CAM)!
  const east = projectBoxToGround(
    box(0.4, 0.4, 0.6, 0.6, 0), poseAt({ ...baseFlight(), heading: 90 }, 0, 0), CAM
  )!
  assert.ok(north.center.y > 30 && Math.abs(north.center.x) < 1e-6)
  assert.ok(east.center.x > 30 && Math.abs(east.center.y) < 1e-6)
})

// ---------- Deduplication ----------

test('deduplicateDetections fuses nearby same-label detections and raises confidence', () => {
  const tracked = deduplicateDetections([
    det('building', 0, 0, 0.5, 1),
    det('building', 0.4, 0, 0.5, 1),
    det('building', 40, 0, 0.5, 1),   // too far away → separate object
    det('vehicle', 0.2, 0, 0.4, 1),   // different label → not merged
  ])
  assert.equal(tracked.length, 3)
  const fused = tracked[0]
  assert.equal(fused.label, 'building')
  assert.equal(fused.observations, 2)
  assert.ok(Math.abs(fused.center.x - 0.2) < 1e-9, 'center is the running mean')
  assert.ok(fused.score > 0.5, 'multi-view corroboration raises the score')
  assert.equal(tracked[1].observations, 1)
})

test('deduplicateDetections keeps the highest-scoring detection as `best`', () => {
  const tracked = deduplicateDetections([
    det('building', 0, 0, 0.4, 0),
    det('building', 0.1, 0, 0.9, 1),
  ])
  assert.equal(tracked.length, 1)
  assert.equal(tracked[0].best.keyframeIndex, 1)
  assert.equal(tracked[0].best.score, 0.9)
})

test('deduplicateDetections widens the footprint to the largest observation', () => {
  const tracked = deduplicateDetections([
    { ...det('tree', 0, 0, 0.5, 0), halfExtentX: 2, halfExtentY: 2 },
    { ...det('tree', 0.5, 0, 0.5, 1), halfExtentX: 5, halfExtentY: 3 },
  ])
  assert.equal(tracked[0].halfExtentX, 5)
  assert.equal(tracked[0].halfExtentY, 3)
})

// ---------- Simulated adapter ----------

test('the simulated adapter is deterministic for the same flight parameters', async () => {
  const requests = planKeyframes(180).times.map((_, i) => ({
    image: new Blob(), keyframeIndex: i, labels: LABELS,
  }))
  const a = await createSimulatedLocateAnythingAdapter(baseFlight())(requests)
  const b = await createSimulatedLocateAnythingAdapter(baseFlight())(requests)
  assert.equal(a.length, requests.length)
  assert.deepEqual(
    a.map((r) => r.boxes),
    b.map((r) => r.boxes)
  )
  assert.ok(a.every((r) => r.source === 'simulated'))
})

test('the simulated adapter only emits requested labels and fills every keyframe', async () => {
  const plan = planKeyframes(60)
  const responses = await createSimulatedLocateAnythingAdapter(baseFlight())(
    plan.times.map((_, i) => ({ image: new Blob(), keyframeIndex: i, labels: ['building'] }))
  )
  assert.equal(responses.length, plan.count)
  for (const r of responses) {
    for (const b of r.boxes) {
      assert.ok(b.x1 >= 0 && b.x2 <= 1 && b.y1 >= 0 && b.y2 <= 1, 'boxes are normalized')
      assert.ok(b.x2 > b.x1 && b.y2 > b.y1, 'boxes are non-degenerate')
      assert.ok(b.score >= 0.3 && b.score <= 0.98)
    }
  }
})

// ---------- helpers ----------

function baseFlight(): FlightParams {
  return {
    gpsLat: 28.6139, gpsLng: 77.209, altitude: 120, speed: 8, heading: 0,
    durationSec: 180, rtkCorrections: false,
  }
}

function box(x1: number, y1: number, x2: number, y2: number, keyframeIndex: number): GroundingBox {
  return { label: 'building', x1, y1, x2, y2, keyframeIndex, score: 0.9 }
}

function det(
  label: string, x: number, y: number, score: number, keyframeIndex: number
): ProjectedDetection {
  return {
    label, center: { x, y, z: 0 }, halfExtentX: 1, halfExtentY: 1,
    score, keyframeIndex, viewingAltitude: 120,
  }
}
