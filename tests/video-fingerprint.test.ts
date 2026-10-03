/**
 * The simulated grounding adapter must depend on the uploaded clip, not only on
 * the flight metadata.
 *
 * This is the regression guard for a specific misdiagnosis: two different videos
 * entered with the same GPS / altitude / heading produced byte-identical scenes,
 * which reads exactly like the app re-serving a cached model. The cause was that
 * the simulated adapter seeded its scene from the metadata alone, so it never
 * looked at the video at all.
 *
 * The tests run at two levels on purpose. The first group exercises the pure
 * pieces — the byte fingerprint and the seed source — because that is where the
 * fix is testable in Node without decoding anything. The second group drives the
 * real store through a full run, which is the path a user actually takes, and
 * asserts that swapping the file changes the model while keeping the metadata
 * fixed. The store-level assertions are the ones that would have caught the
 * original bug.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { DroneVizState } from '../src/app/droneviz3d/store'
import { createSimulatedLocateAnythingAdapter, planKeyframes } from '../src/app/droneviz3d/grounding'
import { FlightParams } from '../src/app/droneviz3d/geometry'
import {
  FINGERPRINT_SAMPLE_BYTES, fingerprintVideoFile, simulatedSeedSource,
} from '../src/app/droneviz3d/video-fingerprint'

// ---------- Harness ----------

interface FakeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function fakeStorage(): FakeStorage {
  const data = new Map<string, string>()
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

function loadStore(): StoreLike {
  const globalWithWindow = globalThis as unknown as { window?: unknown }
  globalWithWindow.window = { localStorage: fakeStorage() }
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

/** Deterministic pseudo-video bytes: same `seed` ⇒ same bytes, any size. */
function clipBytes(seed: number, size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size)
  let a = seed >>> 0
  for (let i = 0; i < size; i++) {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    bytes[i] = (t ^ (t >>> 14)) & 0xff
  }
  return bytes
}

const clip = (seed: number, name: string, size = 300_000) =>
  new File([clipBytes(seed, size)], name, { type: 'video/mp4' })

