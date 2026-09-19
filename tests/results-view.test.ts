/**
 * Tests for results-view.ts — the results page's derived state.
 *
 * These pin the page's honesty rules: every way a user can arrive at the results
 * page gets an explicit status, exports are never offered without geometry, and
 * synthesized numbers are never presented as measurements.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  StatusInput, buildMetricGroups, contributingKeyframes, deriveReconstructionStatus, objectObservations,
} from '../src/app/droneviz3d/results-view'
import { ReconstructionMetrics } from '../src/app/droneviz3d/reconstruct'
import { ProjectedDetection, TrackedObject } from '../src/app/droneviz3d/grounding'

const METRICS: ReconstructionMetrics = {
  totalPoints: '12,142',
  accuracy: 'n/a (single pass)',
  processingTime: 'client-side demo',
  coverage: '85.7%',
  confidenceScore: '0.71',
  groundedObjects: '49',
  groundedLabels: 'building, vehicle',
  keyframesSampled: '24',
  provenance: 'Reconstructed from LocateAnything-3B detections + flight metadata (demo synthesis)',
}

function status(overrides: Partial<StatusInput> = {}) {
  return deriveReconstructionStatus({
    processingComplete: true, isProcessing: false, hasMetrics: true,
    pointCount: 12142, objectCount: 49, restoredFromSession: false,
    ...overrides,
  })
}

function hit(x: number, y: number, keyframeIndex: number, score = 0.9): ProjectedDetection {
  return { label: 'building', center: { x, y, z: 0 }, halfExtentX: 4, halfExtentY: 2, score, keyframeIndex, viewingAltitude: 120 }
}

function tracked(hits: ProjectedDetection[], center = { x: 0, y: 0, z: 0 }): TrackedObject {
  return {
    label: 'building', center, halfExtentX: 4, halfExtentY: 2, score: 0.9,
    observations: hits.length, hits, best: hits[0],
  }
}

// ---------- Status ----------

test('a fresh session is explicitly empty, not a failed run', () => {
  const s = status({ processingComplete: false, hasMetrics: false, pointCount: 0, objectCount: 0 })
  assert.equal(s.id, 'empty')
  assert.equal(s.canExport, false)
  assert.equal(s.tone, 'neutral')
})

test('a run still in progress is distinguished from a failed one', () => {
  const running = status({ processingComplete: false, isProcessing: true, hasMetrics: false, pointCount: 0 })
  assert.equal(running.id, 'running')
  assert.equal(running.canExport, false)

  const failed = status({ processingComplete: true, isProcessing: false, hasMetrics: false, pointCount: 0 })
  assert.equal(failed.id, 'incomplete')
  assert.equal(failed.tone, 'error')
  assert.equal(failed.canExport, false)
})

test('metrics without geometry are called out as a partial restore', () => {
  const s = status({ pointCount: 0, restoredFromSession: true })
  assert.equal(s.id, 'partial')
  assert.equal(s.tone, 'warning')
  assert.equal(s.canExport, false, 'nothing to export without a point cloud')
  assert.ok(s.detail.includes('session storage'))
})

test('a complete run says what it produced', () => {
  const s = status()
  assert.equal(s.id, 'complete')
  assert.equal(s.canExport, true)
  assert.ok(s.title.includes('12,142 points'))
  assert.ok(s.title.includes('49 grounded objects'))
  assert.ok(s.detail.includes('synthesized'), 'the synthesized part is stated on the page')
})

test('a restored session is labelled instead of passed off as a fresh run', () => {
  const s = status({ restoredFromSession: true })
  assert.equal(s.id, 'restored')
  assert.equal(s.canExport, true)
  assert.ok(s.title.startsWith('Restored from this session'))
  assert.ok(s.detail.includes('instead of recomputing'))
})

test('status titles handle a single object without pluralising badly', () => {
  const s = status({ objectCount: 1 })
  assert.ok(s.title.includes('1 grounded object'))
  assert.ok(!s.title.includes('1 grounded objects'))
})

// ---------- Metric grouping ----------

test('measured and estimated groups never overlap or duplicate a value', () => {
  const groups = buildMetricGroups({ metrics: METRICS, trackedObjects: [tracked([hit(0, 0, 0)])] })
  const measuredIds = groups.measured.map((m) => m.id)
  const estimatedIds = groups.estimated.map((m) => m.id)
  assert.equal(new Set([...measuredIds, ...estimatedIds]).size, measuredIds.length + estimatedIds.length)
  for (const entry of [...groups.measured, ...groups.estimated]) {
    assert.ok(entry.label.length > 0 && entry.value.length > 0 && entry.note.length > 0)
  }
})

test('observed counts are measured; synthesized geometry is estimated', () => {
  const groups = buildMetricGroups({ metrics: METRICS, trackedObjects: [tracked([hit(0, 0, 0)])] })
  const value = (id: string) => groups.measured.find((m) => m.id === id)?.value
  const estimated = (id: string) => groups.estimated.find((m) => m.id === id)?.value

  assert.equal(value('groundedObjects'), '49')
  assert.equal(value('sampledKeyframes'), '24')
  assert.equal(value('observations'), '1')

  assert.equal(estimated('totalPoints'), '12,142')
  assert.equal(estimated('confidence'), '0.71')
  assert.equal(estimated('coverage'), '85.7%')
  assert.equal(estimated('accuracy'), 'n/a (single pass)')
  assert.ok(groups.estimated.find((m) => m.id === 'accuracy')!.note.includes('no accuracy claim'))
})

test('a run with no detections reports observations honestly', () => {
  const groups = buildMetricGroups({ metrics: METRICS, trackedObjects: [] })
  assert.equal(groups.measured.find((m) => m.id === 'observations')?.value, 'n/a')
  assert.ok(groups.measured.find((m) => m.id === 'observations')!.note.includes('no detections'))
})

test('metrics missing from an older persisted session degrade instead of crashing', () => {
  const legacy = { ...METRICS, keyframesSampled: undefined } as unknown as ReconstructionMetrics
  const groups = buildMetricGroups({ metrics: legacy, trackedObjects: [] })
  assert.equal(groups.measured.find((m) => m.id === 'sampledKeyframes')?.value, 'n/a')
})

test('no metrics ⇒ no metric groups', () => {
  const groups = buildMetricGroups({ metrics: null, trackedObjects: [] })
  assert.deepEqual(groups, { measured: [], estimated: [] })
})

// ---------- Supporting observations ----------

test('objectObservations reports every supporting keyframe detection', () => {
  const observations = objectObservations(tracked([
    hit(0, 0, 0, 0.7), hit(3, 4, 2, 0.95), hit(0, 0, 5, 0.8),
  ], { x: 0, y: 0, z: 0 }))
  assert.equal(observations.length, 3)
  assert.deepEqual(observations.map((o) => o.keyframeIndex), [0, 2, 5])
  assert.deepEqual(observations.map((o) => o.score), [0.7, 0.95, 0.8])
  assert.equal(observations[0].offsetMeters, 0)
  assert.equal(observations[1].offsetMeters, 5, 'distance from the fused centre is reported')
  assert.equal(observations[2].halfExtentX, 4)
  assert.equal(observations[0].viewingAltitude, 120)
})

test('a restored object from an older session falls back to its best detection', () => {
  const legacy = { ...tracked([hit(0, 0, 7)]), hits: undefined } as unknown as TrackedObject
  const observations = objectObservations(legacy)
  assert.equal(observations.length, 1)
  assert.equal(observations[0].keyframeIndex, 7)
  assert.equal(contributingKeyframes([legacy]), 1)
})

test('contributingKeyframes counts distinct keyframes, not detections', () => {
  const a = tracked([hit(0, 0, 1), hit(0, 0, 1), hit(0, 0, 2)])
  const b = tracked([hit(50, 50, 2), hit(50, 50, 3)])
  assert.equal(contributingKeyframes([a, b]), 3)
  assert.equal(contributingKeyframes([]), 0)
})
