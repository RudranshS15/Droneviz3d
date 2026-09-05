'use client'

import Link from 'next/link'
import { useEffect, useState, useRef } from 'react'

const pipeline = ['Video', 'Frames', 'Features', 'SLAM', 'Depth', 'Point Cloud', 'Mesh', '3D Model']

function PipelineDemo() {
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true) }, { threshold: 0.3 })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    const iv = setInterval(() => setStep((s) => (s + 1) % pipeline.length), 1800)
    return () => clearInterval(iv)
  }, [visible])

  return (
    <div ref={ref} className="relative max-w-4xl mx-auto mt-16">
      <div className="flex items-center justify-between gap-1 px-2">
        {pipeline.map((label, i) => {
          const active = i === step
          const done = i < step
          return (
            <div key={label} className="flex-1 flex flex-col items-center gap-2">
              <div
                className={`w-full h-10 rounded-lg flex items-center justify-center text-[11px] font-semibold transition-all duration-500 ${
                  active
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 shadow-lg shadow-cyan-500/10'
                    : done
                    ? 'bg-green-500/10 text-green-400/70 border border-green-500/10'
                    : 'bg-white/[0.03] text-white/20 border border-white/[0.04]'
                }`}
              >
                {done ? '✓' : active ? '⟳' : i + 1}
              </div>
              <span className={`text-[10px] font-medium text-center leading-tight transition-colors duration-500 ${active ? 'text-cyan-400' : done ? 'text-white/40' : 'text-white/15'}`}>
                {label}
              </span>
            </div>
          )
        })}
      </div>
      {/* Progress bar */}
      <div className="mt-4 h-0.5 bg-white/[0.04] rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-700"
          style={{ width: `${((step + 1) / pipeline.length) * 100}%` }}
        />
      </div>
    </div>
  )
}

