/**
 * The grounding classes used to be three literals inside the pipeline runner, so
 * "look for something else" was a code change. They are now a form field, and
 * this file holds the rules that make that field safe: what the typed text means,
 * when a run must refuse to start, and what survives a reload.
 *
 * The store-level tests matter most. The parser can be perfect and still be
 * bypassed — `runSimulatedDemo` reaches the runner without going through
 * `validateAndStart` — so one test drives a real run with a custom list and one
 * drives the validation path that rejects a bad one.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { DroneVizState } from '../src/app/droneviz3d/store'
import {
  DEFAULT_LABEL_VOCABULARY, MAX_LABEL_LENGTH, MAX_VOCABULARY_LABELS,
  defaultVocabularyInput, parseLabelVocabulary,
} from '../src/app/droneviz3d/label-vocabulary'

// ---------- Harness (same shape as the other store-level tests) ----------

interface FakeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function fakeStorage(seed?: string): FakeStorage {
  const data = new Map<string, string>()
  if (seed !== undefined) data.set('droneviz3d-model', seed)
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, String(value)) },
    removeItem: (key) => { data.delete(key) },
  }
}

interface StoreLike {
  getState(): DroneVizState
  setState(partial: Partial<DroneVizState>): void
}

function loadStore(storage: FakeStorage = fakeStorage()): StoreLike {
  const globalWithWindow = globalThis as unknown as { window?: unknown }
  globalWithWindow.window = { localStorage: storage }
  const id = require.resolve('../src/app/droneviz3d/store')
  delete require.cache[id]
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(id).useDroneVizStore as StoreLike
}

const METADATA = {
  gpsLat: '28.6139', gpsLng: '77.2090', altitude: '120', speed: '8', heading: '0',
  timestamp: '2026-01-01T00:00:00', cameraFocalLength: '24', cameraWidth: '3840',
  cameraHeight: '2160', imuData: false, barometricAlt: false, rtkCorrections: false,
}

const clip = (name = 'clip.mp4') =>
  new File([new Uint8Array(4096)], name, { type: 'video/mp4' })

// ---------- Parsing ----------

test('the default list parses back to exactly the default classes', () => {
  const parsed = parseLabelVocabulary(defaultVocabularyInput())
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.labels, [...DEFAULT_LABEL_VOCABULARY])
})

test('commas separate; case, spacing and duplicates are normalised away', () => {
  const parsed = parseLabelVocabulary('  Solar Panel ,CHIMNEY,  chimney ,  boat ')
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.labels, ['solar panel', 'chimney', 'boat'])
})

test('characters that would corrupt the worker prompt are stripped', () => {
  const parsed = parseLabelVocabulary('traffic\tlight; bridge-x {A}')
  assert.equal(parsed.ok, true)
  // Tabs collapse to a space, punctuation is removed, hyphens survive, case folds.
  assert.deepEqual(parsed.labels, ['traffic light bridge-x a'])
})

test('an empty or comma-only list is rejected with something to act on', () => {
  for (const input of ['', '   ', ',,, ,']) {
    const parsed = parseLabelVocabulary(input)
    assert.equal(parsed.ok, false, `“${input}” must not be accepted`)
    assert.match(parsed.error ?? '', /at least one object class/)
    assert.deepEqual(parsed.labels, [])
  }
})

test('a class longer than the limit is rejected rather than truncated', () => {
  const long = 'x'.repeat(MAX_LABEL_LENGTH + 1)
  const parsed = parseLabelVocabulary(long)
  assert.equal(parsed.ok, false)
  assert.match(parsed.error ?? '', new RegExp(String(MAX_LABEL_LENGTH)))
})

test('more classes than the limit is rejected, and the count is named', () => {
  const many = Array.from({ length: MAX_VOCABULARY_LABELS + 2 }, (_, i) => `class${i}`).join(',')
  const parsed = parseLabelVocabulary(many)
  assert.equal(parsed.ok, false)
  assert.match(parsed.error ?? '', new RegExp(`${MAX_VOCABULARY_LABELS}`))
})

test('duplicates do not count against the limit', () => {
  const parsed = parseLabelVocabulary(Array.from({ length: 30 }, () => 'roof').join(','))
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.labels, ['roof'], 'one unique class is not thirty')
})

// ---------- The store ----------

test('an unusable list stops the run before anything is processed', () => {
  const store = loadStore()
  const state = store.getState()
  state.setVideoFile(clip())
  state.setVideoDuration(60)
  state.setMetadata(METADATA)
  state.setDataConsent(true)
  state.setLabelVocabularyInput('   ,  , ')

  assert.equal(state.validateAndStart(), false, 'the run must not start')
  const after = store.getState()
  assert.equal(after.isProcessing, false)
  assert.equal(after.processingComplete, false)
  assert.ok(
    after.validationErrors.some((message) => /at least one object class/.test(message)),
    `expected a class-list error, got: ${JSON.stringify(after.validationErrors)}`
  )
})

test('a custom list is accepted and the run completes with it in force', async () => {
  const store = loadStore()
  const state = store.getState()
  state.setVideoFile(clip())
  state.setVideoDuration(60)
  state.setMetadata(METADATA)
  state.setDataConsent(true)
  state.setLabelVocabularyInput('solar panel, chimney')

  assert.equal(store.getState().labelVocabularyInput, 'solar panel, chimney')
  assert.equal(state.validateAndStart(), true)

  const startedAt = Date.now()
  while (!store.getState().processingComplete && !store.getState().pipelineError) {
    if (Date.now() - startedAt > 20_000) throw new Error('timed out waiting for the run')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  const after = store.getState()
  assert.equal(after.pipelineError, null, `run failed: ${after.pipelineError}`)
  assert.equal(after.processingComplete, true)
  // The simulated adapter ignores the classes by design; what this asserts is
  // that a custom list is accepted and cannot break the run. Whether the worker
  // path sends them is covered by the grounding adapter's own tests.
  assert.ok(after.pointCloud.length > 0)
})

test('the class list comes back with the stored model, and older entries get the default', () => {
  const withModel = (extra: Record<string, unknown>) => JSON.stringify({
    state: {
      processingComplete: true, pointCloud: [], trajectory: [], annotations: [],
      trackedObjects: [], bounds: null, videoName: 'restored.webm', videoDurationSec: 90,
      metadata: METADATA, metrics: null, ...extra,
    },
    version: 1,
  })

  const restored = loadStore(fakeStorage(withModel({ labelVocabularyInput: 'boat, pier' })))
  assert.equal(restored.getState().labelVocabularyInput, 'boat, pier')

  // An entry written before this field existed must fall back to the default
  // rather than coming back as undefined and reaching the parser.
  const legacy = loadStore(fakeStorage(withModel({})))
  assert.equal(legacy.getState().labelVocabularyInput, defaultVocabularyInput())

  // And a corrupted value is dropped on the way in, not trusted.
  const corrupted = loadStore(fakeStorage(withModel({ labelVocabularyInput: 42 })))
  assert.equal(corrupted.getState().labelVocabularyInput, defaultVocabularyInput())
})
