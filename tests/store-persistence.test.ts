/**
 * Persistence tests for the droneviz3d store.
 *
 * The store restores a finished reconstruction from localStorage so a reload, a
 * direct visit to the viewer URL, or a return visit days later does not throw
 * the model away. These tests drive the real persist middleware against a fake
 * storage, because the failure modes here are exactly the ones that are
 * invisible in a unit test of a helper: a dropped point cloud, a missing metrics
 * object, a guard that decides there is no model before storage has been read,
 * or a Reset that clears memory while leaving the stored copy behind.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { DroneVizState } from '../src/app/droneviz3d/store'

const KEY = 'droneviz3d-model'

interface FakeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  dump(): Map<string, string>
}

function fakeStorage(seed?: string): FakeStorage {
  const data = new Map<string, string>()
  if (seed !== undefined) data.set(KEY, seed)
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, String(value)) },
    removeItem: (key) => { data.delete(key) },
    dump: () => data,
  }
}

function metricsFixture() {
  return {
    totalPoints: '12,142', accuracy: 'n/a (single pass)', processingTime: 'client-side demo',
    coverage: '85.7%', confidenceScore: '0.71', groundedObjects: '49',
    groundedLabels: 'building, vehicle', keyframesSampled: '24', provenance: 'test provenance',
  }
}

const METADATA = {
  gpsLat: '28.6139', gpsLng: '77.2090', altitude: '120', speed: '8', heading: '0',
  timestamp: '2026-01-01T00:00:00', cameraFocalLength: '24', cameraWidth: '3840',
  cameraHeight: '2160', imuData: false, barometricAlt: false, rtkCorrections: false,
}

interface StoreLike {
  getState(): DroneVizState
  setState(partial: Partial<DroneVizState>): void
}

/**
 * Load a fresh store instance wired to the given storage.
 *
 * The store captures `window.localStorage` when its module is evaluated, so the
 * fake storage must be installed first — hence the cache eviction and a fresh
 * `require` per test instead of a top-level import. A fresh module instance over
 * the *same* storage is also exactly what a browser restart looks like to this
 * code: new page, same localStorage.
 */
function loadStore(storage: FakeStorage): StoreLike {
  const globalWithWindow = globalThis as unknown as { window?: unknown }
  globalWithWindow.window = { localStorage: storage }
  // A fresh module instance per test is the whole point here, so `require` is
  // deliberate rather than an oversight.
  const id = require.resolve('../src/app/droneviz3d/store')
  delete require.cache[id]
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(id).useDroneVizStore as StoreLike
}

const cloudOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ x: i, y: i * 2, z: 0, r: 10, g: 20, b: 30, confidence: 0.6 }))

test('a full model restores from localStorage and is flagged as restored', () => {
  const storage = fakeStorage(JSON.stringify({
    state: {
      processingComplete: true, pointCloud: cloudOf(5), trajectory: [], annotations: [],
      trackedObjects: [], bounds: null, videoName: 'restored.webm', videoDurationSec: 90,
      metadata: METADATA, metrics: metricsFixture(),
    },
    version: 1,
  }))
  const store = loadStore(storage)
  const state = store.getState()

  assert.equal(state.processingComplete, true)
  assert.equal(state.pointCloud.length, 5)
  assert.deepEqual(state.metrics, metricsFixture())
  assert.equal(state.videoName, 'restored.webm')
  assert.equal(state.restoredFromStorage, true, 'the UI must be able to say where the model came from')
  assert.equal(state.hydrated, true)
  // The video File and blob URL are never persisted.
  assert.equal(state.videoFile, null)
})

test('metrics survive a visit that could not store the point cloud', () => {
  const storage = fakeStorage(JSON.stringify({
    state: {
      processingComplete: true, pointCloud: [], trajectory: [], annotations: [],
      trackedObjects: [], bounds: null, videoName: 'degraded.webm', videoDurationSec: 90,
      metadata: METADATA, metrics: metricsFixture(),
    },
    version: 1,
  }))
  const store = loadStore(storage)
  const state = store.getState()
  assert.equal(state.processingComplete, true)
  assert.equal(state.pointCloud.length, 0)
  assert.deepEqual(state.metrics, metricsFixture(), 'the run summary must not be lost with the geometry')
  assert.equal(state.restoredFromStorage, true)
})

test('an empty storage yields an empty, hydrated store', () => {
  const storage = fakeStorage()
  const store = loadStore(storage)
  const state = store.getState()
  assert.equal(state.processingComplete, false)
  assert.equal(state.pointCloud.length, 0)
  assert.equal(state.metrics, null)
  assert.equal(state.restoredFromStorage, false)
  assert.equal(state.hydrated, true, 'guards must not wait forever on a fresh browser with nothing stored')
})

test('a corrupt entry is ignored instead of crashing the section', () => {
  const storage = fakeStorage('{not json')
  const store = loadStore(storage)
  assert.equal(store.getState().pointCloud.length, 0)
  assert.equal(store.getState().hydrated, true)
})

