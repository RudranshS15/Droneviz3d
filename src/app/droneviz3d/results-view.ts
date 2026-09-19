/**
 * results-view.ts — derived state for the results page.
 *
 * Two questions the page must answer honestly, both as pure functions so they
 * can be tested without a browser:
 *
 *   1. What is the state of this reconstruction? The page can be reached with
 *      nothing processed, mid-run, after a run that produced no model, or from a
 *      session where the point cloud was too large to restore. Each deserves a
 *      different, explicit message — and none of them should look like a
 *      successful survey.
 *   2. Which numbers were measured, and which were synthesized? Object counts
 *      and observations are observations of the input. Point counts, coverage
 *      and confidence weights come out of the synthesis step and are estimates.
 */

import { TrackedObject } from './grounding'
import { ReconstructionMetrics } from './reconstruct'

export type ReconstructionStatusId =
  | 'empty' | 'running' | 'incomplete' | 'partial' | 'restored' | 'complete'

export type StatusTone = 'neutral' | 'info' | 'warning' | 'error' | 'success'

export interface ReconstructionStatus {
  id: ReconstructionStatusId
  title: string
  detail: string
  tone: StatusTone
  /** Exports are only meaningful with geometry behind them. */
  canExport: boolean
}

export interface StatusInput {
  processingComplete: boolean
  isProcessing: boolean
  hasMetrics: boolean
  pointCount: number
  objectCount: number
  restoredFromSession: boolean
}

export function deriveReconstructionStatus(input: StatusInput): ReconstructionStatus {
  const { processingComplete, isProcessing, hasMetrics, pointCount, objectCount, restoredFromSession } = input
  const objects = `${objectCount} grounded object${objectCount === 1 ? '' : 's'}`
  const points = `${pointCount.toLocaleString()} points`

  if (!hasMetrics && !processingComplete && !isProcessing && pointCount === 0) {
    return {
      id: 'empty', tone: 'neutral', canExport: false,
      title: 'No reconstruction yet',
      detail: 'Upload drone footage and flight metadata to generate a model. Nothing has been processed in this session.',
    }
  }

  if (!hasMetrics && isProcessing) {
    return {
      id: 'running', tone: 'info', canExport: false,
      title: 'Reconstruction in progress',
      detail: 'The pipeline is still running. Results appear here when every step has completed — you can follow progress on the processing page.',
    }
  }

  if (!hasMetrics) {
    return {
      id: 'incomplete', tone: 'error', canExport: false,
      title: 'Reconstruction did not produce a model',
      detail: 'The pipeline stopped before generating geometry, so there are no metrics to report. Re-run the upload, and check that the grounding worker is reachable if you are running in worker mode.',
    }
  }

  if (pointCount === 0) {
    return {
      id: 'partial', tone: 'warning', canExport: false,
      title: 'Metrics restored without geometry',
      detail: 'This session restored the run summary but not the point cloud — it was too large for browser session storage. The numbers below describe the original run; exports and the 3D viewer need the geometry, so re-run the upload to get them back.',
    }
  }

  if (restoredFromSession) {
    return {
      id: 'restored', tone: 'success', canExport: true,
      title: `Restored from this session — ${points}, ${objects}`,
      detail: 'This browser tab restored the finished model instead of recomputing it. The model is the same one generated from your upload, not a new run.',
    }
  }

  return {
    id: 'complete', tone: 'success', canExport: true,
    title: `Reconstruction complete — ${points}, ${objects}`,
    detail: 'Generated from LocateAnything-3B detections projected through your flight metadata. Fine surface detail between detected objects is synthesized.',
  }
}

export type MetricBasis = 'measured' | 'estimated'

export interface MetricEntry {
  id: string
  label: string
  value: string
  note: string
}

export interface MetricGroups {
  measured: MetricEntry[]
  estimated: MetricEntry[]
}

export interface MetricInput {
  metrics: ReconstructionMetrics | null
  trackedObjects: readonly TrackedObject[]
}

export function totalObservations(objects: readonly TrackedObject[]): number {
  return objects.reduce((sum, o) => sum + (o.observations ?? 0), 0)
}

/**
 * Split the run summary into what was observed in the input and what the
 * pipeline synthesized. Anything derived from the synthesis step (point counts,
 * coverage, confidence weights) is an estimate, however precise it looks.
 */
export function buildMetricGroups(input: MetricInput): MetricGroups {
  const { metrics, trackedObjects } = input
  if (!metrics) return { measured: [], estimated: [] }

  const observations = totalObservations(trackedObjects)
  const perObject = trackedObjects.length > 0 ? observations / trackedObjects.length : 0

  const measured: MetricEntry[] = [
    {
      id: 'groundedObjects', label: 'Grounded objects',
      value: metrics.groundedObjects,
      note: metrics.groundedLabels === 'none detected'
        ? 'nothing detected in the sampled keyframes'
        : `classes detected: ${metrics.groundedLabels}`,
    },
    {
      id: 'observations', label: 'Keyframe observations',
      value: observations > 0 ? String(observations) : 'n/a',
      note: observations > 0
        ? `${perObject.toFixed(1)} per object on average, before fusion`
        : 'no detections were projected onto the ground plane',
    },
    {
      id: 'sampledKeyframes', label: 'Keyframes sampled',
      // Persisted metrics from an earlier session may predate this field.
      value: metrics.keyframesSampled ?? 'n/a',
      note: 'frames sent to the grounding model for this pass',
    },
  ]

  const estimated: MetricEntry[] = [
    {
      id: 'totalPoints', label: 'Generated points',
      value: metrics.totalPoints,
      note: 'density between detections is synthesized, not measured',
    },
    {
      id: 'confidence', label: 'Mean point confidence',
      value: metrics.confidenceScore,
      note: 'weighted sample confidence — not a calibrated accuracy',
    },
    {
      id: 'coverage', label: 'Coverage estimate',
      value: metrics.coverage,
      note: 'heuristic share of the detected corridor',
    },
    {
      id: 'accuracy', label: 'Survey accuracy',
      value: metrics.accuracy,
      note: 'a single pass gives no stereo baseline, so no accuracy claim is made',
    },
  ]

  return { measured, estimated }
}

/** Distinct keyframes that contributed a detection, or 0 when none did. */
export function contributingKeyframes(objects: readonly TrackedObject[]): number {
  const frames = new Set<number>()
  for (const o of objects) {
    const hits = Array.isArray(o.hits) && o.hits.length > 0 ? o.hits : [o.best]
    for (const hit of hits) frames.add(hit.keyframeIndex)
  }
  return frames.size
}

export interface ObjectObservation {
  keyframeIndex: number
  score: number
  viewingAltitude: number
  offsetMeters: number
  halfExtentX: number
  halfExtentY: number
}

/**
 * The evidence behind a fused object: every contributing keyframe detection, with
 * how far its ground position sat from the fused centre. This is what the viewer
 * shows when an object is selected.
 */
export function objectObservations(object: TrackedObject): ObjectObservation[] {
  const hits = Array.isArray(object.hits) && object.hits.length > 0 ? object.hits : [object.best]
  return hits.map((hit) => ({
    keyframeIndex: hit.keyframeIndex,
    score: hit.score,
    viewingAltitude: hit.viewingAltitude,
    offsetMeters: Math.hypot(hit.center.x - object.center.x, hit.center.y - object.center.y),
    halfExtentX: hit.halfExtentX,
    halfExtentY: hit.halfExtentY,
  }))
}
