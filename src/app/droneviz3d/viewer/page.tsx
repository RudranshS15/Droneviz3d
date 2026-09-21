'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDroneVizStore } from '../store'
import { buildSceneModel } from '../scene'
import { ColorMode, VIEWER_PALETTE, renderScene } from '../viewer-render'
import { CONFIDENCE_BANDS, bandFor } from '../confidence'
import { objectObservations } from '../results-view'
import { localToLngLat } from '../geometry'
import {
  DEFAULT_FOV_Y, OrbitCamera, ViewPreset, VIEW_PRESETS, Viewport, clampDistance,
  clampElevation, degToRad, focusCamera, frameCamera, pickNearestObject, radToDeg,
} from '../viewer-camera'

const DEFAULT_ELEVATION = degToRad(28)

export default function ViewerPage() {
  const router = useRouter()
  const { pointCloud, processingComplete, trackedObjects, trajectory, metadata, hydrated } = useDroneVizStore()

  const sceneModel = useMemo(
    () => buildSceneModel({ pointCloud, trajectory, trackedObjects, metadata }),
    [pointCloud, trajectory, trackedObjects, metadata]
  )

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<{ index: number; x: number; y: number }[]>([])
  const dragRef = useRef({ active: false, x: 0, y: 0, moved: 0 })

  const [viewport, setViewport] = useState<Viewport>({ width: 960, height: 600 })
  const [camera, setCamera] = useState<OrbitCamera | null>(null)
  const [colorMode, setColorMode] = useState<ColorMode>('rgb')
  const [showDetections, setShowDetections] = useState(true)
  const [showTrajectory, setShowTrajectory] = useState(true)
  const [pointSize, setPointSize] = useState(3)
  const [selected, setSelected] = useState<number | null>(null)
  const [autoRotate, setAutoRotate] = useState(false)
  const [pathVisible, setPathVisible] = useState(false)
  const [labelsDrawn, setLabelsDrawn] = useState<number | null>(null)

  // Frame the model once it (or the viewport) changes. The camera keeps the
  // user's viewing angles — only the distance is recomputed to fit.
  useEffect(() => {
    if (sceneModel.empty) return
    setCamera((current) =>
      frameCamera(
        sceneModel.bounds,
        viewport,
        DEFAULT_FOV_Y,
        current?.azimuth ?? 0,
        current?.elevation ?? DEFAULT_ELEVATION
      )
    )
  }, [sceneModel, viewport])

  // Track the drawing surface size so framing and projection agree on aspect.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))
      // Only react to real changes: the canvas is sized from this value, and a
      // feedback loop here would re-frame the camera forever.
      setViewport((previous) => (previous.width === width && previous.height === height ? previous : { width, height }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [pointCloud.length])

  // Respect reduced-motion preference: no auto rotation unless explicitly enabled.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setAutoRotate(false)
  }, [])

  // Wait for rehydration before deciding there is nothing to show, so a hard
  // load of /viewer with a restored model renders instead of bouncing to Upload.
  useEffect(() => {
    if (!hydrated) return
    if (!processingComplete && pointCloud.length === 0) {
      router.push('/droneviz3d/upload')
    }
  }, [hydrated, processingComplete, pointCloud.length, router])

  // Auto-rotate: advance the azimuth on an animation frame, which redraws through
  // the normal render path (so the gizmo and markers stay in sync).
  useEffect(() => {
    if (!autoRotate) return
    let frame = 0
    const tick = () => {
      if (!dragRef.current.active) {
        setCamera((c) => (c ? { ...c, azimuth: c.azimuth + 0.004 } : c))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [autoRotate])

  // Draw. Everything the canvas shows comes from the camera basis, so the
  // orientation gizmo can never disagree with the model.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !camera || sceneModel.empty) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(viewport.width * dpr))
    canvas.height = Math.max(1, Math.round(viewport.height * dpr))
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const stats = renderScene(ctx, {
      camera,
      viewport,
      bounds: sceneModel.bounds,
      points: sceneModel.points,
      trajectoryPath: sceneModel.trajectoryPath,
      objects: sceneModel.objects,
      pointSize,
      colorMode,
      showDetections,
      showTrajectory,
      selectedIndex: selected,
      palette: VIEWER_PALETTE,
    })
    markersRef.current = stats.markers
    // Only re-render when these actually change, so auto-rotate stays cheap.
    setPathVisible((previous) => (previous === stats.trajectoryVisible ? previous : stats.trajectoryVisible))
    setLabelsDrawn((previous) => (previous === stats.labelsDrawn ? previous : stats.labelsDrawn))
  }, [sceneModel, camera, viewport, colorMode, showDetections, showTrajectory, pointSize, selected])

  const selectObject = useCallback(
    (index: number) => {
      const object = sceneModel.objects[index]
      if (!object) return
      setSelected(index)
      setCamera((current) =>
        current
          ? focusCamera(current, object.center, Math.max(object.halfExtentX, object.halfExtentY, 1), viewport)
          : current
      )
    },
    [sceneModel, viewport]
  )

  const resetView = useCallback(() => {
    setSelected(null)
    setCamera(frameCamera(sceneModel.bounds, viewport, DEFAULT_FOV_Y))
  }, [sceneModel, viewport])

  const applyPreset = useCallback(
    (preset: ViewPreset) => {
      setCamera((current) =>
        current
          ? { ...current, azimuth: preset.azimuth, elevation: preset.elevation }
          : frameCamera(sceneModel.bounds, viewport, DEFAULT_FOV_Y, preset.azimuth, preset.elevation)
      )
    },
    [sceneModel, viewport]
  )

  // The drone cruises well above a flat reconstruction, so the flight path is
  // usually outside the model-framed view. This frames model + nearby path from
  // a lower, more side-on angle so the leg is readable.
  const fitFlightPath = useCallback(() => {
    setSelected(null)
    setCamera(frameCamera(sceneModel.pathBounds, viewport, DEFAULT_FOV_Y, 0, degToRad(12)))
  }, [sceneModel, viewport])

  const handlePointerDown = (e: React.PointerEvent) => {
    dragRef.current = { active: true, x: e.clientX, y: e.clientY, moved: 0 }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return
    const dx = e.clientX - dragRef.current.x
    const dy = e.clientY - dragRef.current.y
    dragRef.current.moved += Math.abs(dx) + Math.abs(dy)
    dragRef.current.x = e.clientX
    dragRef.current.y = e.clientY
    setCamera((current) => {
      if (!current) return current
      // East-to-West drags should spin the model the way you push it.
      const azimuth = current.azimuth - dx * 0.006
      const elevation = current.elevation + dy * 0.006
      return { ...current, azimuth, elevation: clampElevation(elevation) }
    })
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    const wasDrag = dragRef.current.moved > 4
    dragRef.current.active = false
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (wasDrag) return

    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const hit = pickNearestObject(markersRef.current, e.clientX - rect.left, e.clientY - rect.top)
    if (hit === null) setSelected(null)
    else selectObject(hit)
  }

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setCamera((current) =>
      current ? { ...current, distance: clampDistance(current.distance * (1 + e.deltaY * 0.0015)) } : current
    )
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const ROT = 0.08
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        const dAz = e.key === 'ArrowLeft' ? -ROT : e.key === 'ArrowRight' ? ROT : 0
        const dEl = e.key === 'ArrowUp' ? ROT : e.key === 'ArrowDown' ? -ROT : 0
        setCamera((c) => (c ? { ...c, azimuth: c.azimuth + dAz, elevation: clampElevation(c.elevation + dEl) } : c))
        break
      }
      case '+':
      case '=':
        setCamera((c) => (c ? { ...c, distance: clampDistance(c.distance * 0.9) } : c))
        break
      case '-':
      case '_':
        setCamera((c) => (c ? { ...c, distance: clampDistance(c.distance * 1.1) } : c))
        break
      case 'Escape':
        setSelected(null)
        break
      default:
        return
    }
    e.preventDefault()
  }, [])

  const selectedObject = selected !== null ? sceneModel.objects[selected] ?? null : null
  const origin = sceneModel.origin

  const emptyState = (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center">
      <div className="text-center">
        <div className="text-[#a8a29e] text-[15px] mb-4">No 3D data available</div>
        <a href="/droneviz3d/upload" className="text-[#d4a053] text-[13px] hover:underline">
          Upload a video first
        </a>
      </div>
    </div>
  )

  if (pointCloud.length === 0 && sceneModel.trackMarkers.length === 0) return emptyState

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 pt-6 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <nav aria-label="Breadcrumb" className="flex items-center gap-3 text-[12px] text-[#a8a29e] mb-2 font-mono">
              <a href="/droneviz3d" className="hover:text-[#d4a053] transition-colors">Home</a>
              <span aria-hidden="true">/</span>
              <span className="text-[#e7e5e4]">3D Viewer</span>
            </nav>
            <h1 className="text-2xl font-bold tracking-tight text-[#e7e5e4]">Interactive 3D model</h1>
            <p className="text-[12px] text-[#a8a29e] mt-1 font-mono">
              {sceneModel.points.length.toLocaleString()} points · {sceneModel.objects.length} grounded object
              {sceneModel.objects.length === 1 ? '' : 's'}
              {camera ? ` · ${(camera.distance).toFixed(0)} m out · ${radToDeg(camera.azimuth).toFixed(0)}° / ${radToDeg(camera.elevation).toFixed(0)}°` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Viewer display controls">
            <button
              type="button"
              onClick={() => setColorMode(colorMode === 'rgb' ? 'confidence' : 'rgb')}
              aria-pressed={colorMode === 'confidence'}
              className="px-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.12] text-[12px] text-[#e7e5e4] hover:bg-white/[0.1] transition-all font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053]"
            >
              {colorMode === 'rgb' ? 'Show confidence colours' : 'Show source colours'}
            </button>
            <button
              type="button"
              onClick={() => setShowDetections(!showDetections)}
              aria-pressed={showDetections}
              className={`px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053] ${
                showDetections
                  ? 'bg-[#d4a053]/15 border-[#d4a053]/40 text-[#e7e5e4]'
                  : 'bg-white/[0.06] border-white/[0.12] text-[#a8a29e] hover:bg-white/[0.1]'
              }`}
            >
              Detections {showDetections ? 'on' : 'off'}
            </button>
            <button
              type="button"
              onClick={() => setShowTrajectory(!showTrajectory)}
              aria-pressed={showTrajectory}
              className={`px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053] ${
                showTrajectory
                  ? 'bg-[#d4a053]/15 border-[#d4a053]/40 text-[#e7e5e4]'
                  : 'bg-white/[0.06] border-white/[0.12] text-[#a8a29e] hover:bg-white/[0.1]'
              }`}
            >
              Flight path {showTrajectory ? 'on' : 'off'}
            </button>
            <button
              type="button"
              onClick={() => setAutoRotate(!autoRotate)}
              aria-pressed={autoRotate}
              className={`px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053] ${
                autoRotate
                  ? 'bg-cyan-500/15 border-cyan-400/40 text-cyan-200'
                  : 'bg-white/[0.06] border-white/[0.12] text-[#e7e5e4] hover:bg-white/[0.1]'
              }`}
            >
              {autoRotate ? 'Stop auto-rotate' : 'Auto-rotate'}
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.12]">
              <label htmlFor="point-size" className="text-[12px] text-[#e7e5e4] whitespace-nowrap">Point size</label>
              <input
                id="point-size"
                type="range"
                min={1}
                max={8}
                step={0.5}
                value={pointSize}
                onChange={(e) => setPointSize(Number(e.target.value))}
                className="w-24 accent-[#d4a053] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053]"
                aria-valuetext={`${pointSize} pixels`}
              />
              <span className="text-[11px] text-[#a8a29e] font-mono w-8" aria-hidden="true">{pointSize.toFixed(1)}</span>
            </div>
            <button
              type="button"
              onClick={resetView}
              className="px-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.12] text-[12px] text-[#e7e5e4] hover:bg-white/[0.1] transition-all font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053]"
            >
              Reset view
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3" role="group" aria-label="Camera presets">
          <span className="text-[11px] text-[#a8a29e] uppercase tracking-wider">View</span>
          {VIEW_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset)}
              className="px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.1] text-[11px] text-[#e7e5e4] hover:bg-white/[0.1] transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053]"
            >
              {preset.label}
            </button>
          ))}
          {sceneModel.trajectoryPath.length > 0 && (
            <button
              type="button"
              onClick={fitFlightPath}
              className="px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.1] text-[11px] text-[#e7e5e4] hover:bg-white/[0.1] transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053]"
            >
              Fit flight path
            </button>
          )}
          <span className="text-[11px] text-[#a8a29e] text-wrap">
            Ground plane is horizontal; the gizmo shows East, North and Up.
          </span>
        </div>
      </div>

      <div className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 pb-6">
        <div
          ref={containerRef}
          className="relative w-full rounded-2xl border border-white/[0.08] overflow-hidden bg-[#09090b] cursor-grab active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053] touch-none"
          style={{ height: 'calc(100vh - 17rem)' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={(e) => { dragRef.current.active = false; e.currentTarget.releasePointerCapture?.(e.pointerId) }}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="img"
          aria-label={`3D point cloud with ${sceneModel.points.length.toLocaleString()} points and ${sceneModel.objects.length} grounded objects, drawn in an East-North-Up frame. Drag to orbit, scroll to zoom, arrow keys rotate, plus and minus zoom, Escape clears the selection. Select an object from the list below for its supporting observations.`}
        >
          <canvas ref={canvasRef} className="block" aria-hidden="true" />

          <div className="absolute bottom-4 left-4 flex flex-wrap items-center gap-2 pointer-events-none">
            <div className="px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur-sm text-[11px] text-[#e7e5e4] font-mono">
              Drag to orbit · Scroll to zoom · Click a marker to inspect
            </div>
          </div>

          {colorMode === 'confidence' && (
            <div className="absolute top-4 right-4 p-3 rounded-lg bg-black/70 backdrop-blur-sm space-y-1 pointer-events-none">
              {CONFIDENCE_BANDS.map((band) => (
                <div key={band.id} className="flex items-center gap-2 text-[11px]">
                  <span className={`w-2.5 h-2.5 rounded ${band.barClass}`} aria-hidden="true" />
                  <span className="text-[#e7e5e4]">
                    {band.label} {band.maxExclusive === Infinity ? `(≥ ${band.min})` : `(${band.min}–${band.maxExclusive})`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {sceneModel.points.length === 0 && (
            <div className="absolute inset-x-0 top-4 mx-auto w-fit px-3 py-1.5 rounded-lg bg-black/80 text-[11px] text-[#e7e5e4]">
              No point cloud in this session — showing the flight path only.
            </div>
          )}

          {showDetections && labelsDrawn !== null && labelsDrawn < sceneModel.objects.length && (
            <div className="absolute bottom-4 left-4 max-w-[18rem] px-3 py-2 rounded-lg bg-black/80 backdrop-blur-sm text-[11px] text-[#e7e5e4]">
              {labelsDrawn} of {sceneModel.objects.length} labels shown — the rest overlap. Select one to label it.
            </div>
          )}

          {showTrajectory && sceneModel.trajectoryPath.length > 0 && !pathVisible && (
            <div className="absolute top-4 left-44 max-w-[16rem] px-3 py-2 rounded-lg bg-black/80 backdrop-blur-sm text-[11px] text-[#e7e5e4]">
              The flight path is outside this view — the drone cruises above the reconstructed ground.{' '}
              <button
                type="button"
                onClick={fitFlightPath}
                className="underline text-[#d4a053] hover:text-[#e7e5e4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053]"
              >
                Fit it in view
              </button>
              .
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <section className="p-4 rounded-2xl bg-[#1c1917]/20 border border-[#292524]">
            <h2 className="text-[12px] font-semibold text-[#e7e5e4] mb-1">
              Grounded objects — {sceneModel.objects.length}
            </h2>
            <p className="text-[11px] text-[#a8a29e] mb-3">
              Detected by LocateAnything-3B and fused across keyframes. Select one to focus the camera and see its evidence.
            </p>
            {sceneModel.objects.length === 0 ? (
              <p className="text-[11px] text-[#a8a29e]">
                No objects were grounded in the sampled keyframes, so only the ground surface is drawn.
              </p>
            ) : (
              <ul className="max-h-64 overflow-y-auto space-y-1 pr-1" aria-label="Grounded objects">
                {sceneModel.objects.map((object, index) => {
                  const band = bandFor(object.score)
                  return (
                    <li key={`${object.label}-${index}`}>
                      <button
                        type="button"
                        onClick={() => selectObject(index)}
                        aria-pressed={selected === index}
                        className={`w-full flex items-center gap-3 px-2.5 py-1.5 rounded-lg border text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053] ${
                          selected === index
                            ? 'border-cyan-400/50 bg-cyan-400/10'
                            : 'border-transparent hover:border-[#292524] hover:bg-white/[0.04]'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full ${band.barClass}`} aria-hidden="true" />
                        <span className="text-[12px] text-[#e7e5e4] flex-1">{object.label}</span>
                        <span className="text-[11px] text-[#a8a29e] font-mono">
                          {object.observations} obs · {Math.round(object.halfExtentX * 2)}×{Math.round(object.halfExtentY * 2)} m
                        </span>
                        <span className={`text-[11px] font-mono ${band.textClass}`}>{object.score.toFixed(2)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="p-4 rounded-2xl bg-[#1c1917]/20 border border-[#292524]" aria-live="polite">
            <h2 className="text-[12px] font-semibold text-[#e7e5e4] mb-1">Selected object</h2>
            {!selectedObject ? (
              <p className="text-[11px] text-[#a8a29e]">
                Nothing selected. Click a marker in the model or pick an object from the list to see where it was seen from.
              </p>
            ) : (
              <ObjectDetails
                object={selectedObject}
                origin={origin}
                onClear={() => setSelected(null)}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

interface ObjectDetailsProps {
  object: ReturnType<typeof buildSceneModel>['objects'][number]
  origin: { lat: number; lng: number } | null
  onClear: () => void
}

function ObjectDetails({ object, origin, onClear }: ObjectDetailsProps) {
  const band = bandFor(object.score)
  const observations = objectObservations(object)
  const position = origin
    ? localToLngLat(origin, object.center.x, object.center.y)
    : null

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${band.barClass}`} aria-hidden="true" />
          <span className="text-[13px] text-[#e7e5e4] font-medium">{object.label}</span>
          <span className={`text-[11px] font-mono ${band.textClass}`}>{band.label} confidence</span>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] text-[#a8a29e] hover:text-[#d4a053] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053]"
        >
          Clear selection
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-[11px] mb-4">
        {[
          ['Fused confidence', object.score.toFixed(2)],
          ['Supporting views', `${object.observations} keyframe${object.observations === 1 ? '' : 's'}`],
          ['Footprint', `${(object.halfExtentX * 2).toFixed(1)} × ${(object.halfExtentY * 2).toFixed(1)} m`],
          ['Ground position', `E ${object.center.x.toFixed(1)} m, N ${object.center.y.toFixed(1)} m`],
        ].map(([label, value]) => (
          <div key={label} className="p-2 rounded-lg bg-[#0c0a09]/40">
            <dt className="text-[#a8a29e]">{label}</dt>
            <dd className="text-[#e7e5e4] font-mono mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>

      {position && (
        <p className="text-[11px] text-[#a8a29e] mb-4 font-mono">
          {position.lat.toFixed(6)}, {position.lng.toFixed(6)}
        </p>
      )}

      <h3 className="text-[11px] font-semibold text-[#e7e5e4] uppercase tracking-wider mb-2">
        Supporting observations
      </h3>
      <p className="text-[11px] text-[#a8a29e] mb-2">
        Each row is one detection in one keyframe. The offset is how far that observation sat from the fused position — a
        large spread means the fused centre is less certain.
      </p>
      <ul className="space-y-1 max-h-52 overflow-y-auto pr-1">
        {observations.map((observation, index) => (
          <li
            key={`${observation.keyframeIndex}-${index}`}
            className="flex items-center gap-3 px-2.5 py-1.5 rounded-lg bg-[#0c0a09]/30 text-[11px] font-mono"
          >
            <span className="text-[#a8a29e]">kf {observation.keyframeIndex}</span>
            <span className="text-[#e7e5e4] flex-1">score {observation.score.toFixed(2)}</span>
            <span className="text-[#a8a29e]">from {observation.viewingAltitude.toFixed(0)} m up</span>
            <span className="text-[#a8a29e]">±{observation.offsetMeters.toFixed(1)} m</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-[#a8a29e] mt-3">
        Heights and surface detail between objects are synthesized; the positions, footprints and confidence values above
        come from the detections and your flight metadata.
      </p>
    </div>
  )
}
