import { create } from 'zustand'
import { persist, PersistStorage, StorageValue } from 'zustand/middleware'
import {
  PipelineStep, StepUpdate, StepId,
  createInitialSteps,
} from './pipeline'
import {
  Point3D, ReconstructionPose, ConfidenceAnnotation, ReconstructionMetrics,
  reconstruct, ReconstructOutput,
} from './reconstruct'
import {
  createSimulatedLocateAnythingAdapter, createLocateAnythingAdapter,
  extractKeyframes, planKeyframes, GroundingResponse, simulatedGroundingBasis,
} from './grounding'
import { fingerprintVideoFile } from './video-fingerprint'
import {
  RawFlightData, validateFlightData, ValidationResult,
} from './validator'
import { FlightParams } from './geometry'
import { trace } from './trace'

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
  /**
   * Set when the pipeline stops before producing a model, so the UI can show the
   * failure instead of an empty state. Null while a run is healthy.
   */
  pipelineError: string | null
  /**
   * Identity of the current run, minted when a run starts and cleared when a new
   * session begins. Persisted with the model so a restored entry can be told
   * apart from the run the draft in front of you would produce — and so the trace
   * lines can name which run a number belongs to.
   */
  jobId: string | null
  /**
   * Clear the previous reconstruction from memory *and* from this browser's
   * storage, without touching the flight-metadata draft or the consent decision.
   * Called when a different video is chosen and at the start of every run, so no
   * page can present the last run's model as the current one.
   */
  resetSession: () => void
  setVideoFile: (file: File) => void
  setVideoDuration: (sec: number) => void
  setMetadata: (meta: Partial<FlightMetadata>) => void
  setDataConsent: (consent: boolean) => void
  validateAndStart: () => boolean
  /**
   * Re-run from the grounding stage with the simulated adapter. Offered
   * explicitly after a worker failure — never substituted automatically, because
   * a simulated scene must not be presented as a real run.
   */
  runSimulatedDemo: () => void
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

export const PERSIST_KEY = 'droneviz3d-model'
/**
 * localStorage gives ~5 MB per origin, shared with any other keys this site
 * uses; keep headroom so one write can never be the reason another fails.
 */
const MAX_PERSISTED_BYTES = 3_500_000

type PersistedSlice = Pick<
  DroneVizState,
  | 'processingComplete' | 'pointCloud' | 'trajectory' | 'annotations'
  | 'metrics' | 'trackedObjects' | 'bounds' | 'videoName'
  | 'videoDurationSec' | 'metadata' | 'jobId'
>

