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
import { reconstruct, ReconstructOutput } from '../src/app/droneviz3d/reconstruct'
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
  assert.ok(Math.max(...zs) >= 100, 'the drone track sits at altitude on +z')
  assert.ok(out.points.some((p) => p.z > 1 && p.z < 40), 'objects extrude upward from the ground')
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
  assert.ok(out.metrics.provenance.includes('LocateAnything-3B'))
})

test('point confidence stays inside the documented band', async () => {
  const out = await run(flight())
  for (const p of out.points) {
    assert.ok(p.confidence >= 0.35 && p.confidence <= 0.97, `confidence out of band: ${p.confidence}`)
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))
    assert.ok(p.r >= 0 && p.r <= 255 && p.g >= 0 && p.g <= 255 && p.b >= 0 && p.b <= 255)
  }
})

test('the drone track is embedded in the point cloud at exactly the flight altitude', async () => {
  const out = await run(flight())
  const track = out.points.filter((p) => p.r === 60 && p.g === 150 && p.b === 220)
  assert.equal(track.length, 61)
  for (const p of track) assert.equal(p.z, 120)
})

test('georeferenced bounds contain every trajectory pose', async () => {
  const out = await run(flight())
  assert.equal(out.trajectory.length, 40)
  for (const pose of out.trajectory) {
    assert.ok(pose.lat >= out.bounds.minLat && pose.lat <= out.bounds.maxLat)
    assert.ok(pose.lng >= out.bounds.minLng && pose.lng <= out.bounds.maxLng)
  }
  assert.ok(out.bounds.minLat !== out.bounds.maxLat || out.bounds.minLng !== out.bounds.maxLng)
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
