/**
 * Processing Pipeline — deep module orchestrating 3D reconstruction steps.
 * The UI subscribes to step updates; the adapter decides HOW processing happens.
 */

// Step Definitions (must come first for StepId inference)
export const STEP_DEFINITIONS = [
  { id: 'extract', name: 'Frame Extraction', detail: 'Extracting keyframes from video stream', tool: 'OpenCV + FFmpeg' },
  { id: 'features', name: 'Feature Detection', detail: 'Detecting ORB/SIFT features per frame', tool: 'SuperPoint + ORB' },
  { id: 'slam', name: 'Visual SLAM', detail: 'Tracking camera trajectory via ORB-SLAM3', tool: 'ORB-SLAM3' },
  { id: 'sfm', name: 'Structure from Motion', detail: 'Bundle adjustment and sparse reconstruction', tool: 'COLMAP' },
  { id: 'depth', name: 'Depth Estimation', detail: 'AI monocular depth + NeRF/3DGS inference', tool: 'NeRF + 3DGS' },
  { id: 'pointcloud', name: 'Point Cloud Fusion', detail: 'Merging depth maps with Kalman filter fusion', tool: 'Kalman Filter' },
  { id: 'mesh', name: 'Mesh Reconstruction', detail: 'Poisson surface reconstruction + hole filling', tool: 'Poisson + Open3D' },
  { id: 'texture', name: 'Texture Mapping', detail: 'Projecting video frames onto mesh UV space', tool: 'UV Projection' },
  { id: 'confidence', name: 'Confidence Scoring', detail: 'Per-pixel reliability assessment', tool: 'Bayesian' },
  { id: 'export', name: 'Export & Package', detail: 'Generating OBJ/PLY/GLTF + orthophoto', tool: 'glTF + GeoTIFF' },
] as const

// Types
export type StepId = (typeof STEP_DEFINITIONS)[number]['id']
export type StepStatus = 'pending' | 'running' | 'complete' | 'error'

export interface StepStatePending { status: 'pending'; progress: 0 }
export interface StepStateRunning { status: 'running'; progress: number; duration?: never; errorMessage?: never }
export interface StepStateComplete { status: 'complete'; progress: 100; duration: number; errorMessage?: never }
export interface StepStateError { status: 'error'; progress: number; duration?: never; errorMessage: string }
export type StepState = StepStatePending | StepStateRunning | StepStateComplete | StepStateError

export interface PipelineStep {
  id: StepId; name: string; detail: string; tool: string; state: StepState
}

export type StepUpdate =
  | { stepId: StepId; status: 'pending' }
  | { stepId: StepId; status: 'running'; progress: number }
  | { stepId: StepId; status: 'complete'; duration: number }
  | { stepId: StepId; status: 'error'; errorMessage: string }

export interface PipelineConfig {
  stepDurations: number[]
  onUpdate: (update: StepUpdate) => void
  onComplete: () => void
}

export const STEP_META: Record<StepId, { tool: string; detail: string }> = Object.fromEntries(
  STEP_DEFINITIONS.map((s) => [s.id, { tool: s.tool, detail: s.detail }])
) as Record<StepId, { tool: string; detail: string }>

// Generic adapter interface
export type PipelineAdapter<TConfig = PipelineConfig> = (config: TConfig) => void

export function createDemoAdapter(): PipelineAdapter {
  return (config: PipelineConfig) => {
    const { stepDurations, onUpdate, onComplete } = config
    let totalDelay = 0
    STEP_DEFINITIONS.forEach((step, i) => {
      const baseDelay = totalDelay
      const duration = stepDurations[i] || 1000
      totalDelay += duration
      setTimeout(() => { onUpdate({ stepId: step.id, status: 'running', progress: 0 }) }, baseDelay)
      for (let t = 1; t <= 8; t++) {
        setTimeout(() => { onUpdate({ stepId: step.id, status: 'running', progress: Math.floor((t / 8) * 100) }) }, baseDelay + (duration * t) / 8)
      }
      setTimeout(() => { onUpdate({ stepId: step.id, status: 'complete', duration }) }, baseDelay + duration)
    })
    setTimeout(onComplete, totalDelay + 500)
  }
}

export const DEFAULT_DURATIONS = [800, 1200, 1500, 2000, 2500, 1800, 2200, 1500, 1000, 800]

export function createInitialSteps(): PipelineStep[] {
  return STEP_DEFINITIONS.map((def) => ({
    id: def.id, name: def.name, detail: def.detail, tool: def.tool,
    state: { status: 'pending' as const, progress: 0 },
  }))
}

// Type Guards
export function isPending(s: StepState): s is StepStatePending { return s.status === 'pending' }
export function isRunning(s: StepState): s is StepStateRunning { return s.status === 'running' }
export function isComplete(s: StepState): s is StepStateComplete { return s.status === 'complete' }
export function isError(s: StepState): s is StepStateError { return s.status === 'error' }
export function getProgress(s: StepState): number { return s.progress }
