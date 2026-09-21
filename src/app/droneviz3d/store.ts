import { create } from 'zustand'
import { persist, PersistStorage, StorageValue } from 'zustand/middleware'
import {
  PipelineStep, StepUpdate,
  createInitialSteps, createDemoAdapter, DEFAULT_DURATIONS,
} from './pipeline'
import {
  Point3D, ReconstructionPose, ConfidenceAnnotation, ReconstructionMetrics,
  reconstruct, ReconstructOutput,
} from './reconstruct'
import {
  createSimulatedLocateAnythingAdapter, createLocateAnythingAdapter,
  extractKeyframes, planKeyframes, GroundingResponse,
} from './grounding'
import {
  RawFlightData, validateFlightData, ValidationResult,
} from './validator'

export type { PipelineStep, StepId, StepUpdate } from './pipeline'
export type { Point3D, ReconstructionPose, ConfidenceAnnotation, ReconstructionMetrics } from './reconstruct'
export { STEP_META, isRunning, isComplete, isError, isPending, getProgress, STEP_DEFINITIONS } from './pipeline'

/**
 * Grounding backend: `worker` sends real keyframes to the LocateAnything-3B
 * worker via /api/ground (requires WORKER_TOKEN + a running worker); anything
 * else uses the deterministic simulated adapter. The token itself is never
 * exposed to the browser — only this public mode flag is inlined client-side.
 */
export const WORKER_MODE = process.env.NEXT_PUBLIC_GROUNDING_MODE === 'worker'

export interface FlightMetadata {
  gpsLat: string; gpsLng: string; altitude: string; speed: string; heading: string
  timestamp: string; cameraFocalLength: string; cameraWidth: string; cameraHeight: string
  imuData: boolean; barometricAlt: boolean; rtkCorrections: boolean
}

export interface DroneVizState {
  videoFile: File | null; videoPreview: string | null; videoDurationSec: number
  /** file name only — survives reloads (the File object itself cannot) */
  videoName: string | null
  metadata: FlightMetadata; validationErrors: string[]
  steps: PipelineStep[]; currentStep: number; isProcessing: boolean; processingComplete: boolean
  pointCloud: Point3D[]; trajectory: ReconstructionPose[]; annotations: ConfidenceAnnotation[]
  metrics: ReconstructionMetrics | null
  trackedObjects: ReconstructOutput['trackedObjects']
  bounds: ReconstructOutput['bounds'] | null
  /** user consent to process the uploaded video + metadata (required to start) */
  dataConsent: boolean
  /**
   * Set once when a finished reconstruction is rehydrated from this browser's
   * storage. Never persisted: it describes where the data came from, not the
   * data. The results page uses it to say so instead of implying a fresh run.
   */
  restoredFromStorage: boolean
  markRestored: () => void
  /**
   * True once storage rehydration has settled (or is known to be empty).
   * Never persisted. Page guards must wait for this before deciding that there is
   * no model — otherwise a hard load of a viewer/results URL races rehydration
   * and bounces the user to Upload even though their model is still stored.
   */
  hydrated: boolean
  markHydrated: () => void
  setVideoFile: (file: File) => void
  setVideoDuration: (sec: number) => void
  setMetadata: (meta: Partial<FlightMetadata>) => void
  setDataConsent: (consent: boolean) => void
  validateAndStart: () => boolean
  updateStep: (update: StepUpdate) => void
  completeProcessing: () => void
  completeProcessingWith: (out: ReconstructOutput) => void
  reset: () => void
}

const initialMetadata: FlightMetadata = {
  gpsLat: '28.6139', gpsLng: '77.2090', altitude: '120', speed: '8', heading: '0',
  timestamp: new Date().toISOString().slice(0, 19),
  cameraFocalLength: '24', cameraWidth: '3840', cameraHeight: '2160',
  imuData: false, barometricAlt: false, rtkCorrections: false,
}

// ---------------------------------------------------------------------------
// Browser-local persistence for the finished reconstruction
//
// localStorage rather than sessionStorage: a guest has no account to come back
// to, so the model has to outlive the tab or "come back to your model" means
// nothing. The cost is that it now stays on the device until the user removes
// it — so Reset deletes the stored entry outright instead of only blanking the
// in-memory state, and the privacy and cookies policies describe it. See the
// erasure and withdrawal sections there before weakening that.
//
// localStorage is shared by every tab of this origin, so two tabs see the same
// model. That matches the app, which keeps one reconstruction per visit.
// ---------------------------------------------------------------------------

