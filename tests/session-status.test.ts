/**
 * Tests for the derived session status.
 *
 * These pin the words the user sees to the store state they come from, because
 * the bug being fixed was exactly a disagreement between the two: a page said
 * "Reconstruction complete" while the numbers belonged to the previous video.
 * The statuses are pure, so every transition can be asserted without a browser.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createInitialSteps, type StepId, type StepState } from '../src/app/droneviz3d/pipeline'
import { deriveSessionStatus } from '../src/app/droneviz3d/session-status'

/** The 9 real steps, with a few states overridden as the pipeline would leave them. */
function stepsWith(states: Partial<Record<StepId, StepState>> = {}) {
  return createInitialSteps().map((step) => (states[step.id] ? { ...step, state: states[step.id]! } : step))
}

const FRESH = {
  hasVideo: false,
  isProcessing: false,
  processingComplete: false,
  pipelineError: null as string | null,
  pointCount: 0,
}

test('a fresh visit is idle, and says how many steps a run would take', () => {
  const status = deriveSessionStatus({ ...FRESH, steps: createInitialSteps() })
  assert.equal(status.id, 'idle')
  assert.equal(status.percent, 0)
  assert.equal(status.stepName, null)
  assert.equal(status.stepCount, 9)
  assert.match(status.detail, /9-step pipeline/)
})

test('a chosen video is not described as processing yet', () => {
  const status = deriveSessionStatus({ ...FRESH, hasVideo: true, steps: createInitialSteps() })
  assert.equal(status.id, 'uploading')
  assert.equal(status.percent, 0)
})

test('a running pipeline names the real step and counts its own progress', () => {
  const steps = stepsWith({
    extract: { status: 'complete', progress: 100, duration: 120 },
    grounding: { status: 'running', progress: 50 },
  })
  const status = deriveSessionStatus({ ...FRESH, hasVideo: true, isProcessing: true, steps })
  assert.equal(status.id, 'processing')
  assert.equal(status.tone, 'info')
  assert.equal(status.stepIndex, 2)
  assert.equal(status.stepId, 'grounding')
  assert.equal(status.stepName, 'Semantic Grounding')
  assert.equal(status.stepProgress, 50)
  assert.equal(status.completedSteps, 1)
  // 1 completed step plus half of the second, over nine steps.
  assert.equal(status.percent, 17)
  assert.equal(status.detail, 'Step 2 of 9: Semantic Grounding — 50%')
})

test('a step that stalled at zero is visible as stalled, not as progress', () => {
  const steps = stepsWith({
    extract: { status: 'complete', progress: 100, duration: 90 },
    grounding: { status: 'running', progress: 0 },
  })
  const status = deriveSessionStatus({ ...FRESH, hasVideo: true, isProcessing: true, steps })
  assert.equal(status.stepProgress, 0)
  assert.match(status.detail, /0%/)
  assert.equal(status.percent, 11, 'only the finished step counts')
})

test('a failure names the step it stopped at and never reads as ready', () => {
  const message = 'No keyframes could be extracted from the video'
  const steps = stepsWith({
    extract: { status: 'complete', progress: 100, duration: 90 },
    grounding: { status: 'error', progress: 0, errorMessage: message },
  })
  const status = deriveSessionStatus({ ...FRESH, hasVideo: true, pipelineError: message, steps })
  assert.equal(status.id, 'failed')
  assert.equal(status.tone, 'error')
  assert.equal(status.stepIndex, 2)
  assert.equal(status.stepName, 'Semantic Grounding')
  assert.match(status.detail, /Semantic Grounding/)
  assert.match(status.detail, /No keyframes/)
  assert.notEqual(status.percent, 100)
})

test('a failure outranks a stale completion flag', () => {
  const steps = stepsWith({ extract: { status: 'error', progress: 0, errorMessage: 'boom' } })
  const status = deriveSessionStatus({
    ...FRESH, isProcessing: true, processingComplete: true, pipelineError: 'boom', steps,
  })
  assert.equal(status.id, 'failed', 'a run that failed cannot also be described as ready')
})

test('a completed run is ready at 100 percent even when it was restored', () => {
  // A restored model comes back with the steps still pending — the run happened
  // in an earlier visit — but it is finished, not stuck.
  const status = deriveSessionStatus({
    ...FRESH, processingComplete: true, pointCount: 300, steps: createInitialSteps(),
  })
  assert.equal(status.id, 'ready')
  assert.equal(status.tone, 'success')
  assert.equal(status.percent, 100)
  assert.match(status.detail, /300 points generated/)
})

test('a restored summary with no geometry says so instead of claiming points', () => {
  const status = deriveSessionStatus({
    ...FRESH, processingComplete: true, pointCount: 0, steps: createInitialSteps(),
  })
  assert.equal(status.id, 'ready')
  assert.doesNotMatch(status.detail, /points generated/)
  assert.match(status.detail, /summary/)
})