function BeforeAfterDemo() {
  const [showAfter, setShowAfter] = useState(false)

  return (
    <div className="max-w-3xl mx-auto mt-20">
      <div className="text-center mb-8">
        <p className="text-sm text-white/30 mb-2">Single-pass drone video</p>
        <div className="flex items-center justify-center gap-3">
          <span className="text-[13px] text-white/30 font-medium">Before</span>
          <button
            onClick={() => setShowAfter(!showAfter)}
            className="relative w-12 h-6 rounded-full bg-white/10 border border-white/10 transition-colors hover:bg-white/15"
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 shadow-lg transition-transform duration-300 ${showAfter ? 'translate-x-6' : ''}`}
            />
          </button>
          <span className="text-[13px] text-cyan-400 font-medium">After</span>
        </div>
      </div>

      <div className="relative aspect-video rounded-2xl overflow-hidden border border-white/[0.06] bg-white/[0.02]">
        {/* Before: simulated video frame grid */}
        {!showAfter && (
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-px bg-white/[0.06]">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="bg-[#0f1419] flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 opacity-20"
                  style={{
                    background: `linear-gradient(${45 + i * 20}deg, rgba(56,189,248,0.1) 0%, transparent 50%)`,
                  }}
                />
                <div className="text-center">
                  <div className="text-[10px] text-white/20 font-mono">Frame {String(i * 12 + 1).padStart(3, '0')}</div>
                  <div className="mt-1 w-8 h-px bg-white/10 mx-auto" />
                  <div className="mt-1 flex gap-0.5 justify-center">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <div key={j} className="w-1 h-1 rounded-full bg-cyan-400/30" />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* After: 3D model visualization */}
        {showAfter && (
          <div className="absolute inset-0 bg-[#0a0e14] flex items-center justify-center">
            <div className="relative w-full h-full">
              {/* Simulated 3D point cloud */}
              <svg viewBox="0 0 800 450" className="w-full h-full">
                {/* Ground plane */}
                <ellipse cx="400" cy="320" rx="300" ry="60" fill="url(#groundGrad)" opacity="0.3" />
                {/* Buildings */}
                {[
                  { x: 200, y: 180, w: 60, h: 120, color: '#1e3a5f' },
                  { x: 300, y: 150, w: 50, h: 150, color: '#1a3350' },
                  { x: 370, y: 200, w: 70, h: 100, color: '#1e3a5f' },
                  { x: 480, y: 170, w: 55, h: 130, color: '#163048' },
                  { x: 560, y: 210, w: 65, h: 90, color: '#1a3350' },
                ].map((b, i) => (
                  <g key={i}>
                    <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={b.color} rx="2" opacity="0.8" />
                    <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke="#38bdf8" strokeWidth="0.5" rx="2" opacity="0.4" />
                    {/* Windows */}
                    {Array.from({ length: Math.floor(b.h / 20) }).map((_, wi) => (
                      <rect
                        key={wi}
                        x={b.x + 8}
                        y={b.y + 8 + wi * 20}
                        width={b.w - 16}
                        height={6}
                        fill="#38bdf8"
                        opacity="0.15"
                        rx="1"
                      />
                    ))}
                  </g>
                ))}
                {/* Point cloud dots */}
                {Array.from({ length: 200 }).map((_, i) => {
                  const x = 100 + Math.random() * 600
                  const y = 200 + Math.random() * 200
                  const confidence = Math.random()
                  return (
                    <circle
                      key={i}
                      cx={x}
                      cy={y}
                      r={0.8 + Math.random() * 1.2}
                      fill={confidence > 0.7 ? '#22d3ee' : confidence > 0.4 ? '#fbbf24' : '#f87171'}
                      opacity={0.4 + Math.random() * 0.4}
                    />
                  )
                })}
                {/* Camera trajectory */}
                <path
                  d="M 100 120 Q 250 80 400 100 Q 550 120 700 90"
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                  strokeDasharray="6 3"
                  opacity="0.4"
                />
                <circle cx="100" cy="120" r="4" fill="#38bdf8" opacity="0.6" />
                <circle cx="700" cy="90" r="4" fill="#22d3ee" opacity="0.6" />
                {/* Labels */}
                <text x="400" y="400" textAnchor="middle" fill="white" opacity="0.3" fontSize="11" fontFamily="system-ui">
                  Georeferenced 3D Reconstruction — 847,329 points — 0.8cm accuracy
                </text>
                <defs>
                  <radialGradient id="groundGrad">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
                  </radialGradient>
                </defs>
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function LandingPage() {
  const [heroVisible, setHeroVisible] = useState(false)
  useEffect(() => { setHeroVisible(true) }, [])

  return (
    <div>
      {/* Hero — wisprflow-style bold */}
      <section className="relative min-h-[90vh] flex flex-col items-center justify-center text-center px-4 overflow-hidden">
        {/* Grid bg */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: 'linear-gradient(rgba(56,189,248,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.6) 1px, transparent 1px)',
            backgroundSize: '80px 80px',
          }}
        />

        <div className="relative z-10 max-w-5xl">
          <div className={`transition-all duration-700 ${heroVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/[0.08] border border-cyan-500/20 text-cyan-400 text-[12px] font-medium mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              Smart India Hackathon 2026 &middot; SIH26158
            </div>
          </div>

          <h1 className={`text-[clamp(2.5rem,8vw,7rem)] font-black leading-[0.9] tracking-[-0.04em] mb-6 transition-all duration-700 delay-100 ${heroVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
            Don&apos;t fly twice.
            <br />
            <span className="bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 bg-clip-text text-transparent">
              Build 3D once.
            </span>
          </h1>

          <p className={`text-lg sm:text-xl text-white/40 max-w-2xl mx-auto leading-relaxed mb-10 transition-all duration-700 delay-200 ${heroVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
            Upload a single drone video. Get a georeferenced, metrically accurate 3D model.
            Sub-centimeter precision from one flight path — powered by NeRF, 3D Gaussian Splatting, and Visual SLAM.
          </p>

          <div className={`flex flex-col sm:flex-row items-center justify-center gap-3 transition-all duration-700 delay-300 ${heroVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
            <Link
              href="/droneviz3d/upload"
              className="px-7 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold text-[15px] shadow-xl shadow-cyan-500/20 hover:shadow-cyan-500/30 hover:scale-[1.02] transition-all duration-200"
            >
              Upload Drone Video →
            </Link>
            <Link
              href="/droneviz3d/viewer"
              className="px-7 py-3 rounded-xl border border-white/10 text-white/60 font-medium text-[15px] hover:bg-white/[0.04] hover:text-white/80 transition-all duration-200"
            >
              View Demo Model
            </Link>
          </div>

          {/* Stats strip */}
          <div className={`grid grid-cols-2 sm:grid-cols-4 gap-6 mt-16 transition-all duration-700 delay-500 ${heroVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
            {[
              { value: '1', label: 'Flight Pass' },
              { value: '<1cm', label: 'Accuracy' },
              { value: '90%', label: 'Faster Processing' },
              { value: '80%', label: 'Cost Savings' },
            ].map((s) => (
              <div key={s.label}>
                <div className="text-3xl sm:text-4xl font-black tracking-tight text-white/90">{s.value}</div>
                <div className="text-[12px] text-white/25 mt-1 font-medium">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pipeline Demo — wisprflow-style interactive */}
      <section className="py-24 px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
            From video to 3D in{' '}
            <span className="text-cyan-400">10 steps</span>
          </h2>
          <p className="text-white/30 max-w-xl mx-auto text-[15px]">
            Real-time processing pipeline transforms your drone footage into a textured, georeferenced 3D model.
          </p>
        </div>
        <PipelineDemo />
      </section>

      {/* Before / After — wisprflow-style toggle */}
      <section className="py-24 px-4">
        <div className="text-center mb-8">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
            See the{' '}
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">transformation</span>
          </h2>
          <p className="text-white/30 text-[15px]">
            Raw video frames on the left. Reconstructed 3D model on the right.
          </p>
        </div>
        <BeforeAfterDemo />
      </section>

      {/* How it works — 3 steps */}
      <section className="py-24 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white text-center mb-16">
            How it works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: 'Upload',
                desc: 'Upload your drone video (1080p/4K), add GPS coordinates and flight metadata. Optional: IMU data, barometric altitude, RTK corrections.',
                icon: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12',
              },
              {
                step: '02',
                title: 'Process',
                desc: 'AI pipeline extracts keyframes, tracks camera pose via Visual SLAM, estimates depth with NeRF/3DGS, and reconstructs textured mesh.',
                icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
              },
              {
                step: '03',
                title: 'Visualize & Export',
                desc: 'Interactive 3D viewer with confidence heatmap, measurement tools. Export as OBJ/PLY/GLTF with orthophoto and DEM overlays.',
                icon: 'M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5',
              },
            ].map((item) => (
              <div key={item.step} className="group p-8 rounded-2xl bg-white/[0.02] border border-white/[0.04] hover:border-cyan-500/20 hover:bg-cyan-500/[0.02] transition-all duration-300">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 flex items-center justify-center mb-6 group-hover:shadow-lg group-hover:shadow-cyan-500/10 transition-shadow">
                  <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                </div>
                <div className="text-[11px] font-mono text-cyan-400/60 mb-2">Step {item.step}</div>
                <h3 className="text-lg font-bold text-white mb-2">{item.title}</h3>
                <p className="text-[13px] text-white/30 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Applications */}
      <section className="py-24 px-4">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-4">
            Built for real-world use
          </h2>
          <p className="text-white/30 text-[15px] mb-12 max-w-xl mx-auto">
            From disaster response to urban planning — one flight, one model, total situational awareness.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { icon: '🛡️', name: 'Defense & Border' },
              { icon: '🆘', name: 'Disaster Response' },
              { icon: '🏙️', name: 'Urban Planning' },
              { icon: '🏗️', name: 'Construction' },
              { icon: '🛤️', name: 'Infrastructure' },
              { icon: '🏛️', name: 'Archaeology' },
              { icon: '🌐', name: 'Digital Twins' },
              { icon: '🌾', name: 'Agriculture' },
            ].map((a) => (
              <div key={a.name} className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:border-cyan-500/15 transition-all group">
                <div className="text-2xl mb-2">{a.icon}</div>
                <div className="text-[12px] text-white/50 font-medium group-hover:text-white/70 transition-colors">{a.name}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <div className="p-12 rounded-3xl bg-gradient-to-br from-cyan-500/[0.06] to-blue-500/[0.04] border border-white/[0.05]">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Ready to reconstruct?
            </h2>
            <p className="text-white/30 mb-8 text-[15px]">
              Upload your drone video and get a 3D model in minutes, not hours.
            </p>
            <Link
              href="/droneviz3d/upload"
              className="inline-flex px-8 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold text-[15px] shadow-xl shadow-cyan-500/20 hover:shadow-cyan-500/30 hover:scale-[1.02] transition-all duration-200"
            >
              Start Processing →
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
