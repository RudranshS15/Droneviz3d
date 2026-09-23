/**
 * Characterization tests for reconstruct.ts — the pipeline entry point.
 *
 * The reconstruction is deterministic geometry synthesis driven by grounded
 * detections, so these tests lock three things that must not drift silently:
 *   1. the local ENU frame (x = East, y = North, z = Up) survives into the model,
 *   2. the same input always produces byte-identical output,
 *   3. nothing is invented beyond what the detections + flight metadata support.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  KeyframePlan, createSimulatedLocateAnythingAdapter, planKeyframes,
} from '../src/app/droneviz3d/grounding'
import {
  TRAJECTORY_RGB, buildHeightField, footprintCoverage, isTrajectoryPoint,
  reconstruct, ReconstructOutput,
} from '../src/app/droneviz3d/reconstruct'
import { TrackedObject } from '../src/app/droneviz3d/grounding'
import { FlightParams } from '../src/app/droneviz3d/geometry'
import { ValidatedFlightData } from '../src/app/droneviz3d/validator'

function flight(overrides: Partial<ValidatedFlightData> = {}): ValidatedFlightData {
  return {
    gpsLat: 28.6139, gpsLng: 77.209, altitude: 120, speed: 8, heading: 0,
    timestamp: '2026-01-01T00:00:00', cameraFocalLength: 24,
    cameraWidth: 3840, cameraHeight: 2160,
    imuData: false, barometricAlt: false, rtkCorrections: false,
    ...overrides,
  }
}

function flightParams(f: ValidatedFlightData, durationSec = 180): FlightParams {
  return {
    gpsLat: f.gpsLat, gpsLng: f.gpsLng, altitude: f.altitude,
    speed: f.speed, heading: f.heading, durationSec, rtkCorrections: f.rtkCorrections,
  }
}

/** Run the same path the store runs: simulated grounding → reconstruct. */
async function run(f: ValidatedFlightData, durationSec = 180): Promise<ReconstructOutput> {
  const plan = planKeyframes(durationSec)
  const adapter = createSimulatedLocateAnythingAdapter(flightParams(f, durationSec))
  const grounding = await adapter(
    plan.times.map((_, i) => ({ image: new Blob(), keyframeIndex: i, labels: ['building', 'vehicle', 'tree'] }))
  )
  return reconstruct({ flight: f, videoDurationSec: durationSec, grounding, keyframePlan: plan })
}

// ---------- Determinism ----------

test('reconstruct is deterministic: same input ⇒ byte-identical model', async () => {
  const a = await run(flight())
  const b = await run(flight())
  assert.equal(JSON.stringify(a.points), JSON.stringify(b.points))
  assert.equal(JSON.stringify(a.metrics), JSON.stringify(b.metrics))
  assert.equal(JSON.stringify(a.trackedObjects), JSON.stringify(b.trackedObjects))
  assert.equal(JSON.stringify(a.bounds), JSON.stringify(b.bounds))
})

test('different flight metadata produces a different model', async () => {
  const a = await run(flight())
  const b = await run(flight({ gpsLat: 19.076, gpsLng: 72.877, heading: 137 }))
  assert.notEqual(JSON.stringify(a.points), JSON.stringify(b.points))
})

// ---------- Frame convention ----------

test('reconstructed heights are +z and the ground is z ≈ 0 (z-up ENU)', async () => {
  const out = await run(flight())
  const zs = out.points.map((p) => p.z)
  assert.ok(Math.min(...zs) >= -0.16, 'nothing dips meaningfully below the ground plane')
  // The cloud is scene geometry only. It used to carry drone-track markers at
  // cruise altitude, which is what made a scene "height" of 120 m plausible.
  assert.ok(Math.max(...zs) < 40, `scene heights must be object-scale, got ${Math.max(...zs)}`)
  assert.ok(out.points.some((p) => p.z > 1 && p.z < 40), 'objects extrude upward from the ground')
})

test('the point cloud holds no drone-track markers; the flight path is separate', async () => {
  const out = await run(flight())
  const markers = out.points.filter(isTrajectoryPoint)
  assert.equal(markers.length, 0, 'drone positions must not enter the point cloud')
  assert.ok(out.trajectory.length > 0, 'the path still exists, as its own layer')
  // Statistics must be unaffected by how densely the path is sampled: nothing in
  // the cloud may carry the sentinel colour.
  const classLike = new Set(out.points.map((p) => `${p.r},${p.g},${p.b}`))
  assert.ok(!classLike.has(`${TRAJECTORY_RGB.r},${TRAJECTORY_RGB.g},${TRAJECTORY_RGB.b}`))
})

