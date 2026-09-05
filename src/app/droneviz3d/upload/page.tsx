'use client'

import { useCallback, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useDroneVizStore } from '../store'

export default function UploadPage() {
  const router = useRouter()
  const { videoFile, videoPreview, metadata, setVideoFile, setMetadata, reset } = useDroneVizStore()
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
  ]

  const toggles = [
    { key: 'imuData' as const, label: 'IMU Data', desc: 'Accelerometer & gyroscope' },
    { key: 'barometricAlt' as const, label: 'Barometric Altitude', desc: 'Pressure-based height' },
    { key: 'rtkCorrections' as const, label: 'RTK/PPK Corrections', desc: 'Post-processed GNSS' },
  ]

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Header */}
      <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 pt-10 pb-6">
        <div className="flex items-center gap-3 text-[12px] text-white/25 mb-6 font-mono">
          <a href="/droneviz3d" className="hover:text-cyan-400 transition-colors">Home</a>
          <span>/</span>
          <span className="text-white/50">Upload</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-2">
          Upload drone data
        </h1>
        <p className="text-white/30 text-[14px]">
          Provide your video file and flight metadata to begin 3D reconstruction.
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
                  ? 'border-green-500/30 bg-green-500/[0.03]'
                  : 'border-white/[0.08] hover:border-white/[0.15] bg-white/[0.02]'
              }`}
            >
              <input ref={fileRef} type="file" accept="video/*" onChange={handleFile} className="hidden" />

              {videoPreview ? (
                <div className="relative">
                  <video
                    src={videoPreview}
                    className="w-full aspect-video object-cover rounded-xl"
                    controls
                    muted
                  />
                  <div className="absolute top-4 right-4 flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-[11px] text-green-400 font-medium">
                      {fileName}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); reset(); setFileName('') }}
                      className="p-1.5 rounded-lg bg-black/60 backdrop-blur-sm text-white/50 hover:text-red-400 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 px-6">
                  <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-white/20" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                  </div>
                  <div className="text-white/60 font-medium text-[15px] mb-1">
                    Drop drone video here or click to browse
                  </div>
                  <div className="text-white/25 text-[12px]">
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
                  <div key={info.label} className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                    <div className="text-[10px] text-white/25 uppercase tracking-wider font-medium mb-1">{info.label}</div>
                    <div className="text-[13px] text-white/60 font-medium truncate">{info.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Metadata Form */}
          <div className="lg:col-span-2">
            <div className="sticky top-20 space-y-6">
              {/* GPS & Flight Data */}
              <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.04]">
                <h3 className="text-[13px] font-semibold text-white/70 mb-4">Flight Metadata</h3>
                <div className="space-y-3">
                  {fields.map((f) => (
                    <div key={f.key}>
                      <label className="block text-[11px] text-white/30 font-medium mb-1">{f.label}</label>
                      <input
                        type={f.type || 'text'}
                        value={String(metadata[f.key as keyof typeof metadata] ?? '')}
                        onChange={(e) => setMetadata({ [f.key]: e.target.value } as any)}
                        placeholder={f.placeholder}
                        className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-white/80 text-[13px] font-mono placeholder:text-white/15 focus:outline-none focus:border-cyan-500/30 focus:bg-white/[0.05] transition-all"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Optional Sensors */}
              <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.04]">
                <h3 className="text-[13px] font-semibold text-white/70 mb-4">Optional Sensor Data</h3>
                <div className="space-y-3">
                  {toggles.map((t) => (
                    <label key={t.key} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] cursor-pointer hover:bg-white/[0.03] transition-all">
                      <div>
                        <div className="text-[13px] text-white/60 font-medium">{t.label}</div>
                        <div className="text-[11px] text-white/25">{t.desc}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMetadata({ [t.key]: !metadata[t.key] })}
                        className={`relative w-10 h-[22px] rounded-full transition-colors ${
                          metadata[t.key] ? 'bg-cyan-500/30 border-cyan-500/40' : 'bg-white/[0.06] border-white/[0.08]'
                        } border`}
                      >
                        <span className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-all ${
                          metadata[t.key] ? 'translate-x-[18px] bg-cyan-400' : 'bg-white/30'
                        }`} />
                      </button>
                    </label>
                  ))}
                </div>
              </div>

              {/* Start Button */}
              <button
                onClick={handleStart}
                disabled={!videoFile}
                className={`w-full py-3.5 rounded-xl font-semibold text-[15px] transition-all duration-200 ${
                  videoFile
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-xl shadow-cyan-500/15 hover:shadow-cyan-500/25 hover:scale-[1.01]'
                    : 'bg-white/[0.04] text-white/20 cursor-not-allowed border border-white/[0.04]'
                }`}
              >
                {videoFile ? 'Start 3D Reconstruction →' : 'Upload a video to continue'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
