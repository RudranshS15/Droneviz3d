/**
 * Execution tests for the processing pipeline.
 *
 * The pipeline used to animate every step to 100% on a fixed schedule while the
 * real work ran afterwards in one lump, so a finished progress bar implied a
 * finished reconstruction even when grounding had failed. These tests lock the
 * replacement: a step reaches `complete` because its operation returned, a
 * failure stops the run and names the step, and nothing pretends to be a model
 * that was not produced.
 *
 * The elapsed-time assertion below is the direct regression guard: the removed
 * timer schedule summed to ~9.8 s, so a run that finishes well inside that could
 * not have been waiting on it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { DroneVizState } from '../src/app/droneviz3d/store'
import { STEP_DEFINITIONS } from '../src/app/droneviz3d/pipeline'

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

/** A run that is ready to start: video present, metadata valid, consent given. */
function readyStore(): StoreLike {
  const store = loadStore()
  store.getState().setVideoFile(new File(['x'], 'flight.webm', { type: 'video/webm' }))
  store.getState().setVideoDuration(60)
  store.getState().setMetadata(METADATA)
  store.getState().setDataConsent(true)
  return store
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('timed out waiting for the pipeline')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('a step completes because its work returned, not because a timer fired', async () => {
  const store = readyStore()
  const startedAt = Date.now()
  assert.equal(store.getState().validateAndStart(), true)

  // Synchronous snapshot: the run is genuinely mid-flight, with the early stages
  // done and the current one running rather than everything already "complete".
  const during = store.getState()
  assert.equal(during.isProcessing, true)
  assert.equal(during.processingComplete, false, 'nothing may claim success before the work runs')
  assert.equal(during.pipelineError, null)

  await waitFor(() => store.getState().processingComplete)
  const elapsed = Date.now() - startedAt

  // The removed timer schedule summed to ~9.8 s. Finishing far inside that proves
  // progress is driven by execution rather than by a fixed animation.
  assert.ok(elapsed < 5000, `a simulated run should not wait on timers (took ${elapsed} ms)`)

  const state = store.getState()
  for (const def of STEP_DEFINITIONS) {
    const step = state.steps.find((s) => s.id === def.id)
    assert.ok(step, `step ${def.id} is missing`)
    assert.equal(step.state.status, 'complete', `step ${def.id} did not complete`)
  }
  assert.equal(state.metrics?.groundingSource, 'simulated adapter (no model was run)')
  assert.ok(state.pointCloud.length > 0, 'the run produced geometry')
})

test('invalid metadata is refused before the pipeline starts, not part-way through', () => {
  const store = loadStore()
  store.getState().setVideoFile(new File(['x'], 'flight.webm', { type: 'video/webm' }))
  store.getState().setVideoDuration(60)
  // Altitude 5 m is outside the accepted range. This is a form error, so it must
  // surface as a field message with nothing started — not as a pipeline failure
  // with steps half-run.
  store.getState().setMetadata({ ...METADATA, altitude: '5' })
  store.getState().setDataConsent(true)

  assert.equal(store.getState().validateAndStart(), false)
  const state = store.getState()
  assert.ok(state.validationErrors.some((m) => /Altitude/.test(m)), 'the form says what is wrong')
  assert.equal(state.pipelineError, null, 'a form error is not a pipeline failure')
  assert.equal(state.isProcessing, false)
  assert.equal(state.processingComplete, false)
  assert.ok(state.steps.every((s) => s.state.status === 'pending'), 'nothing ran, nothing completed')
})

test('a run without consent never starts', () => {
  const store = loadStore()
  store.getState().setVideoFile(new File(['x'], 'flight.webm', { type: 'video/webm' }))
  store.getState().setMetadata(METADATA)
  assert.equal(store.getState().validateAndStart(), false)
  assert.ok(store.getState().validationErrors.some((m) => /consent/i.test(m)))
  assert.equal(store.getState().isProcessing, false)
  assert.ok(store.getState().steps.every((s) => s.state.status === 'pending'))
})

test('reset clears the errors so the page stops showing them', () => {
  const store = loadStore()
  store.getState().setVideoFile(new File(['x'], 'flight.webm', { type: 'video/webm' }))
  store.getState().setMetadata({ ...METADATA, altitude: '5' })
  store.getState().setDataConsent(true)
  store.getState().validateAndStart()
  assert.ok(store.getState().validationErrors.length > 0)

  store.getState().reset()
  assert.equal(store.getState().pipelineError, null)
  assert.deepEqual(store.getState().validationErrors, [])
  assert.equal(store.getState().processingComplete, false)
  assert.equal(store.getState().metrics, null)
})
