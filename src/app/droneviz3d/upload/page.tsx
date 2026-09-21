'use client'

import { useCallback, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useDroneVizStore } from '../store'

export default function UploadPage() {
  const router = useRouter()
  /** True when the operator configured the real LocateAnything-3B worker backend. */
  const workerMode = process.env.NEXT_PUBLIC_GROUNDING_MODE === 'worker'
  const {
    videoFile, videoPreview, metadata, validationErrors, dataConsent,
    setVideoFile, setVideoDuration, setMetadata, setDataConsent, reset, validateAndStart,
  } = useDroneVizStore()
  const [dragOver, setDragOver] = useState(false)
  const [fileName, setFileName] = useState(videoFile?.name || '')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('video/')) {
      setVideoFile(file)
      setFileName(file.name)
    }
  }, [setVideoFile])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setVideoFile(file)
      setFileName(file.name)
    }
  }

  const handleStart = () => {
    if (!validateAndStart()) return
    router.push('/droneviz3d/processing')
  }

  const fields = [
    { key: 'gpsLat', label: 'Latitude', placeholder: '28.6139', group: 'GPS' },
    { key: 'gpsLng', label: 'Longitude', placeholder: '77.2090', group: 'GPS' },
    { key: 'altitude', label: 'Altitude (m)', placeholder: '120', group: 'Flight' },
    { key: 'speed', label: 'Speed (m/s)', placeholder: '8', group: 'Flight' },
    { key: 'heading', label: 'Heading (°)', placeholder: '0', group: 'Flight' },
    { key: 'timestamp', label: 'Timestamp', placeholder: '2026-09-04T10:30:00', group: 'Flight', type: 'datetime-local' },
    { key: 'cameraFocalLength', label: 'Focal Length (mm)', placeholder: '24', group: 'Camera' },
    { key: 'cameraWidth', label: 'Frame Width (px)', placeholder: '3840', group: 'Camera' },
    { key: 'cameraHeight', label: 'Frame Height (px)', placeholder: '2160', group: 'Camera' },
  ] as const

  const toggles = [
    { key: 'imuData' as const, label: 'IMU Data', desc: 'Accelerometer & gyroscope' },
    { key: 'barometricAlt' as const, label: 'Barometric Altitude', desc: 'Pressure-based height' },
    { key: 'rtkCorrections' as const, label: 'RTK/PPK Corrections', desc: 'Post-processed GNSS' },
  ]

  const onVideoLoaded = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    setVideoDuration(e.currentTarget.duration || 0)
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Header */}
      <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 pt-10 pb-6">
        <nav aria-label="Breadcrumb" className="flex items-center gap-3 text-[12px] text-[#a8a29e] mb-6 font-mono">
          <Link href="/droneviz3d" className="hover:text-[#d4a053] transition-colors">Home</Link>
          <span aria-hidden="true">/</span>
          <span className="text-[#e7e5e4]">Upload</span>
        </nav>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#e7e5e4] mb-2">
          Upload drone data
        </h1>
        <p className="text-[#a8a29e] text-[14px]">
          Provide your video file and flight metadata to begin 3D reconstruction. Everything is processed
          locally in your browser — nothing is uploaded.
        </p>
      </div>

      <div className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Left: Upload + Video Preview */}
          <div className="lg:col-span-3 space-y-6">
            {/* Video Upload Zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`relative rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer overflow-hidden ${
                dragOver
                  ? 'border-cyan-400 bg-cyan-500/[0.05]'
                  : videoFile
                  ? 'border-green-500/40 bg-green-500/[0.03]'
                  : 'border-white/[0.14] hover:border-white/[0.25] bg-white/[0.02]'
              }`}
            >
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                onChange={handleFile}
                className="sr-only"
                id="video-input"
                aria-label="Upload drone video file"
              />

              {videoPreview ? (
                <div className="relative">
                  <video
                    src={videoPreview}
                    className="w-full aspect-video object-cover rounded-xl"
                    controls
                    muted
                    onLoadedMetadata={onVideoLoaded}
                    aria-label={`Preview of uploaded video: ${fileName}`}
                  />
                  <div className="absolute top-4 right-4 flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-sm text-[11px] text-green-300 font-medium">
                      {fileName}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); reset(); setFileName('') }}
                      aria-label="Remove uploaded video and reset the form"
                      className="p-1.5 rounded-lg bg-black/70 backdrop-blur-sm text-[#a8a29e] hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 px-6">
                  <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.1] flex items-center justify-center mb-4" aria-hidden="true">
                    <svg className="w-8 h-8 text-[#a8a29e]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                  </div>
                  <div className="text-[#e7e5e4] font-medium text-[15px] mb-1">
                    Drop drone video here or click to browse
                  </div>
                  <div className="text-[#a8a29e] text-[12px]">
                    Supports MP4, MOV, AVI, MKV — 1080p or 4K recommended
                  </div>
                </div>
              )}
            </div>

            {/* Video Info */}
            {videoFile && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'File Size', value: `${(videoFile.size / (1024 * 1024)).toFixed(1)} MB` },
                  { label: 'Format', value: videoFile.type.split('/')[1]?.toUpperCase() || 'Video' },
                  { label: 'Name', value: videoFile.name.length > 20 ? videoFile.name.slice(0, 20) + '…' : videoFile.name },
                ].map((info) => (
                  <div key={info.label} className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                    <div className="text-[10px] text-[#a8a29e] uppercase tracking-wider font-medium mb-1">{info.label}</div>
                    <div className="text-[13px] text-[#e7e5e4] font-medium truncate">{info.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Metadata Form */}
          <div className="lg:col-span-2">
            <div className="sticky top-20 space-y-6">
              {/* GPS & Flight Data */}
              <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.08]">
                <h2 className="text-[13px] font-semibold text-[#e7e5e4] mb-4">Flight Metadata</h2>
                <div className="space-y-3">
                  {fields.map((f) => {
                    const inputId = `field-${f.key}`
                    return (
                      <div key={f.key}>
                        <label htmlFor={inputId} className="block text-[11px] text-[#a8a29e] font-medium mb-1">
                          {f.label}
                        </label>
                        <input
                          id={inputId}
                          type={'type' in f ? f.type : 'text'}
                          inputMode={'type' in f && f.type === 'datetime-local' ? undefined : 'decimal'}
                          value={String(metadata[f.key as keyof typeof metadata] ?? '')}
                          onChange={(e) => setMetadata({ [f.key]: e.target.value } as Record<string, string>)}
                          placeholder={f.placeholder}
                          aria-invalid={validationErrors.some((msg) => msg.toLowerCase().includes(f.key.toLowerCase())) || undefined}
                          className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-[#e7e5e4] text-[13px] font-mono placeholder:text-white/25 focus:outline-none focus:border-[#d4a053] focus:bg-white/[0.07] transition-all"
                        />
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Optional Sensors */}
              <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.08]">
                <h2 className="text-[13px] font-semibold text-[#e7e5e4] mb-4">Optional Sensor Data</h2>
                <div className="space-y-3">
                  {toggles.map((t) => {
                    const checked = metadata[t.key]
                    return (
                      <div
                        key={t.key}
                        className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]"
                      >
                        <div>
                          <label htmlFor={`toggle-${t.key}`} className="text-[13px] text-[#e7e5e4] font-medium cursor-pointer">
                            {t.label}
                          </label>
                          <div className="text-[11px] text-[#a8a29e]">{t.desc}</div>
                        </div>
                        <button
                          id={`toggle-${t.key}`}
                          type="button"
                          role="switch"
                          aria-checked={checked}
                          aria-label={`${t.label}: ${checked ? 'enabled' : 'disabled'}`}
                          onClick={() => setMetadata({ [t.key]: !checked } as Record<string, boolean>)}
                          className={`relative w-10 h-[22px] rounded-full transition-colors border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a053] ${
                            checked
                              ? 'bg-cyan-600/60 border-cyan-400/60'
                              : 'bg-white/[0.1] border-white/[0.15]'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-all ${
                              checked ? 'translate-x-[18px] bg-cyan-300' : 'bg-[#a8a29e]'
                            }`}
                          />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Consent — required before processing (DPDP Act, 2023 §6) */}
              <div className="p-5 rounded-2xl bg-[#c27a3a]/[0.06] border border-[#c27a3a]/30">
                <h2 className="text-[13px] font-semibold text-[#e7e5e4] mb-2">Consent to process your data</h2>
                <div className="flex items-start gap-3">
                  <input
                    id="data-consent"
                    type="checkbox"
                    checked={dataConsent}
                    onChange={(e) => setDataConsent(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-white/25 bg-white/[0.05] accent-[#c27a3a] cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053]"
                  />
                  <label htmlFor="data-consent" className="text-[12px] text-[#a8a29e] leading-relaxed cursor-pointer">
                    {workerMode ? (
                      <>
                        I consent to DroneViz3D processing this video and the flight metadata I entered{' '}
                        <strong className="text-[#e7e5e4]">on my device</strong>, and to sending sampled
                        keyframes to the operator-run LocateAnything-3B inference worker for grounding, for the
                        sole purpose of generating the 3D model. The raw video is never uploaded; keyframes are
                        transmitted only while processing and are not stored. I can withdraw consent at any time
                        by pressing Reset, which also deletes the generated model from this browser. I confirm I
                        am legally permitted to process this footage. See our{' '}
                      </>
                    ) : (
                      <>
                        I consent to DroneViz3D processing this video and the flight metadata I entered,{' '}
                        <strong className="text-[#e7e5e4]">on my device only</strong>, for the sole purpose of
                        generating the 3D model. I understand the video is never uploaded; the model is kept in
                        this browser so I can come back to it, and pressing Reset deletes it, which is how I
                        withdraw consent. I confirm I am legally permitted to process this footage. See our{' '}
                      </>
                    )}
                    <Link href="/droneviz3d/legal/privacy" className="text-[#d4a053] underline">Privacy Policy</Link> and{' '}
                    <Link href="/droneviz3d/legal/terms" className="text-[#d4a053] underline">Terms</Link>.
                  </label>
                </div>
              </div>

              {/* Validation errors */}
              {validationErrors.length > 0 && (
                <ul role="alert" aria-live="assertive" className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 space-y-1">
                  {validationErrors.map((err) => (
                    <li key={err} className="text-[12px] text-red-200">{err}</li>
                  ))}
                </ul>
              )}

              {/* Start Button */}
              <button
                type="button"
                onClick={handleStart}
                disabled={!videoFile}
                aria-disabled={!videoFile}
                className={`w-full py-3.5 rounded-xl font-semibold text-[15px] transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a053] ${
                  videoFile
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-xl shadow-cyan-500/15 hover:shadow-cyan-500/25 hover:scale-[1.01]'
                    : 'bg-white/[0.06] text-white/40 cursor-not-allowed border border-white/[0.08]'
                }`}
              >
                {videoFile ? 'Start 3D Reconstruction' : 'Upload a video to continue'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