/** One run's identity: time-ordered, short, and unique enough for a browser log. */
function newJobId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`
}

/**
 * The state every run starts from.
 *
 * Clearing the previous reconstruction here — and not only when a new file is
 * chosen — is what stops an in-flight or failed run from being described by the
 * last one's model and metrics. It is deliberately a single definition used by
 * both entry points, because the two drifting apart is how this bug happened.
 */
function freshRunState(): Partial<DroneVizState> {
  return {
    validationErrors: [], isProcessing: true, processingComplete: false, pipelineError: null,
    steps: createInitialSteps(), currentStep: 0, restoredFromStorage: false,
    pointCloud: [], trajectory: [], annotations: [], metrics: null,
    trackedObjects: [], bounds: null,
    jobId: newJobId(),
  }
}

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
      const slice = parsed?.state as unknown as Partial<DroneVizState> | undefined
      if (slice) parsed.state = denormalizeState(slice as unknown as Record<string, unknown>) as unknown as DroneVizState
      trace('storage', `read ${name}`, {
        found: true,
        complete: slice?.processingComplete === true,
        videoName: slice?.videoName ?? null,
        jobId: slice?.jobId ?? null,
      })
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
      trace('storage', `wrote ${name}`, {
        bytes: serialized.length,
        videoName: (state.videoName as string | null) ?? null,
        jobId: (state.jobId as string | null) ?? null,
        points: Array.isArray(points) ? points.length : 0,
      })
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
  if (typeof s.jobId === 'string') out.jobId = s.jobId
  if (typeof s.videoDurationSec === 'number' && Number.isFinite(s.videoDurationSec)) out.videoDurationSec = s.videoDurationSec
  if (s.metadata && typeof s.metadata === 'object') out.metadata = s.metadata
  return out
}

/** Zustand's setter, narrowed to the shape the pipeline runner uses. */
type StoreSet = (partial: Partial<DroneVizState>) => void
type StoreGet = () => DroneVizState

/** The step that runs after each `reconstruct` stage finishes. */
const AFTER_STAGE: Record<string, StepId> = {
  projection: 'tracking', tracking: 'heightfield', heightfield: 'pointcloud',
  pointcloud: 'confidence', confidence: 'georef', georef: 'export',
}

/**
 * Run the reconstruction pipeline, advancing each step only when the operation
 * it names returns.
 *
 * Previously a timer animation walked every step to 100% and the real work ran
 * afterwards in one lump, so a finished progress bar said nothing about whether
 * grounding had succeeded — and a worker failure was swallowed by a silent
 * fallback to the simulated adapter. Here every `await` is real work, every
 * `completeStep` is reachable only if that work returned, and a failure stops the
 * run and names the step that failed.
 */
async function runPipeline(
  set: StoreSet,
  get: StoreGet,
  { allowWorker }: { allowWorker: boolean }
): Promise<void> {
  // Which step is running, so a failure is attributed to the operation that
  // actually failed rather than to a fixed step.
  let current: StepId = 'extract'

  const startStep = (id: StepId, progress = 0) => {
    current = id
    get().updateStep({ stepId: id, status: 'running', progress })
  }
  const completeStep = (id: StepId, durationMs = 0) => {
    get().updateStep({ stepId: id, status: 'complete', duration: durationMs })
  }
  const failStep = (id: StepId, message: string) => {
    trace('pipeline', `run failed at ${id}`, { jobId: get().jobId, message })
    get().updateStep({ stepId: id, status: 'error', errorMessage: message })
    // processingComplete stays false: nothing was produced. The results page reads
    // `pipelineError` to say so, rather than looking like a fresh visit.
    set({ isProcessing: false, processingComplete: false, pipelineError: message })
  }

  const state = get()
  const validated: ValidationResult = validateFlightData(state.metadata as RawFlightData)
  if (!validated.ok) {
    failStep('extract', validated.errors.map((e) => e.message).join('; '))
    return
  }
  const videoFile = state.videoFile
  const durationSec = state.videoDurationSec > 0 ? state.videoDurationSec : 180
  const keyframePlan = planKeyframes(durationSec)
  const flightParams: FlightParams = {
    gpsLat: validated.data.gpsLat, gpsLng: validated.data.gpsLng,
    altitude: validated.data.altitude, speed: validated.data.speed,
    heading: validated.data.heading, durationSec,
    rtkCorrections: validated.data.rtkCorrections,
  }
  const labels = ['building', 'vehicle', 'tree'] as const
  const useWorker = allowWorker && WORKER_MODE
  // Read from the upload when there is one. The seed used to be the flight
  // metadata alone, so two clips flown over the same way produced identical
  // scenes and a genuinely fresh run was indistinguishable from a stale one.
  // Null only when there is no file to read: an honest fallback, not a silent one.
  let videoFingerprint: string | null = null
  let t0 = Date.now()

  try {
    // ---- 1. Frame extraction ----
    startStep('extract')
    let frames: Blob[] = []
    if (useWorker) {
      if (!videoFile) {
        throw new Error('The video file is no longer in this tab, so keyframes cannot be extracted. Re-upload the video to run worker-mode grounding.')
      }
      frames = await extractKeyframes(videoFile, keyframePlan.times.map((t) => t * durationSec))
    } else if (videoFile) {
      // Simulated mode reads the clip itself, not just the metadata, so two
      // different videos never reconstruct to the same scene. It is a few reads
      // of local bytes (never the whole file, nothing sent anywhere) and it is
      // what makes "upload a different video" actually change the result.
      videoFingerprint = (await fingerprintVideoFile(videoFile)).hex
    }
    completeStep('extract', Date.now() - t0)

    // ---- 2. Semantic grounding ----
    t0 = Date.now()
    startStep('grounding')
    let responses: GroundingResponse[]
    if (useWorker && frames.length > 0) {
      const adapter = createLocateAnythingAdapter()
      // Sent in bounded batches, so the progress shown is the progress sent.
      const BATCH = 6
      responses = []
      for (let i = 0; i < frames.length; i += BATCH) {
        const batch = frames.slice(i, i + BATCH)
        const part = await adapter(batch.map((image, j) => ({ image, keyframeIndex: i + j, labels: [...labels] })))
        responses.push(...part)
        get().updateStep({
          stepId: 'grounding', status: 'running',
          progress: Math.min(100, Math.round(((i + batch.length) / frames.length) * 100)),
        })
      }
    } else {
      responses = await createSimulatedLocateAnythingAdapter(flightParams, videoFingerprint)(
        keyframePlan.times.map((_, i) => ({ image: new Blob(), keyframeIndex: i, labels: [...labels] }))
      )
    }
    completeStep('grounding', Date.now() - t0)

    // ---- 3. Geometry, reported stage by stage as reconstruct finishes each ----
    t0 = Date.now()
    startStep('projection')
    const out = reconstruct({
      flight: validated.data,
      videoDurationSec: durationSec,
      grounding: responses,
      keyframePlan,
      onStage: (stage) => {
        completeStep(stage, Date.now() - t0)
        t0 = Date.now()
        const next = AFTER_STAGE[stage]
        if (next) startStep(next)
      },
    })
    // The export payload exists as soon as the result does. The keyframe count
    // and the simulated seed basis are measured inputs, not synthesis output, so
    // they are added to the metrics here rather than guessed at inside
    // reconstruct().
    completeStep('export', Date.now() - t0)
    get().completeProcessingWith({
      ...out,
      metrics: {
        ...out.metrics,
        keyframesExtracted: useWorker && frames.length > 0 ? String(frames.length) : 'n/a (no decode)',
        ...(out.groundingSource === 'simulated'
          ? { synthesisBasis: simulatedGroundingBasis(videoFingerprint) }
          : {}),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    failStep(current, useWorker
      ? `${message} The simulated demo can be run instead from the processing page.`
      : message)
  }
}

export const useDroneVizStore = create<DroneVizState>()(
  persist<DroneVizState>(
    (set, get) => ({
      videoFile: null, videoPreview: null, videoDurationSec: 0, videoName: null,
      metadata: initialMetadata, validationErrors: [],
      steps: createInitialSteps(), currentStep: 0, isProcessing: false, processingComplete: false,
      pipelineError: null,
      jobId: null,
      pointCloud: [], trajectory: [], annotations: [], metrics: null,
      trackedObjects: [], bounds: null,
      dataConsent: false,
      restoredFromStorage: false,
      hydrated: false,

      markRestored: () => set({ restoredFromStorage: true }),
      markHydrated: () => set({ hydrated: true }),

      resetSession: () => {
        set({
          pointCloud: [], trajectory: [], annotations: [], metrics: null,
          trackedObjects: [], bounds: null,
          steps: createInitialSteps(), currentStep: 0,
          isProcessing: false, processingComplete: false, pipelineError: null,
          restoredFromStorage: false, jobId: null,
          // The name and the duration belong to the clip that was measured, so the
          // next file starts from them being unknown rather than inheriting the
          // previous one's identity.
          videoName: null, videoDurationSec: 0,
          // Errors were about a run that no longer exists.
          validationErrors: [],
        })
        // Delete the stored entry outright. The write above already removes it —
        // nothing persists without a finished model — but the key must not depend
        // on that rule continuing to hold.
        browserStore.removeItem(PERSIST_KEY)
        trace('store', 'resetSession — previous model cleared', { removedKey: PERSIST_KEY })
      },

      runSimulatedDemo: () => {
        if (get().isProcessing) return
        set(freshRunState())
        trace('pipeline', 'run started (simulated demo, user-requested)', {
          jobId: get().jobId, videoName: get().videoName,
        })
        void runPipeline(set, get, { allowWorker: false })
      },

      setVideoFile: (file) => {
        // A different video is a different run, so the previous reconstruction must
        // not survive it — in memory or in storage. Without this the old model keeps
        // its geometry and metrics while the stored entry is relabelled with the new
        // file's name, and the results page presents it as this session's output.
        get().resetSession()
        const preview = URL.createObjectURL(file)
        set({ videoFile: file, videoPreview: preview, videoName: file.name, validationErrors: [] })
        trace('store', 'setVideoFile', { name: file.name, type: file.type, bytes: file.size })
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
        const { metadata, videoFile, dataConsent } = get()
        if (!videoFile) { set({ validationErrors: ['Please upload a video file'] }); return false }
        if (!dataConsent) {
          set({ validationErrors: ['Please consent to on-device processing before starting (see the consent checkbox below the form)'] })
          return false
        }
        const result: ValidationResult = validateFlightData(metadata as RawFlightData)
        if (!result.ok) { set({ validationErrors: result.errors.map((e) => e.message) }); return false }

        // A new run is by definition fresh, even if the previous model came back
        // from this browser's storage.
        set(freshRunState())
        trace('pipeline', 'run started', {
          jobId: get().jobId, workerMode: WORKER_MODE, videoName: get().videoName,
        })

        // Real execution: every step is advanced by the operation it names. A
        // worker failure stops the run and is reported — it is never quietly
        // replaced with a simulated scene.
        void runPipeline(set, get, { allowWorker: true })
        return true
      },

      updateStep: (update) => {
        trace('pipeline', `${update.stepId} → ${update.status}`, {
          jobId: get().jobId,
          ...('progress' in update ? { progress: update.progress } : {}),
          ...('errorMessage' in update ? { errorMessage: update.errorMessage } : {}),
        })
        set((s) => ({
          steps: s.steps.map((step) => {
            if (step.id !== update.stepId) return step
            switch (update.status) {
              case 'pending': return { ...step, state: { status: 'pending' as const, progress: 0 } }
              case 'running': return { ...step, state: { status: 'running' as const, progress: update.progress } }
              case 'complete': return { ...step, state: { status: 'complete' as const, progress: 100, duration: update.duration } }
              case 'error': return { ...step, state: { status: 'error' as const, progress: step.state.progress, errorMessage: update.errorMessage } }
            }
          }),
        }))
      },

      completeProcessingWith: (out) => set({
        isProcessing: false, processingComplete: true,
        pointCloud: out.points, trajectory: out.trajectory, annotations: out.annotations,
        metrics: out.metrics, trackedObjects: out.trackedObjects, bounds: out.bounds,
      }),

      completeProcessing: () => set({ isProcessing: false, processingComplete: true }),

      reset: () => {
        set({
          videoFile: null, videoPreview: null, videoDurationSec: 0, videoName: null,
          metadata: initialMetadata, validationErrors: [], pipelineError: null,
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
        jobId: s.jobId,
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