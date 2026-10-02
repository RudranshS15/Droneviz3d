import type { SessionStatus, SessionTone } from './session-status'

const TONES: Record<SessionTone, { wrap: string; dot: string; label: string }> = {
  neutral: { wrap: 'border-white/[0.1] bg-white/[0.03]', dot: 'bg-[#a8a29e]', label: 'text-[#e7e5e4]' },
  info: { wrap: 'border-cyan-500/25 bg-cyan-500/[0.06]', dot: 'bg-cyan-400 animate-pulse', label: 'text-cyan-200' },
  warning: { wrap: 'border-amber-400/30 bg-amber-400/[0.07]', dot: 'bg-amber-300', label: 'text-amber-200' },
  error: { wrap: 'border-red-500/40 bg-red-500/[0.07]', dot: 'bg-red-400', label: 'text-red-200' },
  success: { wrap: 'border-[#4d7c5e]/40 bg-[#4d7c5e]/[0.08]', dot: 'bg-[#7fbf98]', label: 'text-[#7fbf98]' },
}

/**
 * The visible half of `deriveSessionStatus`: one chip plus one sentence, in the
 * page's existing visual language. `aria-live` is polite rather than assertive:
 * transitions matter (idle → uploading → processing → ready/failed) but they are
 * not emergencies, and the step list below is already readable on its own.
 */
export function SessionStatusBar({ status, className = '' }: { status: SessionStatus; className?: string }) {
  const tone = TONES[status.tone]
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 rounded-xl border ${tone.wrap} ${className}`}
    >
      <span className="flex items-center gap-2 shrink-0">
        <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
        <span className={`text-[12px] font-semibold ${tone.label}`} style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          {status.label}
        </span>
      </span>
      <span className="text-[12px] text-[#a8a29e]">{status.detail}</span>
    </div>
  )
}