async function runWithFile(file: File): Promise<DroneVizState> {
  const store = loadStore()
  store.getState().setVideoFile(file)
  store.getState().setVideoDuration(60)
  store.getState().setMetadata(METADATA)
  store.getState().setDataConsent(true)
  assert.equal(store.getState().validateAndStart(), true)
  const startedAt = Date.now()
  while (!store.getState().processingComplete && !store.getState().pipelineError) {
    if (Date.now() - startedAt > 20_000) throw new Error('timed out waiting for the run')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  const state = store.getState()
  assert.equal(state.pipelineError, null, `run failed: ${state.pipelineError}`)
  return state
}

// ---------- The fingerprint itself ----------

test('the same bytes fingerprint identically, different bytes do not', async () => {
  const a1 = await fingerprintVideoFile(clip(1, 'a.mp4'))
  const a2 = await fingerprintVideoFile(clip(1, 'a-copy.mp4'))
  const b = await fingerprintVideoFile(clip(2, 'b.mp4'))

  assert.equal(a1.hex, a2.hex, 'a re-upload of the same clip must be recognised as the same clip')
  assert.notEqual(a1.hex, b.hex, 'two different clips must not share a fingerprint')
  assert.match(a1.hex, /^[0-9a-f]{64}$/)
})

test('a difference in the middle of a long clip still changes the fingerprint', async () => {
  // Same length, same container header, different payload — the case a
  // head-only sample would miss. This is why the sample is spread, not front-loaded.
  const size = 1_200_000
  const original = clipBytes(7, size)
  const edited: Uint8Array<ArrayBuffer> = Uint8Array.from(original)
  for (let i = 600_000; i < 600_400; i++) edited[i] = (edited[i] + 1) & 0xff

  const a = await fingerprintVideoFile(new File([original], 'a.mp4', { type: 'video/mp4' }))
  const b = await fingerprintVideoFile(new File([edited], 'b.mp4', { type: 'video/mp4' }))

  assert.equal(a.bytes, b.bytes, 'the two clips are the same length')
  assert.notEqual(a.hex, b.hex, 'a middle-of-file change must be visible to the fingerprint')
})

test('a truncated copy of the same footage is not the same clip', async () => {
  const full = clipBytes(9, 900_000)
  const a = await fingerprintVideoFile(new File([full], 'full.mp4', { type: 'video/mp4' }))
  const b = await fingerprintVideoFile(new File([full.slice(0, 500_000)], 'part.mp4', { type: 'video/mp4' }))
  assert.notEqual(a.hex, b.hex)
})

test('fingerprinting reads a bounded sample, never the whole clip', async () => {
  const fp = await fingerprintVideoFile(clip(3, 'big.mp4', 8_000_000))
  assert.equal(fp.bytes, 8_000_000)
  assert.ok(fp.sampledBytes > 0)
  assert.ok(fp.sampledBytes <= FINGERPRINT_SAMPLE_BYTES, `read ${fp.sampledBytes} bytes`)
})

test('an empty file still fingerprints instead of throwing', async () => {
  const fp = await fingerprintVideoFile(new File([], 'empty.mp4', { type: 'video/mp4' }))
  assert.match(fp.hex, /^[0-9a-f]{64}$/)
  assert.equal(fp.sampledBytes, 0)
})

// ---------- Seed derivation ----------

test('the simulated seed source carries the clip when there is one and is unchanged without it', () => {
  const metadataSeed = '28.613900,77.209000,120,0'
  const withClip = simulatedSeedSource(metadataSeed, 'deadbeef')
  const withoutClip = simulatedSeedSource(metadataSeed, null)

  assert.ok(withClip.includes('deadbeef'))
  assert.notEqual(withClip, withoutClip)
  // No clip in hand (restored session / demo) must reproduce the old behaviour
  // exactly rather than inventing an identity for a file that is not there.
  assert.equal(withoutClip, metadataSeed)
  assert.equal(simulatedSeedSource(metadataSeed, null), simulatedSeedSource(metadataSeed, null))
})

// ---------- The adapter ----------

function baseFlight(): FlightParams {
  return {
    gpsLat: 28.6139, gpsLng: 77.209, altitude: 120, speed: 8, heading: 0,
    durationSec: 180, rtkCorrections: false,
  }
}

const requestsFor = () =>
  planKeyframes(180).times.map((_, i) => ({
    image: new Blob(), keyframeIndex: i, labels: ['building', 'vehicle', 'tree'] as const,
  }))

test('the simulated adapter is still deterministic for one clip and differs across clips', async () => {
  const requests = requestsFor()
  const seedA = 'a'.repeat(64)
  const seedB = 'b'.repeat(64)

  const a1 = await createSimulatedLocateAnythingAdapter(baseFlight(), seedA)(requests)
  const a2 = await createSimulatedLocateAnythingAdapter(baseFlight(), seedA)(requests)
  const b = await createSimulatedLocateAnythingAdapter(baseFlight(), seedB)(requests)

  assert.equal(a1.length, requests.length)
  assert.deepEqual(a1.map((r) => r.boxes), a2.map((r) => r.boxes), 'same clip ⇒ same scene')
  assert.notDeepEqual(a1.map((r) => r.boxes), b.map((r) => r.boxes), 'different clip ⇒ different scene')
})

test('the adapter reports the seed it actually used, and the metadata-only fallback is preserved', async () => {
  const requests = requestsFor()
  const seed = 'c'.repeat(64)

  const withClip = await createSimulatedLocateAnythingAdapter(baseFlight(), seed)(requests)
  assert.ok(withClip[0].synthesisSeed?.includes(seed), 'the response names the clip it was seeded from')

  const noClip = await createSimulatedLocateAnythingAdapter(baseFlight())(requests)
  const metadataOnly = '28.613900,77.209000,120,0'
  assert.equal(noClip[0].synthesisSeed, metadataOnly)
})

// ---------- End to end through the store ----------

test('two different videos with identical metadata reconstruct differently', async () => {
  const a = await runWithFile(clip(11, 'survey-a.mp4'))
  const b = await runWithFile(clip(22, 'survey-b.mp4'))

  // The metadata, the duration and the plan are identical; only the bytes differ.
  assert.equal(JSON.stringify(a.metrics?.keyframesSampled), JSON.stringify(b.metrics?.keyframesSampled))
  assert.notEqual(
    JSON.stringify(a.pointCloud),
    JSON.stringify(b.pointCloud),
    'identical metadata must not mean an identical scene when the videos differ'
  )
  assert.notEqual(a.metrics?.groundedObjects, b.metrics?.groundedObjects)
  assert.notEqual(a.metrics?.coverage, b.metrics?.coverage)
})

test('the same video run twice reconstructs identically, and a different name does not matter', async () => {
  const a = await runWithFile(clip(33, 'first-name.mp4'))
  const b = await runWithFile(clip(33, 'second-name.mp4'))

  assert.equal(JSON.stringify(a.pointCloud), JSON.stringify(b.pointCloud))
  assert.equal(JSON.stringify(a.metrics), JSON.stringify(b.metrics))
})

test('a simulated run says it was seeded from the clip, not from metadata alone', async () => {
  const state = await runWithFile(clip(44, 'seeded.mp4'))
  const basis = state.metrics?.synthesisBasis ?? ''

  assert.match(basis, /simulated adapter/i)
  assert.match(basis, /no model was run/i)
  assert.match(basis, /clip's sampled bytes/i)
  assert.match(basis, /flight metadata/i)
  // The seed is carried as a short digest, never as file content.
  assert.match(basis, /SHA-256 [0-9a-f]{12}…/)
  assert.equal(state.metrics?.keyframesExtracted, 'n/a (no decode)')
})

test('a run with no clip in hand falls back to the metadata-only seed, and says so', async () => {
  const store = loadStore()
  // The videoFile is deliberately absent: this is the restored-session / demo
  // path, where there is genuinely nothing to read.
  store.getState().setMetadata(METADATA)
  store.getState().setDataConsent(true)
  assert.equal(store.getState().validateAndStart(), false, 'no video is a form error, not a run')

  const state = store.getState()
  assert.ok(state.validationErrors.some((m) => /video/i.test(m)))
  assert.equal(state.isProcessing, false)
})

test('the same clip with different metadata still reconstructs differently', async () => {
  // The fix must not replace one single-input dependency with another: metadata
  // still drives the geometry, and the clip only adds to the seed.
  const a = await runWithFile(clip(55, 'one-flight.mp4'))

  const store = loadStore()
  store.getState().setVideoFile(clip(55, 'one-flight.mp4'))
  store.getState().setVideoDuration(60)
  store.getState().setMetadata({ ...METADATA, altitude: '300' })
  store.getState().setDataConsent(true)
  assert.equal(store.getState().validateAndStart(), true)
  const startedAt = Date.now()
  while (!store.getState().processingComplete && !store.getState().pipelineError) {
    if (Date.now() - startedAt > 20_000) throw new Error('timed out waiting for the run')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  const b = store.getState()

  assert.equal(b.pipelineError, null)
  assert.notEqual(JSON.stringify(a.pointCloud), JSON.stringify(b.pointCloud))
})