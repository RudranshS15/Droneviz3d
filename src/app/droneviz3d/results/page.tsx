'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useDroneVizStore, type ConfidenceAnnotation } from '../store'

function ConfidenceHeatmap({ points }: { points: { confidence: number }[] }) {
  const high = points.filter((p) => p.confidence > 0.8).length
  const med = points.filter((p) => p.confidence > 0.5 && p.confidence <= 0.8).length
  const low = points.filter((p) => p.confidence <= 0.5).length
  const total = points.length
  return (
    <div className="p-5 rounded-2xl bg-[#1c1917]/20 border border-[#292524]">
      <h3 className="text-[13px] font-semibold text-[#e7e5e4]/60 mb-4">Confidence Distribution</h3>
      <div className="space-y-4">
        {[{ label: 'High', count: high, color: 'bg-[#c27a3a]', tc: 'text-[#d4a053]' },
          { label: 'Medium', count: med, color: 'bg-[#d4a053]', tc: 'text-[#d4a053]/70' },
          { label: 'Low', count: low, color: 'bg-[#a8a29e]', tc: 'text-[#a8a29e]/60' }
        ].map((item) => (
          <div key={item.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] text-[#a8a29e]/40">{item.label}</span>
              <span className={`text-[12px] ${item.tc}`}>{item.count.toLocaleString()} ({total > 0 ? ((item.count / total) * 100).toFixed(1) : 0}%)</span>
            </div>
            <div className="h-2 bg-[#1c1917] rounded-full overflow-hidden">
              <div className={`h-full ${item.color} rounded-full transition-all`} style={{ width: total > 0 ? `${(item.count / total) * 100}%` : '0%' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ConfidenceAnnotations({ annotations }: { annotations: ConfidenceAnnotation[] }) {
  const causeLabels: Record<ConfidenceAnnotation['cause'], string> = { occlusion: 'Occlusion', motion_blur: 'Motion Blur', low_parallax: 'Low Parallax', dynamic_object: 'Dynamic Object', lighting: 'Lighting', gps_noise: 'GPS Noise' }
  return (
    <div className="p-5 rounded-2xl bg-[#1c1917]/20 border border-[#292524]">
      <h3 className="text-[13px] font-semibold text-[#e7e5e4]/60 mb-1">Confidence Annotations</h3>
      <p className="text-[11px] text-[#a8a29e]/25 mb-4">{annotations.length} regions with reduced confidence</p>
      <div className="space-y-3">
        {annotations.sort((a, b) => a.score - b.score).map((ann, i) => (
          <div key={i} className="p-4 rounded-xl border border-[#292524] bg-[#0c0a09]/20 hover:border-[#c27a3a]/15 transition-all">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] text-[#e7e5e4]/60 font-medium">{causeLabels[ann.cause]}</span>
              <span className="text-[11px] font-semibold text-[#d4a053]">{(ann.score * 100).toFixed(0)}%</span>
            </div>
            <p className="text-[11px] text-[#a8a29e]/35 leading-relaxed mb-2">{ann.explanation}</p>
            <div className="flex items-center gap-4 text-[10px] text-[#a8a29e]/20">
              <span>Frames {ann.affectedFrames[0]}-{ann.affectedFrames[1]}</span>
              <span>Pos ({ann.x.toFixed(1)}, {ann.y.toFixed(1)}, {ann.z.toFixed(1)})</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="p-5 rounded-2xl bg-[#1c1917]/20 border border-[#292524]">
      <div className="text-[11px] text-[#a8a29e]/25 uppercase tracking-wider font-medium mb-2">{label}</div>
      <div className="text-2xl font-bold text-[#d4a053] tracking-tight">{value}</div>
      {sub && <div className="text-[12px] text-[#a8a29e]/25 mt-1">{sub}</div>}
    </div>
  )
}

const exportFormats = [
  { name: 'OBJ + MTL', desc: 'Textured mesh', ext: '.obj' },
  { name: 'PLY', desc: 'Point cloud', ext: '.ply' },
  { name: 'GLTF', desc: 'Web 3D', ext: '.glb' },
  { name: 'GeoTIFF', desc: 'Orthophoto', ext: '.tif' },
  { name: 'DEM', desc: 'Elevation model', ext: '.tif' },
  { name: 'LasPy', desc: 'LiDAR cloud', ext: '.las' },
]

export default function ResultsPage() {
  const router = useRouter()
  const { processingComplete, metrics, pointCloud, annotations, trajectory, videoFile } = useDroneVizStore()
  useEffect(() => { if (!processingComplete && !metrics) router.push('/droneviz3d/upload') }, [processingComplete, metrics, router])
  if (!metrics) return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center">
      <div className="text-center">
        <div className="text-[#a8a29e]/20 text-[15px] mb-4">No results yet</div>
        <a href="/droneviz3d/upload" className="text-[#c27a3a] text-[13px] hover:underline">Upload a video first</a>
      </div>
    </div>
  )
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 pt-10 pb-20">
        <div className="flex items-center gap-3 text-[12px] text-[#a8a29e]/30 mb-6">
          <a href="/droneviz3d" className="hover:text-[#c27a3a] transition-colors">Home</a><span>/</span>
          <span className="text-[#a8a29e]/50">Results</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#e7e5e4] mb-2">Reconstruction results</h1>
        <p className="text-[#a8a29e]/35 text-[14px] mb-10">{videoFile?.name} - Processed</p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-10">
          <MetricCard label="Total Points" value={metrics.totalPoints} />
          <MetricCard label="Accuracy" value={metrics.accuracy} />
          <MetricCard label="Time" value={metrics.processingTime} />
          <MetricCard label="Coverage" value={metrics.coverage} />
          <MetricCard label="Confidence" value={metrics.confidenceScore} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <ConfidenceHeatmap points={pointCloud} />
            <ConfidenceAnnotations annotations={annotations} />
          </div>
          <div className="space-y-6">
            <div className="p-5 rounded-2xl bg-[#1c1917]/20 border border-[#292524]">
              <h3 className="text-[13px] font-semibold text-[#e7e5e4]/60 mb-4">Export Model</h3>
              <div className="space-y-2">
                {exportFormats.map((fmt) => (
                  <button key={fmt.name} className="w-full flex items-center gap-3 p-3 rounded-xl bg-[#0c0a09]/30 border border-[#292524] hover:border-[#c27a3a]/15 transition-all text-left group">
                    <div className="flex-1">
                      <div className="text-[13px] text-[#a8a29e]/50 font-medium group-hover:text-[#d4a053]/70 transition-colors">{fmt.name}</div>
                      <div className="text-[11px] text-[#a8a29e]/20">{fmt.desc}</div>
                    </div>
                    <span className="text-[10px] text-[#a8a29e]/15 bg-[#1c1917]/50 px-2 py-0.5 rounded">{fmt.ext}</span>
                  </button>
                ))}
              </div>
            </div>
            <a href="/droneviz3d/viewer" className="block w-full py-3.5 rounded-xl bg-[#c27a3a] text-[#0c0a09] font-semibold text-[14px] text-center">Open 3D Viewer</a>
          </div>
        </div>
      </div>
    </div>
  )
}
