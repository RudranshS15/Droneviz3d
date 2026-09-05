import { create } from 'zustand'
import {
  PipelineStep, StepId, StepUpdate, STEP_DEFINITIONS,
  createInitialSteps, createDemoAdapter, DEFAULT_DURATIONS,
  isRunning, isComplete, isError, isPending, getProgress,
} from './pipeline'
import {
  Point3D, CameraPose, ConfidenceAnnotation, PointCloudResult, createMockAdapter,
} from './pointcloud'
import {
  RawFlightData, validateFlightData, ValidationResult,
} from './validator'

export type { PipelineStep, StepId, StepUpdate } from './pipeline'
export type { Point3D, CameraPose, ConfidenceAnnotation } from './pointcloud'
export { STEP_META, isRunning, isComplete, isError, isPending, getProgress, STEP_DEFINITIONS } from './pipeline'

export interface FlightMetadata {
  gpsLat: string; gpsLng: string; altitude: string; speed: string; heading: string
  timestamp: string; cameraFocalLength: string; cameraWidth: string; cameraHeight: string
  imuData: boolean; barometricAlt: boolean; rtkCorrections: boolean
}

export interface DroneVizState {
  videoFile: File | null; videoPreview: string | null; metadata: FlightMetadata; validationErrors: string[]
  steps: PipelineStep[]; currentStep: number; isProcessing: boolean; processingComplete: boolean
  pointCloud: Point3D[]; trajectory: CameraPose[]; annotations: ConfidenceAnnotation[]
  meshVertices: Float32Array | null; meshColors: Float32Array | null; confidenceMap: number[]
  metrics: PointCloudResult['metrics'] | null
  setVideoFile: (file: File) => void; setMetadata: (meta: Partial<FlightMetadata>) => void
  validateAndStart: () => boolean; updateStep: (update: StepUpdate) => void
  completeProcessing: () => void; reset: () => void
}

const initialMetadata: FlightMetadata = {
  gpsLat: '28.6139', gpsLng: '77.2090', altitude: '120', speed: '8', heading: '0',
  timestamp: new Date().toISOString().slice(0, 19),
  cameraFocalLength: '24', cameraWidth: '3840', cameraHeight: '2160',
  imuData: false, barometricAlt: false, rtkCorrections: false,
}

export const useDroneVizStore = create<DroneVizState>((set, get) => ({
  videoFile: null, videoPreview: null, metadata: initialMetadata, validationErrors: [],
  steps: createInitialSteps(), currentStep: 0, isProcessing: false, processingComplete: false,
  pointCloud: [], trajectory: [], annotations: [],
  meshVertices: null, meshColors: null, confidenceMap: [], metrics: null,

  setVideoFile: (file) => {
    const preview = URL.createObjectURL(file)
    set({ videoFile: file, videoPreview: preview, validationErrors: [] })
  },
  setMetadata: (meta) => set((s) => ({ metadata: { ...s.metadata, ...meta }, validationErrors: [] })),
  validateAndStart: () => {
    const { metadata, videoFile } = get()
    if (!videoFile) { set({ validationErrors: ['Please upload a video file'] }); return false }
    const result: ValidationResult = validateFlightData(metadata as RawFlightData)
    if (!result.ok) { set({ validationErrors: result.errors.map((e) => e.message) }); return false }
    set({ validationErrors: [], isProcessing: true, processingComplete: false, steps: createInitialSteps(), currentStep: 0 })
    const pipeline = createDemoAdapter()
    pipeline({ stepDurations: DEFAULT_DURATIONS, onUpdate: (u) => get().updateStep(u), onComplete: () => get().completeProcessing() })
    return true
  },
  updateStep: (update) => set((s) => ({
    steps: s.steps.map((step) => {
      if (step.id !== update.stepId) return step
      switch (update.status) {
        case 'pending': return { ...step, state: { status: 'pending' as const, progress: 0 } }
        case 'running': return { ...step, state: { status: 'running' as const, progress: update.progress } }
        case 'complete': return { ...step, state: { status: 'complete' as const, progress: 100, duration: update.duration } }
        case 'error': return { ...step, state: { status: 'error' as const, progress: step.state.progress, errorMessage: update.errorMessage } }
      }
    }),
  })),
  completeProcessing: () => {
    const factory = createMockAdapter()
    const { points, trajectory, annotations, metrics } = factory()
    set({ isProcessing: false, processingComplete: true, pointCloud: points, trajectory, annotations, metrics })
  },
  reset: () => set({
    videoFile: null, videoPreview: null, metadata: initialMetadata, validationErrors: [],
    steps: createInitialSteps(), currentStep: 0, isProcessing: false, processingComplete: false,
    pointCloud: [], trajectory: [], annotations: [],
    meshVertices: null, meshColors: null, confidenceMap: [], metrics: null,
  }),
}))