test('the tracked objects and their heights stay above the ground plane', async () => {
  const out = await run(flight())
  assert.ok(out.trackedObjects.length > 0, 'the simulated scene must yield detections')
  for (const t of out.trackedObjects) {
    assert.equal(t.center.z, 0, 'object centers are ground-plane projections')
    assert.ok(Number.isFinite(t.center.x) && Number.isFinite(t.center.y))
    assert.ok(t.halfExtentX > 0 && t.halfExtentY > 0)
    assert.ok(t.observations >= 1)
  }
})

test('grounded objects lie ahead along the flight heading in the ENU frame', async () => {
  // heading is compass degrees: 0 = North (+y), 90 = East (+x), 180 = South,
  // 270 = West. If an axis is ever swapped, one of these four must fail.
  for (const heading of [0, 90, 180, 270]) {
    const out = await run(flight({ heading }))
    const n = out.trackedObjects.length
    const meanX = out.trackedObjects.reduce((s, t) => s + t.center.x, 0) / n
    const meanY = out.trackedObjects.reduce((s, t) => s + t.center.y, 0) / n
    const rad = (heading * Math.PI) / 180
    const along = meanX * Math.sin(rad) + meanY * Math.cos(rad)
    const across = meanX * Math.cos(rad) - meanY * Math.sin(rad)
    assert.ok(
      along > 25,
      `heading ${heading}: detections should sit ahead of the camera, got ${along.toFixed(2)} m`
    )
    assert.ok(
      Math.abs(across) < along,
      `heading ${heading}: lateral spread (${across.toFixed(2)} m) must not dominate the along-track spread`
    )
  }
})

// ---------- Provenance: nothing invented ----------

test('object labels come only from the requested classes', async () => {
  const out = await run(flight())
  const allowed = new Set(['building', 'vehicle', 'tree'])
  for (const t of out.trackedObjects) assert.ok(allowed.has(t.label), `unexpected label ${t.label}`)
  for (const label of out.metrics.groundedLabels.split(', ')) assert.ok(allowed.has(label))
})

test('metrics agree with the model they describe', async () => {
  const out = await run(flight())
  assert.equal(out.metrics.totalPoints, out.points.length.toLocaleString())
  assert.equal(out.metrics.groundedObjects, String(out.trackedObjects.length))
  const mean = out.points.reduce((s, p) => s + p.confidence, 0) / out.points.length
  assert.equal(out.metrics.confidenceScore, mean.toFixed(2))
  // This run used the simulated adapter, so the provenance must say so rather
  // than crediting LocateAnything-3B for detections no model produced.
  assert.equal(out.groundingSource, 'simulated')
  assert.match(out.metrics.provenance, /Simulated/)
  assert.ok(!/LocateAnything-3B detections/.test(out.metrics.provenance))
  assert.match(out.metrics.groundingSource, /simulated/i)
  // What is synthesized is stated, not left to inference.
  assert.match(out.metrics.synthesis, /synthesi/i)
})

test('a worker-backed run reports its real source', async () => {
  const plan = planKeyframes(180)
  const out = reconstruct({
    flight: flight(), videoDurationSec: 180,
    grounding: plan.times.map((_, i) => ({ boxes: [], points: [], keyframeIndex: i, source: 'locateanything-3b' as const })),
    keyframePlan: plan,
  })
  assert.equal(out.groundingSource, 'locateanything-3b')
  assert.match(out.metrics.provenance, /LocateAnything-3B/)
})

test('point confidence stays inside the documented band', async () => {
  const out = await run(flight())
  for (const p of out.points) {
    assert.ok(p.confidence >= 0.35 && p.confidence <= 0.97, `confidence out of band: ${p.confidence}`)
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))
    assert.ok(p.r >= 0 && p.r <= 255 && p.g >= 0 && p.g <= 255 && p.b >= 0 && p.b <= 255)
  }
})

test('georeferenced bounds describe the scene and contain every scene point', async () => {
  const out = await run(flight())
  assert.equal(out.trajectory.length, 40)
  const M_PER_DEG_LAT = 111320
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((28.6139 * Math.PI) / 180)
  // Bounds come from the reconstructed geometry, not the camera positions, so
  // every point the model would export must fall inside them.
  for (const p of out.points) {
    const lat = 28.6139 + p.y / M_PER_DEG_LAT
    const lng = 77.209 + p.x / mPerDegLng
    assert.ok(lat >= out.bounds.minLat - 1e-9 && lat <= out.bounds.maxLat + 1e-9, `lat ${lat} outside bounds`)
    assert.ok(lng >= out.bounds.minLng - 1e-9 && lng <= out.bounds.maxLng + 1e-9, `lng ${lng} outside bounds`)
  }
  assert.ok(out.bounds.minLat <= out.bounds.maxLat && out.bounds.minLng <= out.bounds.maxLng)
})

