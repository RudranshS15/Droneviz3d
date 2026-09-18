/**
 * Characterization tests for geometry.ts.
 *
 * These lock the frame convention the whole pipeline (and the 3D viewer) depends
 * on: local ENU — x = East, y = North, z = Up, in meters, origin at the
 * user-supplied GPS reference point. If a change flips or swaps an axis, these
 * must fail loudly rather than silently re-orienting every reconstruction.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ASSUMED_GIMBAL_PITCH, CameraModel, FlightParams, deg2rad,
  cameraFov, groundDistance, hashString, intersectGround, lngLatToLocal,
  localToLngLat, metersPerDegLng, mulberry32, poseAt, rayThroughImagePoint,
} from '../src/app/droneviz3d/geometry'

const FLIGHT: FlightParams = {
  gpsLat: 28.6139, gpsLng: 77.209, altitude: 120, speed: 10, heading: 0,
  durationSec: 100, rtkCorrections: false,
}

const CAM: CameraModel = { focal35: 24, frameWidth: 3840, frameHeight: 2160 }

// ---------- PRNG determinism ----------

test('mulberry32 is deterministic for a given seed', () => {
  const a = mulberry32(42)
  const b = mulberry32(42)
  const seqA = [a(), a(), a()]
  const seqB = [b(), b(), b()]
  assert.deepEqual(seqA, seqB)
  for (const v of seqA) assert.ok(v >= 0 && v < 1, 'values stay in [0,1)')
})

test('hashString returns a stable unsigned 32-bit value', () => {
  assert.equal(hashString('droneviz3d'), hashString('droneviz3d'))
  const h = hashString('a different string')
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff)
})

// ---------- Geodesy ----------

test('metersPerDegLng shrinks with latitude and is clamped near the poles', () => {
  assert.equal(metersPerDegLng(0), 111320)
  const at89 = metersPerDegLng(89)
  assert.ok(at89 > 1900 && at89 < 2000, `expected ~1942 at 89°, got ${at89}`)
  // cos(90°) === 0 would divide by zero; the 0.01 floor keeps it finite.
  assert.ok(Number.isFinite(metersPerDegLng(90)))
  assert.equal(metersPerDegLng(90), 111320 * 0.01)
})

test('lngLatToLocal maps North to +y and East to +x', () => {
  const origin = { lat: 28.6, lng: 77.2 }
  const north = lngLatToLocal(origin, { lat: 28.6 + 0.001, lng: 77.2 })
  assert.ok(Math.abs(north.x) < 1e-9)
  assert.ok(Math.abs(north.y - 111.32) < 1e-6)

  const east = lngLatToLocal(origin, { lat: 28.6, lng: 77.2 + 0.001 })
  assert.ok(east.x > 0)
  assert.ok(Math.abs(east.y) < 1e-9)
})

test('localToLngLat round-trips lngLatToLocal', () => {
  const origin = { lat: 28.6139, lng: 77.209 }
  const p = lngLatToLocal(origin, { lat: 28.6151, lng: 77.2104 })
  const back = localToLngLat(origin, p.x, p.y)
  assert.ok(Math.abs(back.lat - 28.6151) < 1e-9)
  assert.ok(Math.abs(back.lng - 77.2104) < 1e-9)
})

// ---------- Trajectory ----------

test('poseAt: heading 0 flies North (+y), heading 90 flies East (+x)', () => {
  const north = poseAt(FLIGHT, 1, 0)
  assert.ok(Math.abs(north.x) < 1e-9, 'heading 0 must not move East')
  assert.equal(north.y, 1000) // speed 10 m/s × 100 s
  assert.equal(north.z, 120)

  const east = poseAt({ ...FLIGHT, heading: 90 }, 1, 0)
  assert.ok(Math.abs(east.x - 1000) < 1e-6)
  assert.ok(Math.abs(east.y) < 1e-6)
})

test('poseAt carries yaw, gimbal pitch and timing', () => {
  const mid = poseAt(FLIGHT, 0.25, 7)
  assert.equal(mid.t, 0.25)
  assert.equal(mid.timeOffset, 25)
  assert.equal(mid.frameIndex, 7)
  assert.ok(Math.abs(mid.pitch - deg2rad(ASSUMED_GIMBAL_PITCH)) < 1e-12)
  assert.equal(mid.yaw, 0)
})

// ---------- Camera model ----------

test('cameraFov matches the 35mm full-frame pinhole model', () => {
  const { hfov, vfov } = cameraFov(CAM)
  assert.ok(Math.abs(hfov - 2 * Math.atan(36 / 48)) < 1e-12)
  assert.ok(Math.abs(vfov - 2 * Math.atan(24 / 48)) < 1e-12)
  assert.ok(hfov > vfov, 'landscape sensor ⇒ wider horizontal FOV')
})

test('cameraFov never divides by a zero focal length', () => {
  const { hfov } = cameraFov({ ...CAM, focal35: 0 })
  assert.ok(Number.isFinite(hfov))
})

test('rayThroughImagePoint: image centre is the camera forward axis', () => {
  const pose = poseAt(FLIGHT, 0, 0) // yaw 0, pitch -75°
  const dir = rayThroughImagePoint(pose, CAM, 0.5, 0.5)
  const cp = Math.cos(pose.pitch)
  assert.ok(Math.abs(dir.x) < 1e-12)
  assert.ok(Math.abs(dir.y - cp) < 1e-12)
  assert.ok(Math.abs(dir.z - Math.sin(pose.pitch)) < 1e-12)
  assert.ok(dir.z < 0, 'the centre ray points below the horizon')
})

test('rayThroughImagePoint: image right is East, image top tilts toward the horizon', () => {
  const pose = poseAt(FLIGHT, 0, 0)
  const centre = rayThroughImagePoint(pose, CAM, 0.5, 0.5)
  const right = rayThroughImagePoint(pose, CAM, 1, 0.5)
  const left = rayThroughImagePoint(pose, CAM, 0, 0.5)
  const top = rayThroughImagePoint(pose, CAM, 0.5, 0)

  assert.ok(right.x > 0.1, 'u = 1 must ray toward East')
  assert.ok(left.x < -0.1, 'u = 0 must ray toward West')
  assert.ok(top.z > centre.z, 'v = 0 (top row) is closer to the horizon')
  assert.ok(Math.abs(centre.x) < Math.abs(right.x))
})

test('ray directions are unit length', () => {
  const pose = poseAt(FLIGHT, 0.5, 3)
  for (const [u, v] of [[0, 0], [0, 1], [1, 0], [1, 1], [0.5, 0.5], [0.31, 0.72]]) {
    const d = rayThroughImagePoint(pose, CAM, u, v)
    assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-12)
  }
})

// ---------- Ground intersection ----------

test('intersectGround hits z = 0 for downward rays and rejects upward rays', () => {
  const hit = intersectGround({ x: 0, y: 0, z: 120 }, { x: 0, y: 0, z: -1 })
  assert.deepEqual(hit, { x: 0, y: 0, z: 0 })
  assert.equal(intersectGround({ x: 0, y: 0, z: 120 }, { x: 0, y: 1, z: 0 }), null)
  assert.equal(intersectGround({ x: 0, y: 0, z: 120 }, { x: 0, y: 0, z: 1 }), null)
})

test('a nadir-adjacent ray lands ahead of the camera, in the flight direction', () => {
  // Steep downward gimbal: the frame centre lands a short distance ahead.
  const pose = poseAt({ ...FLIGHT, rtkCorrections: true }, 0, 0)
  const dir = rayThroughImagePoint(pose, CAM, 0.5, 0.5)
  const hit = intersectGround({ x: pose.x, y: pose.y, z: pose.z }, dir)!
  assert.ok(Math.abs(hit.y - 32.15) < 0.05, `expected ~32.15 m North, got ${hit.y}`)
  assert.ok(Math.abs(hit.x) < 1e-9)
})

test('groundDistance ignores height differences', () => {
  assert.equal(groundDistance({ x: 0, y: 0, z: 5 }, { x: 3, y: 4, z: 99 }), 5)
})
