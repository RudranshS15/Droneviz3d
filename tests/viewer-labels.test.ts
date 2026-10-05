/**
 * Tests for viewer-labels.ts — the label rationing pass, moved out of the old
 * canvas renderer when the viewer became three.js.
 *
 * The drawing changed; this behaviour did not. A drone pass grounds dozens of
 * objects into a small part of the frame, so labels are placed by legibility:
 * the selected one always, then by score, never overlapping, never more than the
 * cap. These are the same assertions the canvas-renderer suite made, against the
 * module that now owns the decision.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  LABEL_HEIGHT, MAX_LABELS, declutterLabels, labelBox, labelWidth,
  type LabelPlacement,
} from '../src/app/droneviz3d/viewer-labels'

test('declutterLabels drops collisions and prefers the higher score', () => {
  const placements: LabelPlacement[] = [
    { index: 0, x: 100, y: 100, text: 'weak 50%', score: 0.5, selected: false },
    { index: 1, x: 104, y: 101, text: 'strong 95%', score: 0.95, selected: false },
    { index: 2, x: 400, y: 300, text: 'apart 70%', score: 0.7, selected: false },
  ]
  assert.deepEqual(declutterLabels(placements).map((p) => p.index), [1, 2])
})

test('the selected label outranks a higher score, and the cap is enforced', () => {
  const selected: LabelPlacement[] = [
    { index: 0, x: 100, y: 100, text: 'winner 99%', score: 0.99, selected: false },
    { index: 1, x: 100, y: 100, text: 'picked 40%', score: 0.4, selected: true },
  ]
  assert.deepEqual(declutterLabels(selected).map((p) => p.index), [1])

  const many: LabelPlacement[] = Array.from({ length: 40 }, (_, i) => ({
    index: i, x: (i % 8) * 400, y: Math.floor(i / 8) * 300, text: `o${i} 90%`, score: 0.9, selected: false,
  }))
  assert.equal(declutterLabels(many).length, MAX_LABELS)
  assert.equal(declutterLabels(many, 3).length, 3)
})

test('labelBox reserves more room for longer text', () => {
  const short = labelBox({ x: 0, y: 0, text: 'a' })
  const long = labelBox({ x: 0, y: 0, text: 'a much longer label' })
  assert.equal(long.minX, short.minX)
  assert.ok(long.maxX > short.maxX)
  assert.equal(long.maxY - long.minY, LABEL_HEIGHT)
})

test('accepted placements come back in scene order, not score order', () => {
  const placements: LabelPlacement[] = [
    { index: 5, x: 0, y: 0, text: 'low 10%', score: 0.1, selected: false },
    { index: 2, x: 400, y: 0, text: 'high 90%', score: 0.9, selected: false },
    { index: 9, x: 0, y: 400, text: 'mid 50%', score: 0.5, selected: false },
  ]
  assert.deepEqual(declutterLabels(placements).map((p) => p.index), [2, 5, 9])
})

test('labelWidth is monotonic in the text length', () => {
  assert.ok(labelWidth('building 90%') > labelWidth('tree 90%'))
  assert.ok(labelWidth('') === 0)
})
