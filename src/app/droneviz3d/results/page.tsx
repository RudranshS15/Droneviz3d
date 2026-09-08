'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useDroneVizStore, type ConfidenceAnnotation } from '../store'
import { EXPORT_FORMATS, exportAs, type ExportFormatId, ExportPayload } from '../exporter'

function ConfidenceHeatmap({ points }: { points: { confidence: number }[] }) {
  const high = points.filter((p) => p.confidence > 0.8).length
  const med = points.filter((p) => p.confidence > 0.5 && p.confidence <= 0.8).length
  const low = points.filter((p) => p.confidence <= 0.5).length
  const total = points.length
  return (
    <div className="p-5 rounded-2xl bg-[#1c1917]/20 border border-[#292524]">
      <h3 className="text-[13px] font-semibold text-[#e7e5e4] mb-4">Confidence distribution</h3>
      <div className="space-y-4">
        {[{ label: 'High', count: high, color: 'bg-[#c27a3a]', tc: 'text-[#d4a053]' },
          { label: 'Medium', count: med, color: 'bg-[#d4a053]', tc: 'text-[#d4a053]' },
          { label: 'Low', count: low, color: 'bg-[#a8a29e]', tc: 'text-[#a8a29e]' }
        ].map((item) => (
          <div key={item.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] text-[#a8a29e]">{item.label}</span>
              <span className={`text-[12px] ${item.tc}`}>
                {item.count.toLocaleString()} ({total > 0 ? ((item.count / total) * 100).toFixed(1) : 0}%)
              </span>
            </div>
            <div
              className="h-2 bg-[#1c1917] rounded-full overflow-hidden"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={item.count}
              aria-label={`${item.label} confidence: ${item.count} of ${total} points`}
            >
              <div className={`h-full ${item.color} rounded-full transition-all`} style={{ width: total > 0 ? `${(item.count / total) * 100}%` : '0%' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ConfidenceAnnotations({ annotations }: { annotations: ConfidenceAnnotation[] }) {
  const causeLabels: Record<ConfidenceAnnotation['cause'], string> = {
    occlusion: 'Occlusion', motion_blur: 'Motion Blur', low_parallax: 'Low Parallax',
    dynamic_object: 'Dynamic Object', lighting: 'Lighting', gps_noise: 'GPS Noise',
  }
  return (
    <div className="p-5 rounded-2xl bg-[#1c1917]/20 border border-[#292524]">
      <h3 className="text-[13px] font-semibold text-[#e7e5e4] mb-1">Confidence annotations</h3>
      <p className="text-[11px] text-[#a8a29e] mb-4">
        {annotations.length} region{annotations.length === 1 ? '' : 's'} with reduced confidence
      </p>
      <ul className="space-y-3">
        {annotations.map((ann, i) => (
          <li key={i} className="p-4 rounded-xl border border-[#292524] bg-[#0c0a09]/20 hover:border-[#c27a3a]/40 transition-all">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] text-[#e7e5e4] font-medium">{causeLabels[ann.cause]}</span>
              <span className="text-[11px] font-semibold text-[#d4a053]">{(ann.score * 100).toFixed(0)}%</span>
            </div>
            <p className="text-[11px] text-[#a8a29e] leading-relaxed mb-2">{ann.explanation}</p>
            <div className="flex items-center gap-4 text-[10px] text-[#a8a29e]/80">
              <span>Frames {ann.affectedFrames[0]}–{ann.affectedFrames[1]}</span>
              <span>Pos ({ann.x.toFixed(1)}, {ann.y.toFixed(1)}, {ann.z.toFixed(1)})</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="p-5 rounded-2xl bg-[#1c1917]/20 border border-[#292524]">
      <div className="text-[11px] text-[#a8a29e] uppercase tracking-wider font-medium mb-2">{label}</div>
      <div className="text-2xl font-bold text-[#d4a053] tracking-tight">{value}</div>
      {sub && <div className="text-[12px] text-[#a8a29e] mt-1">{sub}</div>}
    </div>
  )
}

export default function ResultsPage() {
  const router = useRouter()
  const { processingComplete, metrics, pointCloud, annotations, trajectory, bounds, videoFile, videoName, metadata, reset } = useDroneVizStore()

  useEffect(() => {
    if (!processingComplete && !metrics) router.push('/droneviz3d/upload')
  }, [processingComplete, metrics, router])

  if (!metrics) return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center">
      <div className="text-center">
        <div className="text-[#a8a29e] text-[15px] mb-4">No results yet</div>
        <a href="/droneviz3d/upload" className="text-[#d4a053] text-[13px] hover:underline">Upload a video first</a>
      </div>
    </div>
  )

  const exportPayload: ExportPayload = {
    points: pointCloud, trajectory, metrics, bounds,
    origin: bounds ? { lat: (bounds.minLat + bounds.maxLat) / 2, lng: (bounds.minLng + bounds.maxLng) / 2 } : null,
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 pt-10 pb-20">
        <nav aria-label="Breadcrumb" className="flex items-center gap-3 text-[12px] text-[#a8a29e] mb-6">
          <a href="/droneviz3d" className="hover:text-[#d4a053] transition-colors">Home</a><span aria-hidden="true">/</span>
          <span className="text-[#e7e5e4]">Results</span>
        </nav>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#e7e5e4] mb-2">Reconstruction results</h1>
        <p className="text-[#a8a29e] text-[14px] mb-6">
          {videoFile
            ? `${videoFile.name} — processed`
            : videoName
              ? `${videoName} — processed (restored from this session)`
              : 'Processed reconstruction'}
        </p>

        {/* Provenance — honest statement of what was generated and how */}
        <div className="mb-10 p-4 rounded-xl border border-[#c27a3a]/30 bg-[#c27a3a]/[0.06]" role="note">
          <p className="text-[12px] text-[#e7e5e4] leading-relaxed">
            <strong className="text-[#d4a053]">How this model was generated:</strong> {metrics.provenance}.
            Object positions and heights come from LocateAnything-3B detections projected through your flight
            metadata; fine surface detail between detected objects is synthesized. Metrics below describe this
            generated model — they are not survey-grade measurements.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-10">
          <MetricCard label="Total Points" value={metrics.totalPoints} />
          <MetricCard label="Grounded Objects" value={metrics.groundedObjects} sub={metrics.groundedLabels} />
          <MetricCard label="Confidence" value={metrics.confidenceScore} sub="Mean point confidence" />
          <MetricCard label="Coverage" value={metrics.coverage} sub="of detected corridor" />
          <MetricCard label="Processing" value={metrics.processingTime} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <ConfidenceHeatmap points={pointCloud} />
            <ConfidenceAnnotations annotations={annotations} />
          </div>
          <div className="space-y-6">
            <div className="p-5 rounded-2xl bg-[#1c1917]/20 border border-[#292524]">
              <h3 className="text-[13px] font-semibold text-[#e7e5e4] mb-4">Export model</h3>
              <div className="space-y-2">
                {EXPORT_FORMATS.map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => exportAs(fmt.id as ExportFormatId, exportPayload)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl bg-[#0c0a09]/30 border border-[#292524] hover:border-[#c27a3a]/40 focus-visible:border-[#c27a3a] transition-all text-left group"
                  >
                    <div className="flex-1">
                      <div className="text-[13px] text-[#e7e5e4] font-medium group-hover:text-[#d4a053] transition-colors">{fmt.name}</div>
                      <div className="text-[11px] text-[#a8a29e]">{fmt.description}</div>
                    </div>
                    <span className="text-[10px] text-[#a8a29e] bg-[#1c1917]/70 px-2 py-0.5 rounded font-mono">.{fmt.ext}</span>
                    <span aria-hidden="true" className="text-[#a8a29e] group-hover:text-[#d4a053]">↓</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[#a8a29e] mt-3 leading-relaxed">
                Exports contain the generated point cloud. Survey-grade formats (GeoTIFF orthophoto, DEM, LAS)
                are not offered because they require a photogrammetry backend this demo does not run.
              </p>
            </div>
            <Link
              href="/droneviz3d/viewer"
              className="block w-full py-3.5 rounded-xl bg-[#c27a3a] text-[#0c0a09] font-semibold text-[14px] text-center hover:bg-[#d4a053] transition-colors"
            >
              Open 3D Viewer
            </Link>
            <button
              type="button"
              onClick={() => { reset(); router.push('/droneviz3d/upload') }}
              className="block w-full py-3 rounded-xl border border-[#292524] text-[#a8a29e] font-medium text-[14px] text-center hover:bg-[#1c1917]/50 hover:text-[#e7e5e4] transition-colors"
            >
              Start a new reconstruction
            </button>
          </div>
        </div>

        {/* Metadata summary — shows exactly what was collected (data minimization) */}
        <details className="mt-10 p-4 rounded-xl border border-[#292524] bg-[#1c1917]/20">
          <summary className="text-[13px] text-[#e7e5e4] cursor-pointer">Flight metadata used for this reconstruction</summary>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 text-[12px]">
            {[
              ['GPS reference', `${metadata.gpsLat}, ${metadata.gpsLng}`],
              ['Altitude', `${metadata.altitude} m`],
              ['Speed', `${metadata.speed} m/s`],
              ['Heading', `${metadata.heading}°`],
              ['Camera', `${metadata.cameraFocalLength} mm, ${metadata.cameraWidth}×${metadata.cameraHeight}`],
              ['RTK corrections', metadata.rtkCorrections ? 'Yes' : 'No'],
            ].map(([k, v]) => (
              <div key={k} className="p-2 rounded-lg bg-[#0c0a09]/40">
                <dt className="text-[#a8a29e]">{k}</dt>
                <dd className="text-[#e7e5e4] font-mono mt-0.5">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[11px] text-[#a8a29e] mt-3">
            This metadata stayed in your browser. Nothing was uploaded to a server.
          </p>
        </details>
      </div>
    </div>
  )
}
