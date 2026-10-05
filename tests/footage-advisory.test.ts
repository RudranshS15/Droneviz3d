/**
 * The pipeline assumes a single downward flight pass. A phone clip breaks that
 * assumption silently: the run completes, the scene looks like a result, and
 * nothing in it says the input was a two-second portrait video.
 *
 * These tests pin the advisory rules to the two facts the browser actually
 * knows after loading metadata — frame size and duration — and, just as
 * importantly, pin what must *not* fire. A clip whose metadata has not loaded,
 * a landscape clip of normal length, and a duration of zero (unknown) must all
 * stay quiet: a warning that fires on unknown data is noise that teaches people
 * to ignore the real one.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { footageAdvisories, type FootageFacts } from '../src/app/droneviz3d/footage-advisory'

const facts = (partial: Partial<FootageFacts>): FootageFacts => ({
  durationSec: null, width: null, height: null, ...partial,
})

test('ordinary landscape drone footage produces no advisory', () => {
  assert.deepEqual(footageAdvisories(facts({ durationSec: 180, width: 3840, height: 2160 })), [])
})

test('unknown facts produce no advisory at all', () => {
  assert.deepEqual(footageAdvisories(facts({})), [])
  assert.deepEqual(footageAdvisories(facts({ durationSec: 0, width: 0, height: 0 })), [])
})

test('a portrait clip is named as portrait, with its frame size', () => {
  const [advisory, ...rest] = footageAdvisories(facts({ durationSec: 30, width: 474, height: 850 }))
  assert.equal(rest.length, 0)
  assert.equal(advisory.id, 'portrait')
  assert.match(advisory.message, /474×850/)
  assert.match(advisory.message, /landscape/)
})

test('a clip of a couple of seconds is named as too short, with its length', () => {
  const [advisory, ...rest] = footageAdvisories(facts({ durationSec: 2.03, width: 1920, height: 1080 }))
  assert.equal(rest.length, 0)
  assert.equal(advisory.id, 'short')
  assert.match(advisory.message, /2\.0 s/)
  assert.match(advisory.message, /baseline/)
})

test('a clip that is both portrait and short produces both advisories, portrait first', () => {
  const advisories = footageAdvisories(facts({ durationSec: 2.03, width: 474, height: 850 }))
  assert.deepEqual(advisories.map((a) => a.id), ['portrait', 'short'])
})

test('a square frame is not portrait', () => {
  assert.deepEqual(footageAdvisories(facts({ durationSec: 60, width: 1080, height: 1080 })), [])
})

test('a duration of exactly the short threshold is not short', () => {
  assert.deepEqual(footageAdvisories(facts({ durationSec: 3, width: 1920, height: 1080 })), [])
})
