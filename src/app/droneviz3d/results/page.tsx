'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useDroneVizStore, type ConfidenceAnnotation } from '../store'
import { EXPORT_FORMATS, exportAs, type ExportFormatId, ExportPayload } from '../exporter'
import { buildSceneModel } from '../scene'
import { VIEWER_PALETTE, renderScene } from '../viewer-render'
import { frameCamera } from '../viewer-camera'
import { countByBand } from '../confidence'
import { buildMetricGroups, deriveReconstructionStatus, type MetricEntry, type StatusTone } from '../results-view'

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'border-[#292524] bg-[#1c1917]/30',
  info: 'border-cyan-400/30 bg-cyan-400/[0.07]',
  warning: 'border-amber-400/40 bg-amber-400/[0.08]',
  error: 'border-red-400/40 bg-red-400/[0.08]',
  success: 'border-[#c27a3a]/30 bg-[#c27a3a]/[0.06]',
}

const TONE_TEXT: Record<StatusTone, string> = {
  neutral: 'text-[#e7e5e4]',
  info: 'text-cyan-200',
  warning: 'text-amber-200',
  error: 'text-red-200',
  success: 'text-[#d4a053]',
}

function ConfidenceDistribution({ points }: { points: { confidence: number }[] }) {
  const counts = useMemo(() => countByBand(points.map((p) => p.confidence)), [points])
  const total = points.length
  return (
    <div className="p-5 rounded-2xl bg-[#1c1917]/20 border border-[#292524]">
      <h3 className="text-[13px] font-semibold text-[#e7e5e4] mb-1">Confidence distribution</h3>
      <p className="text-[11px] text-[#a8a29e] mb-4">
        Same scale as the 3D viewer — {total.toLocaleString()} generated points.
      </p>
      {total === 0 ? (
        <p className="text-[11px] text-[#a8a29e]">No points stored, so there is nothing to chart.</p>
      ) : (
        <div className="space-y-4">
          {counts.map(({ band, count, share }) => (
            <div key={band.id}>
              <div className="flex items-center justify-between mb-1">
                <span className="flex items-center gap-2 text-[12px] text-[#a8a29e]">
                  <span className={`w-2.5 h-2.5 rounded ${band.barClass}`} aria-hidden="true" />
                  {band.label}
                </span>
                <span className={`text-[12px] font-mono ${band.textClass}`}>
                  {count.toLocaleString()} ({(share * 100).toFixed(1)}%)
                </span>
              </div>
              <div
                className="h-2 bg-[#1c1917] rounded-full overflow-hidden"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={count}
                aria-label={`${band.label} confidence (${band.description}): ${count} of ${total} points`}
              >
                <div className={`h-full ${band.barClass} rounded-full transition-all`} style={{ width: `${share * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
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
      {annotations.length === 0 ? (
        <p className="text-[11px] text-[#a8a29e]">
          No weak regions were flagged for this run — every detected object was seen from enough keyframes to fuse
          cleanly.
        </p>
      ) : (
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
      )}
    </div>
  )
}

function MetricGroup({
  title, subtitle, entries, tone,
}: { title: string; subtitle: string; entries: MetricEntry[]; tone: 'measured' | 'estimated' }) {
  return (
    <section className="p-5 rounded-2xl bg-[#1c1917]/20 border border-[#292524]">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h3 className="text-[13px] font-semibold text-[#e7e5e4]">{title}</h3>
        <span
          className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-mono ${
            tone === 'measured' ? 'bg-[#4d7c5e]/20 text-[#8fb79c]' : 'bg-[#c27a3a]/15 text-[#d4a053]'
          }`}
        >
          {tone}
        </span>
      </div>
      <p className="text-[11px] text-[#a8a29e] mb-4">{subtitle}</p>
      {entries.length === 0 ? (
        <p className="text-[11px] text-[#a8a29e]">Nothing to report.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-3">
          {entries.map((entry) => (
            <div key={entry.id} className="p-3 rounded-xl bg-[#0c0a09]/30 border border-[#292524]">
              <dt className="text-[10px] text-[#a8a29e] uppercase tracking-wider mb-1">{entry.label}</dt>
              <dd className={`text-[18px] font-bold tracking-tight ${tone === 'measured' ? 'text-[#8fb79c]' : 'text-[#d4a053]'}`}>
                {entry.value}
              </dd>
              <p className="text-[10px] text-[#a8a29e] mt-1 leading-snug">{entry.note}</p>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

export default function ResultsPage() {
  const router = useRouter()
  const {
    processingComplete, isProcessing, metrics, pointCloud, annotations, trajectory,
    trackedObjects, bounds, videoFile, videoName, metadata, restoredFromStorage, reset,
  } = useDroneVizStore()

  const sceneModel = useMemo(
    () => buildSceneModel({ pointCloud, trajectory, trackedObjects, metadata }),
    [pointCloud, trajectory, trackedObjects, metadata]
  )

  const status = deriveReconstructionStatus({
    processingComplete,
    isProcessing,
    hasMetrics: !!metrics,
    pointCount: pointCloud.length,
    objectCount: trackedObjects.length,
    restoredFromStorage,
  })

  const groups = buildMetricGroups({ metrics, trackedObjects })
  const [exportError, setExportError] = useState<string | null>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)

  // The preview is the same renderer the viewer uses, framed on the same bounds,
  // so what you see here is what the viewer shows.
  useEffect(() => {
    const canvas = previewRef.current
    if (!canvas || sceneModel.empty) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(240, Math.round(canvas.clientWidth || 480))
    const height = 220
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const viewport = { width, height }
    renderScene(ctx, {
      camera: frameCamera(sceneModel.bounds, viewport),
      viewport,
      bounds: sceneModel.bounds,
      points: sceneModel.points,
      trajectoryPath: sceneModel.trajectoryPath,
      objects: sceneModel.objects,
      pointSize: 2,
      colorMode: 'rgb',
      showDetections: true,
      showTrajectory: true,
      selectedIndex: null,
      palette: VIEWER_PALETTE,
    })
  }, [sceneModel])

  const exportPayload: ExportPayload = {
    points: pointCloud, trajectory, metrics, bounds,
    origin: bounds ? { lat: (bounds.minLat + bounds.maxLat) / 2, lng: (bounds.minLng + bounds.maxLng) / 2 } : null,
  }

  const handleExport = (format: ExportFormatId) => {
    setExportError(null)
    if (!status.canExport) {
      setExportError(
        'There is no point cloud stored, so there is nothing to export. Re-run the upload to regenerate the geometry.'
      )
      return
    }
    try {
      exportAs(format, exportPayload)
    } catch (error) {
      setExportError(
        `Export failed: ${error instanceof Error ? error.message : 'the browser blocked the download'}. Your model is still stored in this browser — try again, or copy the metrics above first.`
      )
    }
  }

  const fileName = videoFile?.name ?? videoName
  const fileNote = videoFile ? 'processed' : videoName ? 'restored in this browser' : null

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 pt-10 pb-20">
        <nav aria-label="Breadcrumb" className="flex items-center gap-3 text-[12px] text-[#a8a29e] mb-6">
          <a href="/droneviz3d" className="hover:text-[#d4a053] transition-colors">Home</a>
          <span aria-hidden="true">/</span>
          <span className="text-[#e7e5e4]">Results</span>
        </nav>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#e7e5e4] mb-2">Reconstruction results</h1>
        <p className="text-[#a8a29e] text-[14px] mb-6">
          {fileName ? `${fileName} — ${fileNote}` : 'No video recorded for this model'}
        </p>

        {/* Status first: the user must know what they are looking at before any number. */}
        <div className={`mb-8 p-4 rounded-xl border ${TONE_CLASSES[status.tone]}`} role="status">
          <p className={`text-[13px] font-semibold ${TONE_TEXT[status.tone]}`}>{status.title}</p>
          <p className="text-[12px] text-[#e7e5e4] leading-relaxed mt-1">{status.detail}</p>
        </div>

        {/* Model preview */}
        <section className="mb-8 p-5 rounded-2xl bg-[#1c1917]/20 border border-[#292524]">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-[13px] font-semibold text-[#e7e5e4]">Model preview</h2>
              <p className="text-[11px] text-[#a8a29e]">
                {status.canExport
                  ? 'The generated model, drawn in its East-North-Up frame. Open the viewer to inspect individual detections.'
                  : 'No geometry to preview.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/droneviz3d/viewer"
                aria-disabled={!status.canExport}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
                  status.canExport
                    ? 'bg-[#c27a3a] text-[#0c0a09] hover:bg-[#d4a053]'
                    : 'bg-[#292524] text-[#a8a29e] pointer-events-none'
                }`}
              >
                Open 3D viewer
              </Link>
            </div>
          </div>
          <div className="rounded-xl overflow-hidden border border-[#292524] bg-[#09090b]">
            {status.canExport ? (
              <canvas ref={previewRef} className="block w-full" style={{ height: 220 }} role="img"
                aria-label={`Preview of the reconstructed model with ${pointCloud.length.toLocaleString()} points and ${trackedObjects.length} grounded objects.`}
              />
            ) : (
              <div className="h-[220px] flex items-center justify-center text-[12px] text-[#a8a29e] px-6 text-center">
                {status.id === 'empty'
                  ? 'Upload drone footage to generate a model.'
                  : status.id === 'running'
                    ? 'The pipeline is still running — the preview appears when it finishes.'
                    : 'The point cloud is not available, so there is nothing to draw.'}
              </div>
            )}
          </div>
          {status.canExport && (
            <div className="flex flex-wrap gap-4 mt-3 text-[11px] text-[#a8a29e] font-mono">
              <span>{sceneModel.points.length.toLocaleString()} model points</span>
              <span>{sceneModel.objects.length} grounded objects</span>
              <span>{sceneModel.trajectoryPath.length} flight poses</span>
              {bounds && <span>georeferenced to {metadata.gpsLat}, {metadata.gpsLng}</span>}
            </div>
          )}
        </section>

        {/* Metrics, split by how they were obtained */}
        {metrics && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
              <MetricGroup
                title="Measured from your upload"
                subtitle="Counts of what the grounding model actually detected in the sampled keyframes."
                entries={groups.measured}
                tone="measured"
              />
              <MetricGroup
                title="Estimated by the pipeline"
                subtitle="Numbers that come out of the geometry synthesis step. They describe the generated model, not the real world."
                entries={groups.estimated}
                tone="estimated"
              />
            </div>

            <div className="mb-8 p-4 rounded-xl border border-[#c27a3a]/30 bg-[#c27a3a]/[0.06]" role="note">
              <p className="text-[12px] text-[#e7e5e4] leading-relaxed">
                <strong className="text-[#d4a053]">How this model was generated:</strong> {metrics.provenance}.
                Object positions and footprints come from LocateAnything-3B detections projected through your flight
                metadata; heights and the surface detail between detected objects are synthesized. A single pass gives
                no stereo baseline, so none of these numbers are survey-grade measurements.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
              <ConfidenceDistribution points={pointCloud} />
              <ConfidenceAnnotations annotations={annotations} />
            </div>
          </>
        )}

        {/* Exports */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">
            <div className="p-5 rounded-2xl bg-[#1c1917]/20 border border-[#292524]">
              <h3 className="text-[13px] font-semibold text-[#e7e5e4] mb-1">Export model</h3>
              <p className="text-[11px] text-[#a8a29e] mb-4">
                {status.canExport
                  ? 'Exports contain the generated point cloud in the local East-North-Up frame.'
                  : 'Exports need the point cloud, which this session does not have.'}
              </p>
              <div className="space-y-2">
                {EXPORT_FORMATS.map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => handleExport(fmt.id as ExportFormatId)}
                    disabled={!status.canExport}
                    aria-describedby={exportError ? 'export-error' : undefined}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl bg-[#0c0a09]/30 border border-[#292524] transition-all text-left group focus-visible:border-[#c27a3a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053] ${
                      status.canExport ? 'hover:border-[#c27a3a]/40' : 'opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex-1">
                      <div className={`text-[13px] text-[#e7e5e4] font-medium ${status.canExport ? 'group-hover:text-[#d4a053]' : ''} transition-colors`}>
                        {fmt.name}
                      </div>
                      <div className="text-[11px] text-[#a8a29e]">{fmt.description}</div>
                    </div>
                    <span className="text-[10px] text-[#a8a29e] bg-[#1c1917]/70 px-2 py-0.5 rounded font-mono">.{fmt.ext}</span>
                    <span aria-hidden="true" className="text-[#a8a29e] group-hover:text-[#d4a053]">↓</span>
                  </button>
                ))}
              </div>

              {exportError && (
                <div id="export-error" role="alert" className="mt-3 p-3 rounded-lg border border-red-400/40 bg-red-400/[0.08]">
                  <p className="text-[12px] text-red-200">{exportError}</p>
                </div>
              )}

              <p className="text-[11px] text-[#a8a29e] mt-3 leading-relaxed">
                Survey-grade formats (GeoTIFF orthophoto, DEM, LAS) are not offered because they require a
                photogrammetry backend this demo does not run.
              </p>
            </div>

            <details className="p-4 rounded-xl border border-[#292524] bg-[#1c1917]/20">
              <summary className="text-[13px] text-[#e7e5e4] cursor-pointer">Flight metadata used for this reconstruction</summary>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 text-[12px]">
                {[
                  ['GPS reference', `${metadata.gpsLat}, ${metadata.gpsLng}`],
                  ['Altitude', `${metadata.altitude} m`],
                  ['Speed', `${metadata.speed} m/s`],
                  ['Heading', `${metadata.heading}°`],
                  ['Camera', `${metadata.cameraFocalLength} mm, ${metadata.cameraWidth}×${metadata.cameraHeight}`],
                  ['RTK corrections', metadata.rtkCorrections ? 'Yes' : 'No'],
                ].map(([key, value]) => (
                  <div key={key} className="p-2 rounded-lg bg-[#0c0a09]/40">
                    <dt className="text-[#a8a29e]">{key}</dt>
                    <dd className="text-[#e7e5e4] font-mono mt-0.5">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-[11px] text-[#a8a29e] mt-3">
                This metadata stayed in your browser and is kept here with the model until you
                reset — nothing was uploaded to a server.
              </p>
            </details>
          </div>

          <div className="space-y-3">
            <Link
              href="/droneviz3d/viewer"
              className={`block w-full py-3.5 rounded-xl font-semibold text-[14px] text-center transition-colors ${
                status.canExport
                  ? 'bg-[#c27a3a] text-[#0c0a09] hover:bg-[#d4a053]'
                  : 'bg-[#292524] text-[#a8a29e] pointer-events-none'
              }`}
            >
              Open 3D viewer
            </Link>
            <Link
              href="/droneviz3d/upload"
              className="block w-full py-3 rounded-xl border border-[#292524] text-[#e7e5e4] font-medium text-[14px] text-center hover:bg-[#1c1917]/50 transition-colors"
            >
              Process another video
            </Link>
            <button
              type="button"
              onClick={() => {
                // Deleting a stored model is irreversible — nothing is on a server, so
                // there is nothing to restore it from. Ask before discarding.
                if (status.canExport && !window.confirm('Delete this model from this browser? It cannot be recovered — export it first if you want to keep it.')) return
                reset()
                router.push('/droneviz3d/upload')
              }}
              aria-describedby="reset-model-note"
              className="block w-full py-3 rounded-xl border border-[#292524] text-[#a8a29e] font-medium text-[14px] text-center hover:bg-[#1c1917]/50 hover:text-[#e7e5e4] transition-colors"
            >
              Reset — delete this model from this browser
            </button>
          </div>
          <p id="reset-model-note" className="text-[11px] text-[#a8a29e] mt-3 leading-relaxed">
            Reset is what the privacy policy calls erasure: it permanently deletes the stored model,
            its detections and the flight metadata from this browser. There is no copy on a server, so
            it cannot be recovered — export the model first if you want to keep it.
          </p>
        </div>
      </div>
    </div>
  )
}
