/**
 * Characterization tests for exporter.ts.
 *
 * These pin the on-disk conventions, including a real inconsistency worth
 * knowing about: PLY and CSV are written in the internal ENU frame (x = East,
 * y = North, z = Up), while OBJ is written Y-up (x, z, −y) for conventional
 * mesh viewers. Reconstructing from an export must therefore always use the
 * CSV/PLY variants, which carry the ENU frame explicitly.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ExportPayload, toGeoCsv, toObj, toPly } from '../src/app/droneviz3d/exporter'
import { Point3D, ReconstructionMetrics } from '../src/app/droneviz3d/reconstruct'

const POINTS: Point3D[] = [
  { x: 1, y: 2, z: 3, r: 10, g: 20, b: 30, confidence: 0.75 },
  { x: -4.5, y: 0, z: 12.25, r: 255, g: 0, b: 128, confidence: 0.5 },
]

const METRICS: ReconstructionMetrics = {
  totalPoints: '2', accuracy: 'n/a (single pass)', processingTime: 'client-side demo',
  coverage: '80.0%', confidenceScore: '0.63', groundedObjects: '1',
  groundedLabels: 'building', keyframesSampled: '24', provenance: 'test',
}

function payload(origin: { lat: number; lng: number } | null): ExportPayload {
  return { points: POINTS, trajectory: [], metrics: METRICS, bounds: null, origin }
}

test('PLY declares one vertex per point with colour + confidence', async () => {
  const text = await toPly(payload(null)).text()
  const lines = text.split('\n')
  assert.equal(lines[0], 'ply')
  assert.equal(lines[1], 'format ascii 1.0')
  assert.ok(lines.includes('element vertex 2'))
  assert.ok(lines.includes('property float confidence'))
  assert.equal(lines[lines.length - 2], '1.000 2.000 3.000 10 20 30 0.750')
  const vertexRows = lines.filter((l) => /^-?\d/.test(l))
  assert.equal(vertexRows.length, POINTS.length)
})

test('OBJ converts ENU to Y-up (x, z, −y) for mesh viewers', async () => {
  const text = await toObj(payload(null)).text()
  const vertices = text.split('\n').filter((l) => l.startsWith('v '))
  assert.equal(vertices.length, POINTS.length)
  assert.equal(vertices[0], 'v 1.000 3.000 -2.000 10 20 30')
  assert.ok(text.includes('x=East, y=North, z=Up'), 'the frame convention is documented in the file')
})

test('georeferenced CSV round-trips local ENU back to WGS84', async () => {
  const origin = { lat: 28.6139, lng: 77.209 }
  const text = await toGeoCsv(payload(origin)).text()
  const rows = text.trim().split('\n')
  assert.equal(rows[0], 'lat,lng,altitude_m,east_m,north_m,label_confidence,r,g,b')
  assert.equal(rows.length, POINTS.length + 1)

  const [lat0, lng0, alt0, east0, north0] = rows[1].split(',')
  assert.equal(Number(east0), 1)
  assert.equal(Number(north0), 2)
  assert.equal(Number(alt0), 3)
  // CSV rounds to 8 decimal places, so compare against the same rounding.
  assert.equal(lat0, (origin.lat + 2 / 111320).toFixed(8))
  assert.equal(lng0, (origin.lng + 1 / (111320 * Math.cos((origin.lat * Math.PI) / 180))).toFixed(8))
})

test('CSV without an origin fails loudly instead of writing a wrong frame', async () => {
  const text = await toGeoCsv(payload(null)).text()
  assert.equal(text, 'error,no origin\n')
})