const PERSIST_KEY = 'droneviz3d-model'
/**
 * localStorage gives ~5 MB per origin, shared with any other keys this site
 * uses; keep headroom so one write can never be the reason another fails.
 */
const MAX_PERSISTED_BYTES = 3_500_000

type PersistedSlice = Pick<
  DroneVizState,
  | 'processingComplete' | 'pointCloud' | 'trajectory' | 'annotations'
  | 'metrics' | 'trackedObjects' | 'bounds' | 'videoName'
  | 'videoDurationSec' | 'metadata'
>

/**
 * Points are stored as one flat array of integers — x/y/z in millimeters,
 * confidence in 0.001 — instead of an array of {x,y,z,r,g,b,confidence}
 * objects. Same fidelity to the millimeter, roughly a third of the JSON size,
 * so the default ~12k-point demo model lands around half a megabyte — well
 * inside the budget below, with room for a considerably larger flight.
 */
function normalizeState(state: Record<string, unknown>): Record<string, unknown> {
  const pts = state.pointCloud as Point3D[] | undefined
  if (!Array.isArray(pts) || pts.length === 0) return state
  const flat: number[] = new Array(pts.length * 7)
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const o = i * 7
    flat[o] = Math.round(p.x * 1000)
    flat[o + 1] = Math.round(p.y * 1000)
    flat[o + 2] = Math.round(p.z * 1000)
    flat[o + 3] = Math.round(p.r)
    flat[o + 4] = Math.round(p.g)
    flat[o + 5] = Math.round(p.b)
    flat[o + 6] = Math.round(p.confidence * 1000)
  }
  return { ...state, pointCloud: flat }
}

function denormalizeState(state: Record<string, unknown>): Record<string, unknown> {
  const flat = state.pointCloud as unknown
  if (!Array.isArray(flat) || flat.length === 0) return state
  // Already object form (e.g. written by an older version) — pass through.
  if (typeof flat[0] === 'object') return state
  const pts: Point3D[] = []
  for (let i = 0; i + 6 < flat.length; i += 7) {
    pts.push({
      x: flat[i] / 1000, y: flat[i + 1] / 1000, z: flat[i + 2] / 1000,
      r: Math.round(flat[i + 3]), g: Math.round(flat[i + 4]), b: Math.round(flat[i + 5]),
      confidence: flat[i + 6] / 1000,
    })
  }
  return { ...state, pointCloud: pts }
}

/**
 * Storage adapter: quantizes on write, restores on read. If a model exceeds the
 * budget the point cloud is dropped — with a console warning, and with the
 * results page saying so — rather than throwing a QuotaExceededError, so the
 * metrics, trajectory and annotations still come back.
 *
 * Nothing is written until there is a finished model to write. The middleware
 * calls `setItem` on every state change, and a visitor who merely opens the
 * upload form has a draft, not a model — persisting that would contradict the
 * policies (which describe one entry holding your generated model) and would mean
 * the browser holds flight metadata for someone who never generated anything.
 * So a draft *removes* the entry instead: the stored state is either a real
 * finished model or absent, and a one-click Reset stays exactly what it says.
 *
 * `window` is null-checked so module evaluation during SSR can never throw; on
 * the server there is simply no storage.
 */
const browserStorage = typeof window !== 'undefined' ? window.localStorage : null

const browserStore: PersistStorage<DroneVizState> = {
  getItem: (name) => {
    if (!browserStorage) return null
    const raw = browserStorage.getItem(name)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as StorageValue<DroneVizState>
      if (parsed?.state) parsed.state = denormalizeState(parsed.state as unknown as Record<string, unknown>) as unknown as DroneVizState
      return parsed
    } catch {
      return null // corrupt entry — treat as absent
    }
  },
  setItem: (name, value) => {
    if (!browserStorage) return
    try {
      const state = value.state as unknown as Record<string, unknown>
      if (state.processingComplete !== true) {
        browserStorage.removeItem(name)
        return
      }
      const points = state.pointCloud as Point3D[] | undefined
      const normalized = { ...value, state: normalizeState(state) }
      const serialized = JSON.stringify(normalized)
      if (serialized.length > MAX_PERSISTED_BYTES && Array.isArray(points) && points.length > 0) {
        console.warn('[DroneViz3D] Model too large to keep in this browser — the point cloud will not come back on your next visit.')
        browserStorage.setItem(name, JSON.stringify({ ...normalized, state: { ...state, pointCloud: [] } }))
        return
      }
      browserStorage.setItem(name, serialized)
    } catch {
      // Quota exceeded or storage disabled: the model simply won't persist.
      try { browserStorage.removeItem(name) } catch { /* ignore */ }
    }
  },
  removeItem: (name) => {
    if (browserStorage) browserStorage.removeItem(name)
  },
}

