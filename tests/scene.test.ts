/**
 * Tests for scene.ts — the pipeline → renderer seam.
 *
 * The viewer draws in the local ENU frame, but the stored flight path is
 * georeferenced, so the conversion back to metres is where a sign error would
 * silently draw the drone kilometres away from the model.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildSceneModel, boundsIncludingNearPath, parseOrigin } from '../src/app/droneviz3d/scene'
import { TRAJECTORY_RGB, Point3D, ReconstructionPose } from '../src/app/droneviz3d/reconstruct'
import { Bounds3 } from '../src/app/droneviz3d/viewer-camera'
import { TrackedObject } from '../src/app/droneviz3d/grounding'

const ORIGIN = { gpsLat: '28.6139', gpsLng: '77.2090' }

function point(x: number, y: number, z: number, rgb: { r: number; g: number; b: number } = { r: 120, g: 120, b: 120 }): Point3D {
  return { x, y, z, ...rgb, confidence: 0.7 }
}

function trackMarker(x: number, y: number, z: number): Point3D {
  return point(x, y, z, TRAJECTORY_RGB)
}

function pose(lat: number, lng: number, altitude: number): ReconstructionPose {
  return { lat, lng, altitude, pitch: -75, yaw: 0, timeOffset: 0, frameIndex: 0 }
}

function object(x: number, y: number, observations = 1): TrackedObject {
  const hit = {
    label: 'building', center: { x, y, z: 0 }, halfExtentX: 4, halfExtentY: 3,
    score: 0.9, keyframeIndex: 0, viewingAltitude: 120,
  }
  return {
    label: 'building', center: { x, y, z: 0 }, halfExtentX: 4, halfExtentY: 3,
    score: 0.9, observations, hits: [hit], best: hit,
  }
}

test('parseOrigin rejects unusable metadata instead of producing NaN frames', () => {
  assert.deepEqual(parseOrigin(ORIGIN), { lat: 28.6139, lng: 77.209 })
  assert.equal(parseOrigin({ gpsLat: '', gpsLng: '77.2' }), null)
  assert.equal(parseOrigin({ gpsLat: 'abc', gpsLng: '77.2' }), null)
  assert.equal(parseOrigin({ gpsLat: '91', gpsLng: '77.2' }), null)
  assert.equal(parseOrigin({ gpsLat: '28.6', gpsLng: '181' }), null)
})

test('drone-track markers are split out of the point cloud', () => {
  const scene = buildSceneModel({
    pointCloud: [point(1, 1, 0), trackMarker(0, 500, 120), point(2, 2, 0)],
    trajectory: [],
    trackedObjects: [],
    metadata: ORIGIN,
  })
  assert.equal(scene.points.length, 2)
  assert.equal(scene.trackMarkers.length, 1)
  assert.ok(scene.points.every((p) => !(p.r === TRAJECTORY_RGB.r && p.g === TRAJECTORY_RGB.g)))
})

test('the georeferenced flight path converts back to the model frame', () => {
  const scene = buildSceneModel({
    pointCloud: [point(0, 0, 0)],
    trajectory: [pose(28.6139, 77.209, 120), pose(28.6151, 77.209, 118)],
    trackedObjects: [],
    metadata: ORIGIN,
  })
  assert.equal(scene.trajectoryPath.length, 2)
  assert.ok(Math.abs(scene.trajectoryPath[0].x) < 1e-6)
  assert.ok(Math.abs(scene.trajectoryPath[0].y) < 1e-6)
  assert.equal(scene.trajectoryPath[0].z, 120)
  // 0.0012° of latitude is ~134 m North, and lng unchanged ⇒ no East drift.
  assert.ok(Math.abs(scene.trajectoryPath[1].y - 133.58) < 0.05)
  assert.ok(Math.abs(scene.trajectoryPath[1].x) < 1e-6)
  assert.equal(scene.trajectoryPath[1].z, 118)
})

test('without a usable origin the path falls back to the stored markers', () => {
  const scene = buildSceneModel({
    pointCloud: [point(1, 1, 0), trackMarker(5, 5, 120)],
    trajectory: [pose(28.6139, 77.209, 120)],
    trackedObjects: [],
    metadata: { gpsLat: 'nope', gpsLng: 'nope' },
  })
  assert.equal(scene.origin, null)
  assert.deepEqual(scene.trajectoryPath, [{ x: 5, y: 5, z: 120 }])
})

test('framing bounds ignore the far end of a long flight leg', () => {
  const cloud: Point3D[] = []
  for (let i = 0; i < 1200; i++) cloud.push(point((i % 40) - 20, Math.floor(i / 40) - 15, 0))
  for (let i = 0; i < 61; i++) cloud.push(trackMarker(0, i * 24, 120))

  const scene = buildSceneModel({ pointCloud: cloud, trajectory: [], trackedObjects: [], metadata: ORIGIN })
  assert.ok(scene.bounds.radius < 40, `the flight leg must not drive framing (radius ${scene.bounds.radius})`)
  assert.ok(Math.abs(scene.bounds.center.x) < 25 && Math.abs(scene.bounds.center.y) < 25)
})

test('object centres are inside the framing bounds even when sparse', () => {
  const scene = buildSceneModel({
    pointCloud: [point(0, 0, 0), point(1, 1, 0)],
    trajectory: [],
    trackedObjects: [object(60, 60), object(-50, 20)],
    metadata: ORIGIN,
  })
  assert.ok(scene.bounds.max.x >= 60 && scene.bounds.min.x <= -50)
})

test('path bounds include the overflight but not a whole flight leg', () => {
  const model = { min: { x: -40, y: -40, z: 0 }, max: { x: 40, y: 40, z: 10 }, center: { x: 0, y: 0, z: 5 }, radius: Math.hypot(80, 80, 10) / 2 }
  const path = [
    { x: 0, y: 0, z: 120 },      // overhead
    { x: 0, y: 40, z: 120 },     // nearby
    { x: 0, y: 900, z: 120 },    // far down the leg
    { x: 0, y: 1400, z: 120 },   // end of the leg
  ]
  const framed = boundsIncludingNearPath(model, path)
  assert.ok(framed.max.z >= 120, 'the flight altitude is inside the path view')
  assert.ok(framed.max.y < 120, 'the far end of the leg is left out so the model stays visible')
  assert.ok(framed.min.x <= -40 && framed.max.x >= 40, 'the model is still framed in full')
  assert.ok(boundsIncludingNearPath(model, []).radius === model.radius, 'no path means no change')
})

const FLAT: Bounds3 = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, center: { x: 0, y: 0, z: 0 }, radius: 0 }

test('path bounds ignore a path when the model has no extent', () => {
  const framed = boundsIncludingNearPath(FLAT, [{ x: 0, y: 0, z: 100 }])
  assert.equal(framed.radius, 0)
})

test('an empty model reports itself as empty', () => {
  const scene = buildSceneModel({
    pointCloud: [], trajectory: [], trackedObjects: [], metadata: ORIGIN,
  })
  assert.equal(scene.empty, true)
  assert.equal(scene.bounds.radius, 0)
  assert.deepEqual(scene.points, [])
})

test('a model with only track markers is not treated as empty', () => {
  const scene = buildSceneModel({
    pointCloud: [trackMarker(0, 0, 120)], trajectory: [], trackedObjects: [], metadata: ORIGIN,
  })
  assert.equal(scene.empty, false)
  assert.equal(scene.points.length, 0)
  assert.equal(scene.trackMarkers.length, 1)
})
