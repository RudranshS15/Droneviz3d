/**
 * Tests for viewer-camera.ts — the viewer's coordinate-orientation and framing
 * contract.
 *
 * The model is delivered in the local ENU frame (x = East, y = North, z = Up).
 * These tests assert that the camera honours that frame rather than re-mapping
 * axes, that the gizmo agrees with the projection, and that a framed model
 * actually fits on screen.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  Bounds3, DEFAULT_FOV_Y, MAX_DISTANCE, MIN_DISTANCE, OrbitCamera, Viewport, WORLD_UP,
  attenuatedSize, boundingSphere, boundsCorners, clampElevation, degToRad, fitDistance,
  fitDistanceToBounds, focalLengthPx, focusCamera, frameCamera, gizmoAxes, orbitDirection,
  pickNearestObject, projectDirection, projectPoint, radToDeg, viewBasis,
} from '../src/app/droneviz3d/viewer-camera'

const VIEWPORT: Viewport = { width: 900, height: 600 }

function cam(overrides: Partial<OrbitCamera> = {}): OrbitCamera {
  return {
    target: { x: 0, y: 0, z: 0 },
    azimuth: 0,
    elevation: degToRad(28),
    distance: 200,
    fovY: DEFAULT_FOV_Y,
    ...overrides,
  }
}

function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

// ---------- Orientation ----------

test('orbitDirection: azimuth 0 puts the camera South, 90 puts it East', () => {
  const south = orbitDirection(cam({ azimuth: 0 }))
  assert.ok(south.y < 0 && Math.abs(south.x) < 1e-12, 'camera sits South of the target')
  assert.ok(south.z > 0, 'camera sits above the target')

  const east = orbitDirection(cam({ azimuth: degToRad(90) }))
  assert.ok(east.x > 0 && Math.abs(east.y) < 1e-12)
})

test('viewBasis is orthonormal with world up = +z', () => {
  for (const azimuth of [0, 45, 90, 180, 270, -30]) {
    for (const elevation of [-80, -20, 0, 28, 70, 85]) {
      const basis = viewBasis(cam({ azimuth: degToRad(azimuth), elevation: degToRad(elevation) }))
      for (const v of [basis.forward, basis.right, basis.up]) {
        assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-12, 'unit length')
      }
      for (const [a, b] of [[basis.forward, basis.right], [basis.forward, basis.up], [basis.right, basis.up]]) {
        assert.ok(Math.abs(dot(a, b)) < 1e-12, 'mutually perpendicular')
      }
      if (elevation > 0) {
        assert.ok(basis.forward.z < 0, 'from above, forward points downward')
      }
    }
  }
})

test('the camera looks at the target and eye distance equals distance', () => {
  const c = cam({ target: { x: 12, y: -7, z: 3 }, distance: 150, azimuth: degToRad(35), elevation: degToRad(20) })
  const basis = viewBasis(c)
  const toTarget = { x: c.target.x - basis.eye.x, y: c.target.y - basis.eye.y, z: c.target.z - basis.eye.z }
  assert.ok(Math.abs(Math.hypot(toTarget.x, toTarget.y, toTarget.z) - 150) < 1e-9)
  assert.ok(Math.abs(dot(toTarget, basis.forward) - 150) < 1e-9, 'forward points straight at the target')
})

test('world up always projects to screen up, for any azimuth', () => {
  for (const azimuth of [0, 30, 90, 150, 180, 270, 330]) {
    const basis = viewBasis(cam({ azimuth: degToRad(azimuth) }))
    const up = projectDirection(basis, WORLD_UP)
    assert.ok(up.up > 0, `+z must have a positive screen-up component at azimuth ${azimuth}`)
    assert.ok(Math.abs(up.right) < 1e-12, `+z must not lean sideways at azimuth ${azimuth}`)
  }
})

test('at the default view, East is screen-right and North is away from the camera', () => {
  const c = cam()
  const basis = viewBasis(c)
  const east = projectDirection(basis, { x: 1, y: 0, z: 0 })
  const north = projectDirection(basis, { x: 0, y: 1, z: 0 })
  assert.ok(east.right > 0.9, 'East is to the right')
  assert.ok(Math.abs(east.up) < 1e-12)
  assert.ok(north.depth > 0, 'North points away from the camera')
  assert.ok(north.up > 0, 'the ground plane recedes upward on screen')
})

test('elevation is clamped short of the poles so the basis never degenerates', () => {
  assert.equal(clampElevation(degToRad(120)), degToRad(85))
  assert.equal(clampElevation(degToRad(-120)), degToRad(-85))
  assert.equal(clampElevation(Number.NaN), 0)
  const basis = viewBasis(cam({ elevation: degToRad(90) }))
  assert.ok(Math.hypot(basis.right.x, basis.right.y, basis.right.z) > 0.99)
  // At the top-down limit screen-up has rolled onto the ground plane (+North),
  // which is exactly what a z-up camera should do instead of gimbal-locking.
  assert.ok(basis.up.y > 0.9)
  assert.ok(Math.abs(basis.up.z) < 0.2)
})

// ---------- Projection ----------

test('the target projects to the centre of the viewport', () => {
  const c = cam({ target: { x: 5, y: 5, z: 5 } })
  const p = projectPoint(c, viewBasis(c), c.target, VIEWPORT)!
  assert.ok(Math.abs(p.x - VIEWPORT.width / 2) < 1e-9)
  assert.ok(Math.abs(p.y - VIEWPORT.height / 2) < 1e-9)
})

test('heights rise on screen and depth is measured along the view direction', () => {
  const c = cam()
  const basis = viewBasis(c)
  const high = projectPoint(c, basis, { x: 0, y: 0, z: 20 }, VIEWPORT)!
  const ground = projectPoint(c, basis, { x: 0, y: 0, z: 0 }, VIEWPORT)!
  assert.ok(high.y < ground.y, 'a point 20 m up must draw above the ground point')

  const atTarget = projectPoint(c, basis, c.target, VIEWPORT)!
  assert.ok(Math.abs(atTarget.depth - c.distance) < 1e-9, 'depth at the target equals the camera distance')
  const pushedAway = projectPoint(c, basis, {
    x: c.target.x + basis.forward.x * 50,
    y: c.target.y + basis.forward.y * 50,
    z: c.target.z + basis.forward.z * 50,
  }, VIEWPORT)!
  assert.ok(Math.abs(pushedAway.depth - (c.distance + 50)) < 1e-9)
  assert.ok(Math.abs(pushedAway.x - VIEWPORT.width / 2) < 1e-9, 'straight ahead stays centred')
})

test('points behind the near plane are culled instead of mirrored', () => {
  const c = cam()
  const basis = viewBasis(c)
  // Directly behind the eye relative to the view direction.
  const behind = { x: basis.eye.x - basis.forward.x * 10, y: basis.eye.y - basis.forward.y * 10, z: basis.eye.z - basis.forward.z * 10 }
  assert.equal(projectPoint(c, basis, behind, VIEWPORT), null)
})

test('projection is aspect aware: focal length follows viewport height', () => {
  const c = cam()
  const tall = focalLengthPx(c, { width: 400, height: 800 })
  const wide = focalLengthPx(c, { width: 1600, height: 400 })
  assert.ok(tall > wide)
  assert.equal(focalLengthPx(c, { width: 100, height: 600 }), focalLengthPx(c, { width: 900, height: 600 }))
})

// ---------- Bounds + framing ----------

test('boundingSphere covers every point when nothing is trimmed', () => {
  const points = [{ x: 1, y: 2, z: 3 }, { x: -4, y: 0, z: -1 }]
  const b = boundingSphere(points, 0)
  assert.deepEqual(b.min, { x: -4, y: 0, z: -1 })
  assert.deepEqual(b.max, { x: 1, y: 2, z: 3 })
  assert.deepEqual(b.center, { x: -1.5, y: 1, z: 1 })
})

test('boundingSphere ignores sparse far outliers when framing a big cloud', () => {
  const dense = []
  for (let i = 0; i < 4000; i++) {
    dense.push({ x: (i % 100) / 5 - 10, y: Math.floor(i / 100) / 5 - 10, z: 0 })
  }
  const track = Array.from({ length: 80 }, (_, i) => ({ x: 0, y: i * 20, z: 120 }))
  const framed = boundingSphere([...dense, ...track])
  assert.ok(Math.abs(framed.center.x) < 11 && Math.abs(framed.center.y) < 11)
  assert.ok(framed.radius < 30, `the far track markers must not blow up the frame (radius ${framed.radius})`)

  const raw = boundingSphere([...dense, ...track], 0)
  assert.ok(raw.radius > 700, 'without trimming the raw bounds span the whole track')
})

test('boundingSphere does not trim small clouds', () => {
  const few = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 500, z: 0 }, { x: 1, y: 1, z: 1 }]
  const b = boundingSphere(few)
  assert.ok(b.radius > 200, 'a three-point cloud keeps all of its points')
})

test('fitDistance grows with radius and with a narrower field of view', () => {
  const base = fitDistance(10, DEFAULT_FOV_Y, 1.5)
  assert.ok(fitDistance(20, DEFAULT_FOV_Y, 1.5) > base)
  assert.ok(fitDistance(10, degToRad(30), 1.5) > base)
  assert.ok(fitDistance(10, DEFAULT_FOV_Y, 0.5) > base, 'a portrait viewport needs more distance')
  assert.equal(fitDistance(0, DEFAULT_FOV_Y, 1.5), fitDistance(0.5, DEFAULT_FOV_Y, 1.5))
  assert.ok(fitDistance(1e9, DEFAULT_FOV_Y, 1) <= MAX_DISTANCE)
  assert.ok(fitDistance(0, DEFAULT_FOV_Y, 1) >= MIN_DISTANCE)
})

test('frameCamera frames the whole bounding sphere inside the viewport', () => {
  for (const viewport of [VIEWPORT, { width: 380, height: 620 }, { width: 1600, height: 500 }]) {
    const bounds: Bounds3 = { min: { x: -160, y: -160, z: 0 }, max: { x: 160, y: 160, z: 120 }, center: { x: 0, y: 0, z: 60 }, radius: 0 }
    bounds.radius = Math.hypot(320, 320, 120) / 2
    const c = frameCamera(bounds, viewport)
    const basis = viewBasis(c)
    assert.deepEqual(c.target, bounds.center)
    assert.equal(c.azimuth, 0)
    assert.ok(Math.abs(radToDeg(c.elevation) - 28) < 1e-9)

    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const p = projectPoint(c, basis, { x, y, z }, viewport)
          assert.ok(p, 'every corner is in front of the camera')
          assert.ok(p.x >= 0 && p.x <= viewport.width, `corner ${x},${y},${z} inside width (x=${p.x})`)
          assert.ok(p.y >= 0 && p.y <= viewport.height, `corner ${x},${y},${z} inside height (y=${p.y})`)
        }
      }
    }
  }
})

test('frameCamera fits the model box tightly, not just its bounding sphere', () => {
  // A wide, flat footprint like a real reconstruction: the sphere is far larger
  // than the model on screen, so a sphere-only fit would leave it small.
  const bounds: Bounds3 = {
    min: { x: -160, y: -160, z: 0 }, max: { x: 160, y: 160, z: 20 },
    center: { x: 0, y: 0, z: 10 }, radius: Math.hypot(320, 320, 20) / 2,
  }
  const viewport = { width: 1280, height: 720 }
  const camera = frameCamera(bounds, viewport)
  const sphereFit = fitDistance(bounds.radius, camera.fovY, viewport.width / viewport.height)
  assert.ok(camera.distance < sphereFit, 'the box fit is tighter than the sphere fit')

  const basis = viewBasis(camera)
  const halfW = viewport.width / 2
  const halfH = viewport.height / 2
  let worst = 0
  for (const corner of boundsCorners(bounds)) {
    const p = projectPoint(camera, basis, corner, viewport)
    assert.ok(p, 'every corner stays in front of the camera')
    assert.ok(p.x >= 0 && p.x <= viewport.width && p.y >= 0 && p.y <= viewport.height, 'and inside the viewport')
    worst = Math.max(worst, Math.abs(p.x - halfW) / halfW, Math.abs(p.y - halfH) / halfH)
  }
  // "Properly framed": the binding axis is nearly filled (margin 1.08 ⇒ ~0.93).
  assert.ok(worst > 0.85, `the model should fill the frame, worst extent ratio = ${worst.toFixed(3)}`)
})

test('fitDistanceToBounds stays finite and sane for degenerate bounds', () => {
  const single: Bounds3 = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, center: { x: 0, y: 0, z: 0 }, radius: 0 }
  const camera = cam()
  const distance = fitDistanceToBounds(single, camera, VIEWPORT)
  assert.ok(Number.isFinite(distance) && distance >= MIN_DISTANCE && distance <= MAX_DISTANCE)
})

test('focusCamera retargets without changing the viewing direction', () => {
  const start = frameCamera(
    { min: { x: -100, y: -100, z: 0 }, max: { x: 100, y: 100, z: 80 }, center: { x: 0, y: 0, z: 40 }, radius: 140 },
    VIEWPORT, DEFAULT_FOV_Y, degToRad(35), degToRad(40)
  )
  const target = { x: 12, y: 30, z: 0 }
  const focused = focusCamera(start, target, 6, VIEWPORT)
  assert.deepEqual(focused.target, target)
  assert.equal(focused.azimuth, start.azimuth)
  assert.equal(focused.elevation, start.elevation)
  assert.equal(focused.fovY, start.fovY)
  assert.ok(focused.distance < start.distance, 'zooming onto a small object moves the camera in')

  const before = orbitDirection(start)
  const after = orbitDirection(focused)
  assert.ok(Math.abs(before.x - after.x) < 1e-12 && Math.abs(before.y - after.y) < 1e-12)
})

test('a focused object fits inside the viewport', () => {
  const focused = focusCamera(cam(), { x: 5, y: 5, z: 0 }, 4, VIEWPORT)
  const basis = viewBasis(focused)
  for (const x of [1, 9]) {
    for (const y of [1, 9]) {
      const p = projectPoint(focused, basis, { x, y, z: 0 }, VIEWPORT)!
      assert.ok(p.x > 0 && p.x < VIEWPORT.width && p.y > 0 && p.y < VIEWPORT.height)
    }
  }
})

// ---------- Gizmo ----------

test('gizmoAxes exposes E/N/U and always draws Up as screen-up', () => {
  for (const azimuth of [0, 90, 180, 270, 45]) {
    const axes = gizmoAxes(viewBasis(cam({ azimuth: degToRad(azimuth) })), 24)
    assert.deepEqual([...axes].map((a) => a.key).sort(), ['E', 'N', 'U'])
    const up = axes.find((a) => a.key === 'U')!
    assert.ok(up.dy < 0, 'the Up axis points up the screen')
    assert.ok(Math.abs(up.dx) < 1e-9, 'and never leans sideways')
    // The Up axis is foreshortened by exactly cos(elevation) in a 28° view.
    assert.ok(Math.abs(Math.hypot(up.dx, up.dy) - 24 * Math.cos(degToRad(28))) < 1e-9)
  }
})

test('gizmoAxes rotates with the camera: East swings across as azimuth advances', () => {
  const eastAxisAt = (azimuthDeg: number) =>
    gizmoAxes(viewBasis(cam({ azimuth: degToRad(azimuthDeg) })), 24).find((a) => a.key === 'E')!

  const south = eastAxisAt(0)
  const east = eastAxisAt(90)
  const north = eastAxisAt(180)
  const west = eastAxisAt(270)

  assert.ok(south.dx > 20 && Math.abs(south.dy) < 1e-9, 'from the South, East is to the right')
  assert.ok(north.dx < -20, 'from the North, East flips to the left')
  // Viewed from the East/West, the East axis points at/away from the viewer and
  // therefore foreshortens into a short vertical stub.
  assert.ok(Math.hypot(east.dx, east.dy) < 12, 'East foreshortens when viewed end-on')
  assert.ok(Math.hypot(west.dx, west.dy) < 12)
  assert.ok(east.depth < south.depth, 'when viewed from the East, East points toward the camera')
})

test('gizmoAxes are ordered far-to-near so nearer axes paint last', () => {
  const axes = gizmoAxes(viewBasis(cam({ azimuth: degToRad(30), elevation: degToRad(35) })), 24)
  for (let i = 1; i < axes.length; i++) {
    assert.ok(axes[i].depth <= axes[i - 1].depth, 'sorted by descending depth')
  }
})

test('looking straight down, the gizmo still shows East and North flat on screen', () => {
  const axes = gizmoAxes(viewBasis(cam({ elevation: degToRad(85) })), 24)
  const up = axes.find((a) => a.key === 'U')!
  const east = axes.find((a) => a.key === 'E')!
  const north = axes.find((a) => a.key === 'N')!
  assert.ok(Math.hypot(up.dx, up.dy) < 3, 'Up collapses to a point from directly above')
  assert.ok(Math.abs(Math.hypot(east.dx, east.dy) - 24) < 0.2)
  assert.ok(Math.abs(Math.hypot(north.dx, north.dy) - 24) < 0.2)
  assert.ok(east.dx > 20, 'East is right in the top-down view')
  assert.ok(north.dy < -20, 'North is up in the top-down view')
})

// ---------- Picking + point size ----------

test('pickNearestObject returns the closest marker within the pixel radius', () => {
  const markers = [{ index: 0, x: 100, y: 100 }, { index: 1, x: 112, y: 100 }, { index: 2, x: 400, y: 400 }]
  assert.equal(pickNearestObject(markers, 101, 101), 0)
  assert.equal(pickNearestObject(markers, 113, 101), 1)
  assert.equal(pickNearestObject(markers, 300, 300), null)
  assert.equal(pickNearestObject([], 0, 0), null)
})

test('attenuatedSize keeps the chosen size at the reference depth and stays bounded', () => {
  assert.equal(attenuatedSize(3, 100, 100), 3)
  assert.ok(attenuatedSize(3, 1000, 100) < 3)
  assert.ok(attenuatedSize(3, 10, 100) > 3)
  assert.ok(attenuatedSize(3, 1e9, 100) >= 0.6)
  assert.ok(attenuatedSize(3, 1, 100) <= 3 * 2.5)
  assert.ok(attenuatedSize(-5, 100, 100) >= 0.5)
})
