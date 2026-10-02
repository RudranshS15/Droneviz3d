'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useDroneVizStore, STEP_META, isRunning, isComplete, isError, getProgress, PERSIST_KEY } from '../store'
import { deriveSessionStatus, type SessionStateId } from '../session-status'
import { SessionStatusBar } from '../session-status-bar'
import { persistedModelInfo, useTracePage } from '../trace'

/** Heading per state, so the page never claims more than the store knows. */
const HEADINGS: Record<SessionStateId, string> = {
  idle: 'Nothing to process yet',
  uploading: 'Video loaded',
  processing: 'Processing pipeline',
  failed: 'Reconstruction stopped',
  ready: 'Reconstruction complete',
}

/** One-line explanation of the state, shown under the heading. */
const SUMMARIES: Record<SessionStateId, string> = {
  idle: 'No video has been selected yet.',
  uploading: 'This video is ready to process. Start the pipeline from the upload page.',
  processing: 'Every step below advances only when the operation it names returns — not on a timer.',
  failed: 'The pipeline stopped before a model was produced, and nothing from an earlier run is shown in its place.',
  ready: 'Your model is ready.',
}

export default function ProcessingPage() {
  const router = useRouter()
  const {
    processingComplete, isProcessing, steps, videoFile, hydrated, pipelineError, pointCloud,
    jobId, runSimulatedDemo, validateAndStart,
  } = useDroneVizStore()

  // The same derivation the rail below uses, so the heading, the chip and the bar
  // cannot disagree with the steps they are describing.
  const status = deriveSessionStatus({
    hasVideo: videoFile !== null,
    isProcessing,
    processingComplete,
    pipelineError,
    steps,
    pointCount: pointCloud.length,
  })

  useTracePage('processing', {
    jobId,
    state: status.id,
    step: status.stepName,
    percent: status.percent,
    readsFromStore: ['steps', 'isProcessing', 'processingComplete', 'pipelineError', 'pointCloud', 'videoFile', 'jobId'],
    readKeys: [PERSIST_KEY],
    stored: persistedModelInfo(PERSIST_KEY),
  })

  // A restored session has no File object (videoFile is never persisted), so a
  // completed run must not be mistaken for an empty one while storage settles.
  useEffect(() => {
    if (!hydrated) return
    if (!videoFile && !processingComplete) router.push('/droneviz3d/upload')
  }, [hydrated, videoFile, processingComplete, router])

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-4xl mx-auto w-full px-4 sm:px-6 pt-10 pb-20">
        <nav aria-label="Breadcrumb" className="flex items-center gap-3 text-[12px] text-[#a8a29e] mb-6" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          <a href="/droneviz3d" className="hover:text-[#d4a053] transition-colors">Home</a>
          <span aria-hidden="true">/</span>
          <span className="text-[#e7e5e4]">Processing</span>
        </nav>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#e7e5e4] mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          {HEADINGS[status.id]}
        </h1>
        <p className="text-[#a8a29e] text-[14px] mb-4">
          {SUMMARIES[status.id]}
        </p>

        <SessionStatusBar status={status} />

        <div className="mt-8 mb-10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] text-[#a8a29e] font-medium">{status.completedSteps}/{status.stepCount} steps</span>
            <span className="text-[13px] text-[#d4a053] font-semibold" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{status.percent}%</span>
          </div>
          <div
            className="h-2 bg-[#1c1917] rounded-full overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={status.percent}
            aria-label={`Overall processing progress: ${status.percent}%`}
          >
            <div className="h-full bg-[#c27a3a] rounded-full transition-all duration-500" style={{ width: `${status.percent}%` }} />
          </div>
        </div>

        {/* The rail IS the progress line. A node lights up because its step really
            reported `running`/`complete` in the store, and the segment beneath the
            running node fills in proportion to the progress that step reported —
            so a stalled step is visibly stalled instead of being animated to the
            end regardless of what the pipeline is doing. */}
        <ol aria-label="Pipeline steps" className="relative">
          {steps.map((step, i) => {
            const meta = STEP_META[step.id]
            const running = isRunning(step.state)
            const done = isComplete(step.state)
            const errored = isError(step.state)
            const progress = getProgress(step.state)
            // Extract narrowed values outside JSX
            const duration = isComplete(step.state) ? step.state.duration : undefined
            const errorMsg = isError(step.state) ? step.state.errorMessage : undefined
            // The segment entering this node is filled once the pipeline has
            // actually reached it: this step has run, or the one above it has
            // finished.
            const reached = i === 0 ? false : done || running || errored || isComplete(steps[i - 1].state)
            // The segment leaving it only as far as this step has really got.
            const belowFill = done ? 100 : running ? progress : 0

            return (
              <li key={step.id} aria-current={running ? 'step' : undefined} className="flex gap-4">
                <div className="flex w-8 shrink-0 flex-col items-center" aria-hidden="true">
                  <span className={`w-px flex-1 ${reached ? 'bg-[#c27a3a]/70' : 'bg-[#292524]'}`} />
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold ${
                    done ? 'bg-[#4d7c5e]/15 text-[#7fbf98] border border-[#4d7c5e]/40'
                    : running ? 'bg-[#c27a3a]/10 text-[#d4a053] border border-[#c27a3a]/40'
                    : errored ? 'bg-red-500/10 text-red-300 border border-red-500/40'
                    : 'bg-[#1c1917]/50 text-[#a8a29e]/60 border border-[#292524]'
                  }`} style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                    {done ? '✓' : errored ? '✗' : running ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : <span className="text-[10px]">{i + 1}</span>}
                  </span>
                  <span className="relative w-px flex-1 bg-[#292524]">
                    <span
                      className="absolute left-0 top-0 w-px bg-[#c27a3a] transition-[height] duration-500"
                      style={{ height: `${belowFill}%` }}
                    />
                  </span>
                </div>
                <div className={`flex-1 min-w-0 mb-3 p-5 rounded-xl border transition-all duration-300 ${
                  running ? 'bg-[#c27a3a]/[0.03] border-[#c27a3a]/15 shadow-lg shadow-[#c27a3a]/5'
                  : done ? 'bg-[#1c1917]/20 border-[#4d7c5e]/40'
                  : errored ? 'bg-red-500/[0.05] border-red-500/40'
                  : 'bg-[#1c1917]/10 border-[#292524]'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[14px] font-semibold ${running ? 'text-[#d4a053]' : done ? 'text-[#e7e5e4]' : errored ? 'text-red-300' : 'text-[#a8a29e]/60'}`} style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                      {step.name}
                    </span>
                    <span className={`text-[11px] px-2 py-0.5 rounded ${done ? 'text-[#7fbf98] bg-[#4d7c5e]/10' : running ? 'text-[#d4a053] bg-[#c27a3a]/10' : errored ? 'text-red-300 bg-red-500/10' : 'text-[#a8a29e]/60'}`} style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                      {done ? '100%' : running ? `${progress}%` : errored ? 'ERR' : '—'}
                    </span>
                  </div>
                  <p className="text-[12px] text-[#a8a29e] mb-2">{step.detail}</p>
                  {errored && (
                    <p className="text-[11px] text-red-300 mb-2" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                      {errorMsg}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[#a8a29e]/80" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{meta?.tool}</span>
                    {duration !== undefined && (
                      <span className="text-[10px] text-[#a8a29e]/15" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                        {(duration / 1000).toFixed(1)}s
                      </span>
                    )}
                    {running && (
                      <div className="flex-1 h-1 bg-[#1c1917] rounded-full overflow-hidden ml-2">
                        <div className="h-full bg-[#c27a3a]/60 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                      </div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>

        {pipelineError && (
          <div role="alert" className="mt-6 p-5 rounded-xl border border-red-500/40 bg-red-500/[0.06]">
            <h2 className="text-[14px] font-semibold text-red-200 mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              No model was generated
            </h2>
            <p className="text-[12px] text-red-200/90 leading-relaxed mb-4" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              {pipelineError}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => { void validateAndStart() }}
                className="px-5 py-2.5 rounded-lg border border-white/[0.15] text-[#e7e5e4] text-[13px] font-medium hover:bg-[#1c1917]/50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053]"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={runSimulatedDemo}
                className="px-5 py-2.5 rounded-lg bg-[#c27a3a] text-[#0c0a09] text-[13px] font-semibold hover:bg-[#d4a053] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053]"
              >
                Run the simulated demo instead
              </button>
            </div>
            <p className="text-[11px] text-[#a8a29e] mt-3 leading-relaxed">
              The simulated demo generates an illustrative scene from your flight metadata without a model. Its
              result is labelled as simulated everywhere it appears.
            </p>
          </div>
        )}

        {processingComplete && (
          <div className="mt-10 flex flex-col sm:flex-row items-center gap-4">
            {/* Client-side navigation: keeps the in-memory reconstruction store alive. */}
            <Link href="/droneviz3d/viewer" className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-[#c27a3a] text-[#0c0a09] font-semibold text-[15px] shadow-lg shadow-[#c27a3a]/15 text-center" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              View 3D Model →
            </Link>
            <Link href="/droneviz3d/results" className="w-full sm:w-auto px-8 py-3.5 rounded-xl border border-white/[0.15] text-[#e7e5e4] font-medium text-[15px] hover:bg-[#1c1917]/50 text-center">
              See Results &amp; Export
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