test('bounds span the scene east–west even on a due-north flight', async () => {
  // The regression this locks: deriving bounds from the trajectory gives a
  // north–south pass a longitude width of exactly zero, so the model claimed to
  // cover no ground east–west while its points spanned tens of metres.
  const out = await run(flight({ heading: 0 }))
  const M_PER_DEG_LAT = 111320
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((28.6139 * Math.PI) / 180)
  const widthM = (out.bounds.maxLng - out.bounds.minLng) * mPerDegLng
  assert.ok(widthM > 10, `east–west extent must reflect the scene, got ${widthM.toFixed(2)} m`)
})

// ---------- Degraded inputs ----------

test('zero detections still yields a ground model with honest empty metrics', async () => {
  const plan: KeyframePlan = planKeyframes(60)
  const out = reconstruct({
    flight: flight(), videoDurationSec: 60,
    grounding: plan.times.map((_, i) => ({ boxes: [], points: [], keyframeIndex: i, source: 'simulated' as const })),
    keyframePlan: plan,
  })
  assert.equal(out.trackedObjects.length, 0)
  assert.equal(out.metrics.groundedObjects, '0')
  assert.equal(out.metrics.groundedLabels, 'none detected')
  assert.ok(out.points.length > 0, 'the ground carpet is still generated')
  assert.equal(out.annotations.length, 0)
})

// ---------- Coverage ----------

function trackedAt(x: number, y: number, halfExtentX = 4, halfExtentY = 3): TrackedObject {
  const hit = {
    label: 'building', center: { x, y, z: 0 }, halfExtentX, halfExtentY,
    score: 0.9, keyframeIndex: 0, viewingAltitude: 120,
  }
  return {
    label: 'building', center: { x, y, z: 0 }, halfExtentX, halfExtentY,
    score: 0.9, observations: 1, hits: [hit], best: hit,
  }
}

test('coverage is an area share, not an object count', () => {
  const extent = 320
  assert.equal(footprintCoverage(new Map(), extent), 0, 'an empty scene covers nothing')
  const one = buildHeightField([trackedAt(0, 0)], extent, 1)
  const two = buildHeightField([trackedAt(0, 0), trackedAt(200, 200)], extent, 1)
  assert.ok(footprintCoverage(one, extent) > 0)
  assert.ok(footprintCoverage(two, extent) > footprintCoverage(one, extent))
  assert.ok(footprintCoverage(one, extent) <= 1, 'a share can never exceed 1')
  assert.equal(footprintCoverage(one, 0), 0, 'a degenerate extent cannot divide by zero')
})

test('overlapping footprints are counted once', () => {
  const extent = 320
  const single = footprintCoverage(buildHeightField([trackedAt(10, 10)], extent, 1), extent)
  const overlapping = footprintCoverage(buildHeightField([trackedAt(10, 10), trackedAt(10.5, 10.5)], extent, 1), extent)
  const disjoint = footprintCoverage(buildHeightField([trackedAt(10, 10), trackedAt(200, 200)], extent, 1), extent)
  // Two detections of one footprint must not claim twice the area...
  assert.ok(Math.abs(overlapping - single) < single * 0.25, `overlap inflated coverage: ${overlapping} vs ${single}`)
  // ...while two separate footprints must add up.
  assert.ok(disjoint > single * 1.5, `separate footprints should add: ${disjoint} vs ${single}`)
})

test('the reported coverage is a real percentage of the modelled area', async () => {
  const out = await run(flight())
  const value = Number(out.metrics.coverage.replace('%', ''))
  assert.ok(Number.isFinite(value), `coverage must parse, got '${out.metrics.coverage}'`)
  assert.ok(value > 0 && value <= 100, `coverage must be in (0, 100], got '${out.metrics.coverage}'`)
})

test('detections from several keyframes fuse into the same tracked object', async () => {
  const plan: KeyframePlan = planKeyframes(180)
  const adapter = createSimulatedLocateAnythingAdapter(flightParams(flight()))
  const grounding = await adapter(
    plan.times.map((_, i) => ({ image: new Blob(), keyframeIndex: i, labels: ['building', 'vehicle', 'tree'] }))
  )
  const out = reconstruct({ flight: flight(), videoDurationSec: 180, grounding, keyframePlan: plan })
  const totalObservations = out.trackedObjects.reduce((s, t) => s + t.observations, 0)
  assert.ok(totalObservations > out.trackedObjects.length, 'objects are seen from more than one keyframe')
  assert.ok(out.trackedObjects.some((t) => t.observations > 1))
  assert.equal(out.projectedDetections.length, totalObservations, 'every observation is accounted for')
})