/** Validate + rebuild the persisted slice so corrupt/old data cannot crash pages. */
function sanitizePersisted(persisted: unknown): Partial<PersistedSlice> {
  const s = (persisted ?? {}) as Partial<PersistedSlice>
  const out: Partial<PersistedSlice> = {}
  if (s.processingComplete === true) out.processingComplete = true
  if (Array.isArray(s.pointCloud)) {
    out.pointCloud = (s.pointCloud as Point3D[]).filter(
      (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && Number.isFinite(p.confidence)
    )
  }
  if (Array.isArray(s.trajectory)) out.trajectory = s.trajectory
  if (Array.isArray(s.annotations)) out.annotations = s.annotations
  if (s.metrics && typeof s.metrics === 'object') out.metrics = s.metrics
  if (Array.isArray(s.trackedObjects)) out.trackedObjects = s.trackedObjects
  if (s.bounds && typeof s.bounds === 'object') out.bounds = s.bounds
  if (typeof s.videoName === 'string') out.videoName = s.videoName
  if (typeof s.videoDurationSec === 'number' && Number.isFinite(s.videoDurationSec)) out.videoDurationSec = s.videoDurationSec
  if (s.metadata && typeof s.metadata === 'object') out.metadata = s.metadata
  return out
}

export const useDroneVizStore = create<DroneVizState>()(
  persist<DroneVizState>(
    (set, get) => ({
      videoFile: null, videoPreview: null, videoDurationSec: 0, videoName: null,
      metadata: initialMetadata, validationErrors: [],
      steps: createInitialSteps(), currentStep: 0, isProcessing: false, processingComplete: false,
      pointCloud: [], trajectory: [], annotations: [], metrics: null,
      trackedObjects: [], bounds: null,
      dataConsent: false,
      restoredFromStorage: false,
      hydrated: false,

      markRestored: () => set({ restoredFromStorage: true }),
      markHydrated: () => set({ hydrated: true }),

      setVideoFile: (file) => {
        const preview = URL.createObjectURL(file)
        set({ videoFile: file, videoPreview: preview, videoName: file.name, validationErrors: [] })
      },
      // Some video files (e.g. MediaRecorder webm) report duration = Infinity until
      // decoded; clamp so it can never poison downstream math.
      setVideoDuration: (sec) => set({ videoDurationSec: Number.isFinite(sec) ? Math.max(0, sec) : 0 }),
      setMetadata: (meta) => set((s) => ({ metadata: { ...s.metadata, ...meta }, validationErrors: [] })),
      setDataConsent: (consent) =>
        set((s) => ({
          dataConsent: consent,
          // The consent message is about the control the user just used, so it
          // must not outlive the fix that clears it. Unrelated validation errors
          // stay until they are addressed.
          validationErrors: consent
            ? s.validationErrors.filter((message) => !/consent/i.test(message))
            : s.validationErrors,
        })),

      validateAndStart: () => {
        const { metadata, videoFile, videoDurationSec, dataConsent } = get()
        if (!videoFile) { set({ validationErrors: ['Please upload a video file'] }); return false }
        if (!dataConsent) {
          set({ validationErrors: ['Please consent to on-device processing before starting (see the consent checkbox below the form)'] })
          return false
        }
        const result: ValidationResult = validateFlightData(metadata as RawFlightData)
        if (!result.ok) { set({ validationErrors: result.errors.map((e) => e.message) }); return false }

        // A new run is by definition fresh, even if the previous model came back
        // from this browser's storage.
        set({ validationErrors: [], isProcessing: true, processingComplete: false, steps: createInitialSteps(), currentStep: 0, restoredFromStorage: false })

        // Stage 1: staged pipeline visualization. Stage 2 (onComplete): real
        // reconstruction driven by LocateAnything-3B detections.
        const pipeline = createDemoAdapter()
        pipeline({
          stepDurations: DEFAULT_DURATIONS,
          onUpdate: (u) => get().updateStep(u),
          onComplete: () => {
            const durationSec = videoDurationSec > 0 ? videoDurationSec : 180
            const keyframePlan = planKeyframes(durationSec)
            const flightParams = {
              gpsLat: result.data.gpsLat, gpsLng: result.data.gpsLng,
              altitude: result.data.altitude, speed: result.data.speed,
              heading: result.data.heading, durationSec,
              rtkCorrections: result.data.rtkCorrections,
            }
            const simulate = () => {
              const adapter = createSimulatedLocateAnythingAdapter(flightParams)
              return adapter(
                keyframePlan.times.map((_, i) => ({
                  image: new Blob(), keyframeIndex: i, labels: ['building', 'vehicle', 'tree'],
                }))
              )
            }
            const run = async () => {
              let responses: GroundingResponse[]
              if (WORKER_MODE) {
                try {
                  // Real LocateAnything-3B: extract actual keyframes from the video
                  // in the browser, then ground them via the proxy route (the
                  // worker token stays server-side).
                  const frames = await extractKeyframes(
                    videoFile,
                    keyframePlan.times.map((t) => t * durationSec)
                  )
                  responses = await createLocateAnythingAdapter()(
                    frames.map((image, i) => ({
                      image, keyframeIndex: i, labels: ['building', 'vehicle', 'tree'],
                    }))
                  )
                } catch (err) {
                  // Worker unreachable / not configured: keep the demo usable and
                  // be loud about why the output is simulated.
                  console.warn('[DroneViz3D] LocateAnything worker grounding failed — falling back to the simulated adapter:', err)
                  responses = await simulate()
                }
              } else {
                responses = await simulate()
              }
              const out = reconstruct({
                flight: result.data, videoDurationSec: durationSec,
                grounding: responses, keyframePlan,
              })
              get().completeProcessingWith(out)
            }
            run().catch(() => get().completeProcessing())
          },
        })
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

      completeProcessingWith: (out) => set({
        isProcessing: false, processingComplete: true,
        pointCloud: out.points, trajectory: out.trajectory, annotations: out.annotations,
        metrics: out.metrics, trackedObjects: out.trackedObjects, bounds: out.bounds,
      }),

      completeProcessing: () => set({ isProcessing: false, processingComplete: true }),

      reset: () => {
        set({
          videoFile: null, videoPreview: null, videoDurationSec: 0, videoName: null,
          metadata: initialMetadata, validationErrors: [],
          steps: createInitialSteps(), currentStep: 0, isProcessing: false, processingComplete: false,
          pointCloud: [], trajectory: [], annotations: [], metrics: null,
          trackedObjects: [], bounds: null, restoredFromStorage: false,
          // Keep the user's consent decision; it is per-browser, not per-upload.
        })
        // The write above already drops the entry (nothing is stored without a
        // finished model), but delete the key explicitly as well. Both policies
        // tell the user Reset erases their data from this browser, so the key must
        // not depend on that rule continuing to hold.
        browserStore.removeItem(PERSIST_KEY)
      },
    }),
    {
      name: PERSIST_KEY,
      version: 1,
      // Only the finished reconstruction survives reloads — never the video
      // File, the blob URL, or mid-pipeline progress.
      // Runtime: persist merges this subset over the initial state. The cast is
      // only because zustand types partialize as returning the full state.
      partialize: (s) => ({
        processingComplete: s.processingComplete,
        pointCloud: s.pointCloud,
        trajectory: s.trajectory,
        annotations: s.annotations,
        metrics: s.metrics,
        trackedObjects: s.trackedObjects,
        bounds: s.bounds,
        videoName: s.videoName,
        videoDurationSec: s.videoDurationSec,
        metadata: s.metadata,
      }) as unknown as DroneVizState,
      migrate: (persisted) => sanitizePersisted(persisted) as unknown as DroneVizState,
      storage: browserStore,
      // Rehydration runs on the client. If a finished model came back, flag it so
      // the UI can be explicit about the source, and record that hydration is
      // done so guards can stop deferring.
      onRehydrateStorage: () => (state) => {
        if (!state) return
        if (state.processingComplete && (state.pointCloud.length > 0 || state.metrics)) {
          state.markRestored()
        }
        state.markHydrated()
      },
    }
  )
)