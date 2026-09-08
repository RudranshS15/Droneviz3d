'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useDroneVizStore, type Point3D } from '../store'

interface ViewObject {
  label: string
  x: number; y: number; z: number
}

function renderPointCloud(
  canvas: HTMLCanvasElement,
  points: Point3D[],
  objects: ViewObject[],
  mode: 'rgb' | 'confidence',
  rotX: number,
  rotY: number,
  zoom: number
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvas.width
  const h = canvas.height
  ctx.fillStyle = '#09090b'
  ctx.fillRect(0, 0, w, h)

  const cosX = Math.cos(rotX), sinX = Math.sin(rotX)
  const cosY = Math.cos(rotY), sinY = Math.sin(rotY)

  // Project and sort by depth
  const projected: { x: number; y: number; z: number; color: string; size: number }[] = []

  for (const p of points) {
    // Rotate
    let x = p.x * cosY - p.z * sinY
    let z = p.x * sinY + p.z * cosY
    let y = p.y * cosX - z * sinX
    z = p.y * sinX + z * cosX

    // Perspective
    const fov = 400 * zoom
    const depth = z + 15
    if (depth < 0.5) continue
    const sx = w / 2 + (x / depth) * fov
    const sy = h / 2 - (y / depth) * fov

    let color: string
    if (mode === 'confidence') {
      const c = p.confidence
      if (c > 0.8) color = `rgba(34, 211, 238, ${0.4 + c * 0.5})`
      else if (c > 0.5) color = `rgba(251, 191, 36, ${0.3 + c * 0.5})`
      else color = `rgba(248, 113, 113, ${0.3 + c * 0.5})`
    } else {
      color = `rgb(${p.r}, ${p.g}, ${p.b})`
    }

    const size = Math.max(0.5, (2 / depth) * fov * 0.008)
    projected.push({ x: sx, y: sy, z, color, size })
  }

  // Sort back to front
  projected.sort((a, b) => b.z - a.z)

  for (const p of projected) {
    ctx.fillStyle = p.color
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
  }

  // Object markers (grounded detections)
  ctx.font = '11px sans-serif'
  for (const o of objects) {
    let x = o.x * cosY - o.z * sinY
    let z = o.x * sinY + o.z * cosY
    let y = o.y * cosX - z * sinX
    z = o.y * sinX + z * cosX
    const fov = 400 * zoom
    const depth = z + 15
    if (depth < 0.5) continue
    const sx = w / 2 + (x / depth) * fov
    const sy = h / 2 - (y / depth) * fov
    ctx.strokeStyle = 'rgba(212, 160, 83, 0.9)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(sx, sy, 5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = 'rgba(231, 229, 228, 0.95)'
    ctx.fillText(o.label, sx + 8, sy + 3)
  }

  // Axes
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(w / 2, h / 2)
  ctx.lineTo(w / 2 + 60 * zoom, h / 2)
  ctx.stroke()
  ctx.fillStyle = 'rgba(231,229,228,0.9)'
  ctx.font = '10px monospace'
  ctx.fillText('X', w / 2 + 65 * zoom, h / 2 + 4)
  ctx.beginPath()
  ctx.moveTo(w / 2, h / 2)
  ctx.lineTo(w / 2, h / 2 - 60 * zoom)
  ctx.stroke()
  ctx.fillText('Y', w / 2 + 4, h / 2 - 65 * zoom)
  ctx.beginPath()
  ctx.moveTo(w / 2, h / 2)
  ctx.lineTo(w / 2 + 40 * zoom, h / 2 + 30 * zoom)
  ctx.stroke()
  ctx.fillText('Z', w / 2 + 45 * zoom, h / 2 + 35 * zoom)

  // Info — contrast-checked overlay text
  ctx.fillStyle = 'rgba(231,229,228,0.9)'
  ctx.font = '11px sans-serif'
  ctx.fillText(`${points.length.toLocaleString()} points · ${mode === 'confidence' ? 'Confidence' : 'RGB'} mode`, 16, h - 16)
}

