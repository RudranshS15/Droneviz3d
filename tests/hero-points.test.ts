/**
 * Characterization tests for hero-points.ts.
 *
 * These lock the two properties the landing hero depends on: determinism — the
 * server render and hydration must paint the same field, so the same seed has to
 * produce identical points — and finiteness, because one NaN here is a blank
 * canvas rather than an error anybody sees.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  HERO_FIELD_SIZE, buildHeroField, heroFieldSize, heroPhases, pointMaterial, projectField, surfaceHeight,
} from '../src/app/droneviz3d/hero-points'

const VIEW = { yaw: 0.4, tilt: 0.42, scale: 900, distance: 2.6 }

test('the field is deterministic — the same seed paints the same points', () => {
  assert.deepEqual(buildHeroField(64, 7), buildHeroField(64, 7))
})

test('different seeds give different fields', () => {
  assert.notDeepEqual(buildHeroField(64, 1), buildHeroField(64, 2))
})

test('the field honours the requested size, and defaults to HERO_FIELD_SIZE', () => {
  assert.equal(buildHeroField(10, 3).length, 10)
  assert.equal(buildHeroField(0, 3).length, 0)
  assert.equal(buildHeroField().length, HERO_FIELD_SIZE)
})

test('heroFieldSize scales with area and stays clamped', () => {
  assert.equal(heroFieldSize(0, 0), 350, 'a degenerate canvas still asks for the minimum field')
  assert.ok(heroFieldSize(400, 800) < heroFieldSize(1600, 900), 'more area means more dots')
  for (const [w, h] of [[320, 480], [768, 900], [1920, 1080], [3840, 2160]]) {
    const count = heroFieldSize(w, h)
    assert.ok(Number.isInteger(count) && count >= 350 && count <= 2200, `bad count ${count} for ${w}x${h}`)
  }
})

test('every point stays inside the unit disc and the surface bounds', () => {
  for (const point of buildHeroField(500, 11)) {
    assert.ok(Math.hypot(point.x, point.z) <= 1 + 1e-9, `outside the disc: ${point.x}, ${point.z}`)
    assert.ok(point.y >= 0 && point.y <= 1, `height out of bounds: ${point.y}`)
    assert.ok(point.tone >= 0 && point.tone < 1, `tone out of bounds: ${point.tone}`)
  }
})

test('surfaceHeight is deterministic, bounded and phase-dependent', () => {
  const phases = heroPhases(42)
  assert.deepEqual(heroPhases(42), phases)
  for (let x = -1; x <= 1; x += 0.25) {
    for (let z = -1; z <= 1; z += 0.25) {
      const height = surfaceHeight(x, z, phases)
      assert.ok(Number.isFinite(height) && height >= 0 && height <= 1, `bad height ${height} at ${x},${z}`)
      assert.equal(height, surfaceHeight(x, z, phases), 'same phases must give the same height')
    }
  }
  assert.notEqual(surfaceHeight(0.3, -0.2, phases), surfaceHeight(0.3, -0.2, heroPhases(43)))
})

test('projection is finite for every yaw and tilt the painter can request', () => {
  const field = buildHeroField(200, 5)
  for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 8) {
    for (const tilt of [-1.2, -0.5, 0, 0.42, 0.9, 1.4]) {
      const projected = projectField(field, { ...VIEW, yaw, tilt })
      assert.equal(projected.length, field.length)
      for (const point of projected) {
        assert.ok(
          Number.isFinite(point.x) && Number.isFinite(point.y),
          `non-finite position at yaw ${yaw}, tilt ${tilt}`
        )
        assert.ok(Number.isFinite(point.depth) && point.depth > 0, `bad depth ${point.depth}`)
        assert.ok(point.fade >= 0 && point.fade <= 1, `fade out of bounds: ${point.fade}`)
      }
    }
  }
})

test('fade normalises across the projection — nearest 1, farthest 0, deterministic', () => {
  const field = buildHeroField(300, 9)
  const projected = projectField(field, VIEW)
  const depths = projected.map((point) => point.depth)
  const fades = projected.map((point) => point.fade)
  assert.equal(Math.max(...fades), 1, 'the nearest point must be fully opaque')
  assert.equal(Math.min(...fades), 0, 'the farthest point must be fully faded')
  assert.equal(fades[depths.indexOf(Math.min(...depths))], 1, 'fade must track depth')
  assert.deepEqual(projected, projectField(field, VIEW))
})

test('pointMaterial keeps accents sparse and only names known tokens', () => {
  const counts = { chalk: 0, stone: 0, amber: 0, copper: 0 }
  for (let i = 0; i < 1000; i += 1) counts[pointMaterial(i / 1000)] += 1
  assert.ok(counts.copper < 100, 'copper is an accent, not a base material')
  assert.ok(counts.amber < 200, 'amber is an accent, not a base material')
  assert.ok(counts.chalk + counts.stone > 700, 'the field should read as mostly neutral')
})