test('a model written by one visit is restored by a later visit to the same browser', () => {
  // One shared storage across two independent store instances: the first is the
  // visit that produced the model, the second is a brand-new page load.
  const storage = fakeStorage()
  const first = loadStore(storage)
  first.getState().setVideoFile(new File(['x'], 'flight.webm', { type: 'video/webm' }))
  first.getState().completeProcessingWith({
    points: cloudOf(4), trajectory: [], annotations: [], metrics: metricsFixture(),
    bounds: { minLat: 1, minLng: 2, maxLat: 3, maxLng: 4 },
    trackedObjects: [], projectedDetections: [],
  })
  assert.equal(first.getState().restoredFromStorage, false, 'the visit that ran the pipeline is not a restore')

  const later = loadStore(storage)
  const state = later.getState()
  assert.equal(state.processingComplete, true)
  assert.equal(state.pointCloud.length, 4, 'the geometry must come back without re-running the pipeline')
  assert.equal(state.restoredFromStorage, true, 'and the UI must be told it was restored, not freshly generated')
  assert.equal(state.metadata.gpsLat, METADATA.gpsLat, 'the flight metadata the model was georeferenced with comes back too')
})

test('a draft in progress is never stored, so the entry means "a model exists"', () => {
  const storage = fakeStorage()
  const store = loadStore(storage)

  store.getState().setVideoFile(new File(['x'], 'draft.webm', { type: 'video/webm' }))
  store.getState().setMetadata({ gpsLat: '19.0760', gpsLng: '72.8777', altitude: '95' })
  store.getState().setDataConsent(true)
  assert.equal(
    storage.dump().has(KEY), false,
    'someone who only opened the upload form must not leave flight metadata behind in their browser'
  )

  // Once a model exists the entry appears; that is the only thing it ever holds.
  store.getState().completeProcessingWith({
    points: cloudOf(2), trajectory: [], annotations: [], metrics: metricsFixture(),
    bounds: { minLat: 1, minLng: 2, maxLat: 3, maxLng: 4 },
    trackedObjects: [], projectedDetections: [],
  })
  assert.equal(storage.dump().has(KEY), true)
})

test('Reset deletes the stored model instead of leaving a copy behind', () => {
  const storage = fakeStorage()
  const store = loadStore(storage)
  store.getState().completeProcessingWith({
    points: cloudOf(3), trajectory: [], annotations: [], metrics: metricsFixture(),
    bounds: { minLat: 1, minLng: 2, maxLat: 3, maxLng: 4 },
    trackedObjects: [], projectedDetections: [],
  })
  assert.ok(storage.dump().has(KEY), 'precondition: there is something stored to erase')

  store.getState().reset()
  assert.equal(storage.dump().has(KEY), false, 'eraser must mean erased, per the privacy policy')

  // And a later visit therefore starts clean rather than resurrecting the model,
  // including after that visit settles its own (empty) state.
  const later = loadStore(storage)
  assert.equal(later.getState().processingComplete, false)
  assert.equal(later.getState().pointCloud.length, 0)
  assert.equal(later.getState().restoredFromStorage, false)
  later.getState().markHydrated()
  assert.equal(storage.dump().has(KEY), false, 'rehydrating an empty browser must not invent an entry')
})

test('a fresh run clears the restored flag', () => {
  const storage = fakeStorage(JSON.stringify({
    state: {
      processingComplete: true, pointCloud: cloudOf(2), trajectory: [], annotations: [],
      trackedObjects: [], bounds: null, videoName: 'old.webm', videoDurationSec: 30,
      metadata: METADATA, metrics: metricsFixture(),
    },
    version: 1,
  }))
  const store = loadStore(storage)
  assert.equal(store.getState().restoredFromStorage, true)
  store.getState().reset()
  assert.equal(store.getState().restoredFromStorage, false)
  assert.equal(store.getState().metrics, null)
})

test('granting consent clears the consent error but leaves other errors alone', () => {
  const store = loadStore(fakeStorage())
  store.getState().setVideoFile(new File(['x'], 'clip.webm', { type: 'video/webm' }))

  // Starting without consent is refused, with an explanation.
  assert.equal(store.getState().validateAndStart(), false)
  assert.ok(store.getState().validationErrors.some((m) => /consent/i.test(m)))

  // Ticking the box fixes exactly that problem, so the message must not linger.
  store.getState().setDataConsent(true)
  assert.deepEqual(store.getState().validationErrors, [])

  // An unrelated field error survives a consent toggle, and vice versa.
  store.setState({ validationErrors: ['Altitude must be a number', 'Please consent before starting'] })
  store.getState().setDataConsent(true)
  assert.deepEqual(store.getState().validationErrors, ['Altitude must be a number'])
})

test('what gets persisted is only the finished model', () => {
  const storage = fakeStorage()
  const store = loadStore(storage)
  store.getState().setVideoFile(new File(['x'], 'clip.webm', { type: 'video/webm' }))
  store.getState().completeProcessingWith({
    points: cloudOf(3), trajectory: [], annotations: [], metrics: metricsFixture(),
    bounds: { minLat: 1, minLng: 2, maxLat: 3, maxLng: 4 },
    trackedObjects: [], projectedDetections: [],
  })

  const raw = storage.getItem(KEY)
  assert.ok(raw, 'the finished model is written to storage')
  const persisted = JSON.parse(raw!)
  const keys = Object.keys(persisted.state)
  assert.ok(!keys.includes('videoFile'), 'the File object cannot and must not be persisted')
  assert.ok(!keys.includes('videoPreview'), 'blob URLs are meaningless after a reload')
  assert.ok(!keys.includes('hydrated'), 'hydration state is not model data')
  assert.ok(!keys.includes('restoredFromStorage'))
  assert.ok(!keys.includes('dataConsent'), 'consent is not a durable record either way')
  assert.equal(persisted.state.processingComplete, true)
  assert.deepEqual(persisted.state.metrics, metricsFixture())
  // Points are quantized to a flat integer array on write.
  assert.ok(Array.isArray(persisted.state.pointCloud))
  assert.equal(persisted.state.pointCloud.length, 3 * 7)
})
