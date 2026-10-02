/**
 * trace.ts — TEMPORARY console tracing for the reconstruction session.
 *
 * Why it exists: "the app shows the previous video's results" is a claim about
 * state moving between three pages and one storage key, and reading the code
 * does not settle it. These lines print the session as it happens — the run id,
 * each step, and whether a stored model is present when each page mounts.
 *
 * REMOVING IT: delete this file and every `trace(` / `useTracePage(` call site
 * (`grep -rn "trace" src/app/droneviz3d`). Nothing else depends on it.
 *
 * Silencing it: set NEXT_PUBLIC_DV3D_TRACE=off; unset logs.
 */

import { useEffect, useRef } from 'react'

export const TRACE_ENABLED = process.env.NEXT_PUBLIC_DV3D_TRACE !== 'off'

export function trace(scope: string, event: string, data?: Record<string, unknown>): void {
  if (!TRACE_ENABLED) return
  console.log(`[dv3d:${scope}] ${event}`, { ...data, at: new Date().toISOString().slice(11, 23) })
}

export interface PersistedModelInfo {
  present: boolean
  bytes: number
  videoName: string | null
  jobId: string | null
  /** points.length in object form, or flatIntegers / 7 in the quantized form */
  points: number | null
}

/**
 * What this browser is currently holding under `key`, read the same way the store
 * reads it. Pages log this so "which localStorage key was read" is answered by
 * observation rather than by inspection.
 */
export function persistedModelInfo(key: string): PersistedModelInfo {
  const empty: PersistedModelInfo = { present: false, bytes: 0, videoName: null, jobId: null, points: null }
  if (typeof window === 'undefined') return empty
  const raw = window.localStorage.getItem(key)
  if (raw === null) return empty
  try {
    const parsed = JSON.parse(raw) as {
      state?: { videoName?: unknown; jobId?: unknown; pointCloud?: unknown }
    }
    const cloud = parsed.state?.pointCloud
    const isFlat = Array.isArray(cloud) && typeof cloud[0] === 'number'
    return {
      present: true,
      bytes: raw.length,
      videoName: typeof parsed.state?.videoName === 'string' ? parsed.state.videoName : null,
      jobId: typeof parsed.state?.jobId === 'string' ? parsed.state.jobId : null,
      points: Array.isArray(cloud) ? (isFlat ? Math.floor(cloud.length / 7) : cloud.length) : null,
    }
  } catch {
    return { present: true, bytes: raw.length, videoName: null, jobId: null, points: null }
  }
}

/**
 * Log a page's view of the session, once per actual change. `snapshot` is built
 * by the caller so each page says which fields it is reading.
 */
export function useTracePage(page: string, snapshot: Record<string, unknown>): void {
  const previous = useRef<string>('')
  useEffect(() => {
    const serialized = JSON.stringify(snapshot)
    if (serialized === previous.current) return
    previous.current = serialized
    trace(page, 'state', snapshot)
  })
}
