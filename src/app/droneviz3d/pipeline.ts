/**
 * Processing Pipeline — deep module orchestrating 3D reconstruction steps.
 * The UI subscribes to step updates; the adapter decides HOW processing happens.
 *
 * The pipeline is driven by NVIDIA LocateAnything-3B semantic grounding: keyframes
 * are grounded into labeled boxes, boxes are projected to the ground plane through
 * the camera model, and the 3D model is generated from those grounded objects.
 */

// Step Definitions (must come first for StepId inference)
//
// Every stage listed here is one the pipeline actually performs. There is
// deliberately no mesh/triangulation stage and no glTF or GeoTIFF output: the
// pipeline synthesizes a point cloud only, and exporter.ts can serialize it as
// PLY, OBJ or CSV. Naming a stage the code does not run is how a demo starts
// describing artifacts that were never generated.
export const STEP_DEFINITIONS = [
  { id: 'extract', name: 'Frame Extraction', detail: 'Sampling keyframes along the single flight pass', tool: 'Keyframe planner' },
  { id: 'grounding', name: 'Semantic Grounding', detail: 'LocateAnything-3B grounding of buildings, vehicles, trees per keyframe', tool: 'LocateAnything-3B (PBD)' },
  { id: 'projection', name: 'Ground Projection', detail: 'Projecting detected boxes to world coordinates via camera model', tool: 'Pinhole + ENU' },
  { id: 'tracking', name: 'Multi-view Tracking', detail: 'Deduplicating detections across keyframes with score fusion', tool: 'Corroboration fusion' },
  { id: 'heightfield', name: 'Height Field', detail: 'Rasterizing grounded objects into an illustrative height field', tool: '1.5 m grid' },
  { id: 'pointcloud', name: 'Point Cloud Generation', detail: 'Sampling classified 3D points from the height field (surface detail synthesized)', tool: 'Height-field sampling' },
  { id: 'confidence', name: 'Confidence Scoring', detail: 'Per-point weight from the detection heuristic + corroboration — not a calibrated probability', tool: 'Heuristic fusion' },
  { id: 'georef', name: 'Georeferencing', detail: 'Mapping local ENU coordinates to WGS84 lat/lng', tool: 'Equirectangular' },
  { id: 'export', name: 'Package Result', detail: 'Preparing the point cloud for PLY / OBJ / CSV download', tool: 'Client-side exporters' },
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

/**
 * Stages inside `reconstruct()`, in the order it performs them. The store maps
 * each one onto its `StepId` so the progress display advances because a stage
 * finished, not because a timer elapsed.
 */
export const RECONSTRUCT_STAGES = [
  'projection', 'tracking', 'heightfield', 'pointcloud', 'confidence', 'georef',
] as const
export type ReconstructStage = (typeof RECONSTRUCT_STAGES)[number]

export const STEP_META: Record<StepId, { tool: string; detail: string }> = Object.fromEntries(
  STEP_DEFINITIONS.map((s) => [s.id, { tool: s.tool, detail: s.detail }])
) as Record<StepId, { tool: string; detail: string }>

// There is deliberately no timer-driven "demo adapter" here any more. It used to
// animate every step to 100% on a fixed schedule while the real work happened
// afterwards in one lump, so a finished animation implied an artifact even when
// the grounding call had failed. Steps are now advanced by the store as each
// real operation completes — see store.runPipeline.

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
