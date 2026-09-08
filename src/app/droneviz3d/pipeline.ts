/**
 * Processing Pipeline — deep module orchestrating 3D reconstruction steps.
 * The UI subscribes to step updates; the adapter decides HOW processing happens.
 *
 * The pipeline is driven by NVIDIA LocateAnything-3B semantic grounding: keyframes
 * are grounded into labeled boxes, boxes are projected to the ground plane through
 * the camera model, and the 3D model is generated from those grounded objects.
 */

// Step Definitions (must come first for StepId inference)
export const STEP_DEFINITIONS = [
  { id: 'extract', name: 'Frame Extraction', detail: 'Sampling keyframes along the single flight pass', tool: 'Keyframe planner' },
  { id: 'grounding', name: 'Semantic Grounding', detail: 'LocateAnything-3B grounding of buildings, vehicles, trees per keyframe', tool: 'LocateAnything-3B (PBD)' },
  { id: 'projection', name: 'Ground Projection', detail: 'Projecting detected boxes to world coordinates via camera model', tool: 'Pinhole + ENU' },
  { id: 'tracking', name: 'Multi-view Tracking', detail: 'Deduplicating detections across keyframes with score fusion', tool: 'Corroboration fusion' },
  { id: 'heightfield', name: 'Height Field', detail: 'Rasterizing grounded objects into a georeferenced height field', tool: '1.5 m grid' },
  { id: 'pointcloud', name: 'Point Cloud Generation', detail: 'Synthesizing classified, confidence-weighted 3D points', tool: 'Height-field sampling' },
  { id: 'mesh', name: 'Mesh Reconstruction', detail: 'Triangulating surfaces and filling gaps between objects', tool: 'Grid triangulation' },
  { id: 'confidence', name: 'Confidence Scoring', detail: 'Per-point reliability from grounding score + corroboration', tool: 'Score fusion' },
  { id: 'georef', name: 'Georeferencing', detail: 'Mapping local ENU coordinates to WGS84 lat/lng', tool: 'Equirectangular' },
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

export const DEFAULT_DURATIONS = [800, 1400, 900, 1000, 1100, 1600, 1300, 900, 900, 800]

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
