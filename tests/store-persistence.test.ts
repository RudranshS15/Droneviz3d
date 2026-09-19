/**
 * Persistence tests for the droneviz3d store.
 *
 * The store restores a finished reconstruction from sessionStorage so a reload
 * (or a direct visit to the viewer URL) does not throw the model away. These
 * tests drive the real persist middleware against a fake storage, because the
 * failure modes here are exactly the ones that are invisible in a unit test of a
 * helper: a dropped point cloud, a missing metrics object, or a guard that
 * decides the session is empty before storage has been read.
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
 * The store captures `window.sessionStorage` when its module is evaluated, so
 * the fake storage must be installed first — hence the cache eviction and a
 * fresh `require` per test instead of a top-level import.
 */
function loadStore(storage: FakeStorage): StoreLike {
  const globalWithWindow = globalThis as unknown as { window?: unknown }
  globalWithWindow.window = { sessionStorage: storage }
  // A fresh module instance per test is the whole point here, so `require` is
  // deliberate rather than an oversight.
  const id = require.resolve('../src/app/droneviz3d/store')
  delete require.cache[id]
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(id).useDroneVizStore as StoreLike
}

const cloudOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ x: i, y: i * 2, z: 0, r: 10, g: 20, b: 30, confidence: 0.6 }))

test('a full model restores from sessionStorage and is flagged as restored', () => {
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
  assert.equal(state.restoredFromSession, true, 'the UI must be able to say where the model came from')
  assert.equal(state.hydrated, true)
  // The video File and blob URL are never persisted.
  assert.equal(state.videoFile, null)
})

test('metrics survive a session that could not store the point cloud', () => {
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
  assert.equal(state.restoredFromSession, true)
})

test('an empty storage yields an empty, hydrated store', () => {
  const storage = fakeStorage()
  const store = loadStore(storage)
  const state = store.getState()
  assert.equal(state.processingComplete, false)
  assert.equal(state.pointCloud.length, 0)
  assert.equal(state.metrics, null)
  assert.equal(state.restoredFromSession, false)
  assert.equal(state.hydrated, true, 'guards must not wait forever on a fresh session')
})

test('a corrupt entry is ignored instead of crashing the section', () => {
  const storage = fakeStorage('{not json')
  const store = loadStore(storage)
  assert.equal(store.getState().pointCloud.length, 0)
  assert.equal(store.getState().hydrated, true)
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
  assert.equal(store.getState().restoredFromSession, true)
  store.getState().reset()
  assert.equal(store.getState().restoredFromSession, false)
  assert.equal(store.getState().metrics, null)
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
  assert.ok(!keys.includes('restoredFromSession'))
  assert.equal(persisted.state.processingComplete, true)
  assert.deepEqual(persisted.state.metrics, metricsFixture())
  // Points are quantized to a flat integer array on write.
  assert.ok(Array.isArray(persisted.state.pointCloud))
  assert.equal(persisted.state.pointCloud.length, 3 * 7)
})
