/**
 * Tests for confidence.ts — the single scale shared by the viewer's point
 * colours and the results page's chart, so the two can never disagree.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CONFIDENCE_BANDS, bandFor, confidenceColor, countByBand } from '../src/app/droneviz3d/confidence'

test('bands are contiguous and cover 0..1 with no gaps', () => {
  // Bands are listed strongest first, so each band's upper bound is the
  // previous band's lower bound.
  assert.equal(CONFIDENCE_BANDS[0].maxExclusive, Infinity)
  assert.equal(CONFIDENCE_BANDS[CONFIDENCE_BANDS.length - 1].min, 0)
  for (let i = 1; i < CONFIDENCE_BANDS.length; i++) {
    assert.equal(CONFIDENCE_BANDS[i].maxExclusive, CONFIDENCE_BANDS[i - 1].min)
  }
  for (const band of CONFIDENCE_BANDS) {
    assert.ok(band.min < band.maxExclusive)
    assert.ok(band.description.length > 0)
    assert.ok(band.barClass.startsWith('bg-'))
    assert.ok(band.textClass.startsWith('text-'))
  }
})

test('bandFor maps the documented thresholds', () => {
  assert.equal(bandFor(1).id, 'high')
  assert.equal(bandFor(0.8).id, 'high')
  assert.equal(bandFor(0.7999).id, 'medium')
  assert.equal(bandFor(0.5).id, 'medium')
  assert.equal(bandFor(0.4999).id, 'low')
  assert.equal(bandFor(0).id, 'low')
  assert.equal(bandFor(Number.NaN).id, 'low', 'unusable values fall to the weakest band')
  assert.equal(bandFor(-3).id, 'low', 'out-of-range values are clamped, not crashed')
  assert.equal(bandFor(42).id, 'high')
})

test('confidenceColor uses the band colour and rises in alpha with confidence', () => {
  const high = confidenceColor(0.95)
  const low = confidenceColor(0.1)
  assert.ok(high.startsWith('rgba(34, 211, 238'))
  assert.ok(low.startsWith('rgba(248, 113, 113'))
  const alphaOf = (s: string) => Number(s.slice(s.lastIndexOf(' ') + 1, -1))
  assert.ok(alphaOf(high) > alphaOf(low))
  assert.ok(alphaOf(confidenceColor(0.5)) > alphaOf(confidenceColor(0.3)))
})

test('confidenceColor clamps alpha into a usable range', () => {
  const alphaOf = (s: string) => Number(s.slice(s.lastIndexOf(' ') + 1, -1))
  assert.ok(alphaOf(confidenceColor(0)) >= 0.15)
  assert.ok(alphaOf(confidenceColor(1)) <= 0.95)
  assert.ok(Number.isFinite(alphaOf(confidenceColor(Number.NaN))))
})

test('countByBand counts every value exactly once and reports shares', () => {
  const counts = countByBand([0.9, 0.85, 0.6, 0.2])
  assert.deepEqual(counts.map((c) => c.count), [2, 1, 1])
  assert.equal(counts.reduce((s, c) => s + c.share, 0), 1)
  assert.equal(counts[0].share, 0.5)
})

test('countByBand handles an empty series without dividing by zero', () => {
  const counts = countByBand([])
  assert.deepEqual(counts.map((c) => c.count), [0, 0, 0])
  assert.deepEqual(counts.map((c) => c.share), [0, 0, 0])
})
