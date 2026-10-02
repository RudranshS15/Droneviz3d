/**
 * Which part of the session the user is looking at, derived from the store.
 *
 * Every page used to spell out its own version of this — "Initializing…",
 * "Running: <step>", a green Ready pill in the header — and they could disagree:
 * the processing page could say "Reconstruction complete" while the store still
 * held the previous run's model, and a failed run looked exactly like an empty
 * one. Here the state is derived once, from the same `steps` the pipeline
 * actually advances, and it carries the step that is really running.
 *
 * Deliberately pure and timer-free: `percent` includes the running step's own
 * reported progress, so a step that stalls at 40% is visibly stuck at 40%.
 */

import { PipelineStep, StepId, isComplete, isError, isRunning, getProgress } from './pipeline'

export type SessionStateId = 'idle' | 'uploading' | 'processing' | 'failed' | 'ready'

export type SessionTone = 'neutral' | 'info' | 'warning' | 'error' | 'success'

export interface SessionStatus {
  id: SessionStateId
  /** Short word for a status chip. */
  label: string
  tone: SessionTone
  /** One sentence describing exactly what is happening. */
  detail: string
  /** 1-based position of the step this status is about, when there is one. */
  stepIndex: number | null
  stepId: StepId | null
  stepName: string | null
  /** Progress reported by the running step itself (0–100). */
  stepProgress: number
  completedSteps: number
  stepCount: number
  /** Overall progress, including the running step's fractional progress. */
  percent: number
}

export interface SessionStatusInput {
  hasVideo: boolean
  isProcessing: boolean
  processingComplete: boolean
  pipelineError: string | null
  steps: PipelineStep[]
  pointCount: number
}

export function deriveSessionStatus(input: SessionStatusInput): SessionStatus {
  const { hasVideo, isProcessing, processingComplete, pipelineError, steps, pointCount } = input
  const stepCount = steps.length
  const completedSteps = steps.filter((s) => isComplete(s.state)).length
  const runningIndex = steps.findIndex((s) => isRunning(s.state))
  const errorIndex = steps.findIndex((s) => isError(s.state))
  const running = runningIndex >= 0 ? steps[runningIndex] : null
  const failed = errorIndex >= 0 ? steps[errorIndex] : null
  const stepProgress = running ? getProgress(running.state) : 0
  const fraction =
    stepCount === 0 ? 0 : (completedSteps + (running ? stepProgress / 100 : 0)) / stepCount
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)))

  const base = {
    stepProgress,
    completedSteps,
    stepCount,
    percent,
    stepIndex: runningIndex >= 0 ? runningIndex + 1 : null,
    stepId: running?.id ?? null,
    stepName: running?.name ?? null,
  }

  // Precedence matters: a failure is reported even if a completion flag somehow
  // survived, and a running pipeline is never described as ready.
  if (pipelineError) {
    return {
      ...base,
      id: 'failed',
      label: 'Failed',
      tone: 'error',
      detail: failed
        ? `Stopped at “${failed.name}”: ${pipelineError}`
        : pipelineError,
      stepIndex: failed ? errorIndex + 1 : null,
      stepId: failed?.id ?? null,
      stepName: failed?.name ?? null,
    }
  }

  if (isProcessing) {
    return {
      ...base,
      id: 'processing',
      label: 'Processing',
      tone: 'info',
      detail: running
        ? `Step ${runningIndex + 1} of ${stepCount}: ${running.name} — ${stepProgress}%`
        : `Preparing the ${stepCount}-step pipeline…`,
    }
  }

  if (processingComplete) {
    return {
      ...base,
      id: 'ready',
      label: 'Ready',
      tone: 'success',
      percent: 100,
      detail:
        pointCount > 0
          ? `${pointCount.toLocaleString()} point${pointCount === 1 ? '' : 's'} generated. Open the viewer to inspect the model.`
          : 'The run finished, but its geometry was too large for this browser to keep — the summary is on the results page.',
    }
  }

  if (hasVideo) {
    return {
      ...base,
      id: 'uploading',
      label: 'Video loaded',
      tone: 'neutral',
      detail: 'This video is loaded in your browser and has not been processed yet.',
    }
  }

  return {
    ...base,
    id: 'idle',
    label: 'Idle',
    tone: 'neutral',
    detail: `No video selected yet. Upload one to run the ${stepCount}-step pipeline.`,
  }
}