export default function ViewerPage() {
  const router = useRouter()
  const { pointCloud, processingComplete, trackedObjects } = useDroneVizStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<'rgb' | 'confidence'>('rgb')
  const [rotX, setRotX] = useState(0.4)
  const [rotY, setRotY] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const lastMouse = useRef({ x: 0, y: 0 })
  const animRef = useRef<number>(0)
  const [autoRotate, setAutoRotate] = useState(false)

  // Respect reduced-motion preference: no auto rotation unless explicitly enabled.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setAutoRotate(false)
  }, [])

  useEffect(() => {
    if (!processingComplete && pointCloud.length === 0) {
      router.push('/droneviz3d/upload')
    }
  }, [processingComplete, pointCloud.length, router])

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || pointCloud.length === 0) return

    let ry = rotY
    const animate = () => {
      if (autoRotate && !isDragging) ry += 0.003
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = rect.width + 'px'
      canvas.style.height = rect.height + 'px'

      renderPointCloud(
        canvas, pointCloud,
        trackedObjects.slice(0, 24).map((t) => ({ label: t.label, x: t.center.x, y: t.center.y, z: t.center.z })),
        mode, rotX, ry, zoom
      )
      animRef.current = requestAnimationFrame(animate)
    }
    animate()
    return () => cancelAnimationFrame(animRef.current)
  }, [pointCloud, trackedObjects, mode, rotX, rotY, zoom, autoRotate, isDragging]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return
    const dx = e.clientX - lastMouse.current.x
    const dy = e.clientY - lastMouse.current.y
    setRotY((r) => r + dx * 0.005)
    setRotX((r) => r + dy * 0.005)
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }, [isDragging])

  const handleMouseUp = () => setIsDragging(false)

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom((z) => Math.max(0.3, Math.min(3, z - e.deltaY * 0.001)))
  }, [])

  // Keyboard controls for non-pointer users
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const ROT = 0.08
    switch (e.key) {
      case 'ArrowLeft': setRotY((r) => r - ROT); break
      case 'ArrowRight': setRotY((r) => r + ROT); break
      case 'ArrowUp': setRotX((r) => r - ROT); break
      case 'ArrowDown': setRotX((r) => r + ROT); break
      case '+': case '=': setZoom((z) => Math.min(3, z + 0.1)); break
      case '-': case '_': setZoom((z) => Math.max(0.3, z - 0.1)); break
      default: return
    }
    e.preventDefault()
  }, [])

  if (pointCloud.length === 0) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center">
        <div className="text-center">
          <div className="text-[#a8a29e] text-[15px] mb-4">No 3D data available</div>
          <a href="/droneviz3d/upload" className="text-[#d4a053] text-[13px] hover:underline">Upload a video first</a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Header */}
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 pt-6 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <nav aria-label="Breadcrumb" className="flex items-center gap-3 text-[12px] text-[#a8a29e] mb-2 font-mono">
              <a href="/droneviz3d" className="hover:text-[#d4a053] transition-colors">Home</a>
              <span aria-hidden="true">/</span>
              <span className="text-[#e7e5e4]">3D Viewer</span>
            </nav>
            <h1 className="text-2xl font-bold tracking-tight text-[#e7e5e4]">
              Interactive 3D Model
            </h1>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Viewer display controls">
            <button
              type="button"
              onClick={() => setMode(mode === 'rgb' ? 'confidence' : 'rgb')}
              aria-pressed={mode === 'confidence'}
              className="px-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.12] text-[12px] text-[#e7e5e4] hover:bg-white/[0.1] transition-all font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053]"
            >
              {mode === 'rgb' ? 'Show confidence view' : 'Show color view'}
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
              {autoRotate ? 'Stop auto-rotate' : 'Start auto-rotate'}
            </button>
            <button
              type="button"
              onClick={() => { setRotX(0.4); setRotY(0); setZoom(1) }}
              className="px-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.12] text-[12px] text-[#e7e5e4] hover:bg-white/[0.1] transition-all font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053]"
            >
              Reset view
            </button>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 pb-6">
        <div
          className="relative w-full rounded-2xl border border-white/[0.08] overflow-hidden bg-[#09090b] cursor-grab active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d4a053]"
          style={{ height: 'calc(100vh - 14rem)' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="img"
          aria-label={`3D point cloud with ${pointCloud.length.toLocaleString()} points. Drag to rotate, scroll to zoom, or use arrow keys to rotate and plus and minus keys to zoom. Markers show grounded objects detected by LocateAnything-3B.`}
        >
          <canvas ref={canvasRef} className="w-full h-full" aria-hidden="true" />

          {/* Overlay info */}
          <div className="absolute bottom-4 left-4 flex items-center gap-3">
            <div className="px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur-sm text-[11px] text-[#e7e5e4] font-mono">
              Drag to rotate · Scroll to zoom · Arrow keys rotate, +/− zoom
            </div>
          </div>

          {mode === 'confidence' && (
            <div className="absolute top-4 right-4 p-3 rounded-lg bg-black/70 backdrop-blur-sm space-y-1" aria-hidden="true">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-2.5 h-2.5 rounded bg-cyan-400" />
                <span className="text-[#e7e5e4]">High confidence (&gt;0.8)</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-2.5 h-2.5 rounded bg-amber-400" />
                <span className="text-[#e7e5e4]">Medium (0.5–0.8)</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-2.5 h-2.5 rounded bg-red-400" />
                <span className="text-[#e7e5e4]">Low confidence (&lt;0.5)</span>
              </div>
            </div>
          )}
        </div>

        {/* Grounded objects legend */}
        {trackedObjects.length > 0 && (
          <div className="mt-4">
            <h2 className="text-[12px] font-semibold text-[#e7e5e4] mb-2">
              Grounded by LocateAnything-3B — {trackedObjects.length} object{trackedObjects.length === 1 ? '' : 's'}
            </h2>
            <ul className="flex flex-wrap gap-2" aria-label="Detected object classes">
              {Array.from(new Set(trackedObjects.map((t) => t.label))).map((label) => {
                const count = trackedObjects.filter((t) => t.label === label).length
                return (
                  <li key={label} className="px-2.5 py-1 rounded-lg bg-white/[0.05] border border-white/[0.1] text-[11px] text-[#e7e5e4]">
                    {label} × {count}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
