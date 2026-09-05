'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useDroneVizStore, STEP_META, isRunning, isComplete, isError, getProgress } from '../store'

export default function ProcessingPage() {
  const router = useRouter()
  const { isProcessing, processingComplete, steps, videoFile } = useDroneVizStore()

  useEffect(() => {
    if (!videoFile && !processingComplete) router.push('/droneviz3d/upload')
  }, [videoFile, processingComplete, router])

  const completedCount = steps.filter((s) => isComplete(s.state)).length
  const currentStep = steps.find((s) => isRunning(s.state))
  const overallProgress = Math.floor((completedCount / steps.length) * 100)

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-4xl mx-auto w-full px-4 sm:px-6 pt-10 pb-20">
        <div className="flex items-center gap-3 text-[12px] text-[#a8a29e]/30 mb-6" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          <a href="/droneviz3d" className="hover:text-[#c27a3a] transition-colors">Home</a>
          <span>/</span>
          <span className="text-[#a8a29e]/50">Processing</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#e7e5e4] mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          {processingComplete ? 'Reconstruction complete' : 'Processing pipeline'}
        </h1>
        <p className="text-[#a8a29e]/40 text-[14px] mb-8">
          {processingComplete ? 'Your 3D model is ready.' : currentStep ? `Running: ${currentStep.name}` : 'Initializing...'}
        </p>

        <div className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] text-[#a8a29e]/40 font-medium">{completedCount}/{steps.length} steps</span>
            <span className="text-[13px] text-[#d4a053] font-semibold" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{overallProgress}%</span>
          </div>
          <div className="h-2 bg-[#1c1917] rounded-full overflow-hidden">
            <div className="h-full bg-[#c27a3a] rounded-full transition-all duration-500" style={{ width: `${overallProgress}%` }} />
          </div>
        </div>

        <div className="space-y-3">
          {steps.map((step, i) => {
            const meta = STEP_META[step.id]
            const running = isRunning(step.state)
            const done = isComplete(step.state)
            const errored = isError(step.state)
            const progress = getProgress(step.state)
            // Extract narrowed values outside JSX
            const duration = isComplete(step.state) ? step.state.duration : undefined
            const errorMsg = isError(step.state) ? step.state.errorMessage : undefined

            return (
              <div key={step.id} className={`p-5 rounded-xl border transition-all duration-300 ${
                running ? 'bg-[#c27a3a]/[0.03] border-[#c27a3a]/15 shadow-lg shadow-[#c27a3a]/5'
                : done ? 'bg-[#1c1917]/20 border-[#4d7c5e]/10'
                : errored ? 'bg-red-500/[0.03] border-red-500/15'
                : 'bg-[#1c1917]/10 border-[#292524]'
              }`}>
                <div className="flex items-start gap-4">
                  <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[12px] font-bold ${
                    done ? 'bg-[#4d7c5e]/10 text-[#4d7c5e] border border-[#4d7c5e]/20'
                    : running ? 'bg-[#c27a3a]/10 text-[#d4a053] border border-[#c27a3a]/20'
                    : errored ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                    : 'bg-[#1c1917]/50 text-[#a8a29e]/20 border border-[#292524]'
                  }`} style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                    {done ? '✓' : errored ? '✗' : running ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : <span className="text-[10px]">{i + 1}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-[14px] font-semibold ${running ? 'text-[#d4a053]' : done ? 'text-[#e7e5e4]/50' : errored ? 'text-red-400' : 'text-[#a8a29e]/25'}`} style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                        {step.name}
                      </span>
                      <span className={`text-[11px] px-2 py-0.5 rounded ${done ? 'text-[#4d7c5e]/50 bg-[#4d7c5e]/5' : running ? 'text-[#d4a053]/50 bg-[#c27a3a]/5' : errored ? 'text-red-400/50 bg-red-500/5' : 'text-[#a8a29e]/15'}`} style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                        {done ? '100%' : running ? `${progress}%` : errored ? 'ERR' : '—'}
                      </span>
                    </div>
                    <p className="text-[12px] text-[#a8a29e]/25 mb-2">{step.detail}</p>
                    {errored && (
                      <p className="text-[11px] text-red-400/60 mb-2" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                        {errorMsg}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[#a8a29e]/15" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{meta?.tool}</span>
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
                </div>
              </div>
            )
          })}
        </div>

        {processingComplete && (
          <div className="mt-10 flex flex-col sm:flex-row items-center gap-4">
            <a href="/droneviz3d/viewer" className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-[#c27a3a] text-[#0c0a09] font-semibold text-[15px] shadow-lg shadow-[#c27a3a]/15 text-center" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              View 3D Model →
            </a>
            <a href="/droneviz3d/results" className="w-full sm:w-auto px-8 py-3.5 rounded-xl border border-[#292524] text-[#a8a29e] font-medium text-[15px] hover:bg-[#1c1917]/50 text-center">
              See Results &amp; Export
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
