'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useDroneVizStore, type Point3D } from '../store'

function renderPointCloud(
  canvas: HTMLCanvasElement,
  points: Point3D[],
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

  // Axes
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  // X axis
  ctx.beginPath()
  ctx.moveTo(w / 2, h / 2)
  ctx.lineTo(w / 2 + 60 * zoom, h / 2)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.15)'
  ctx.font = '10px monospace'
  ctx.fillText('X', w / 2 + 65 * zoom, h / 2 + 4)
  // Y axis
  ctx.beginPath()
  ctx.moveTo(w / 2, h / 2)
  ctx.lineTo(w / 2, h / 2 - 60 * zoom)
  ctx.stroke()
  ctx.fillText('Y', w / 2 + 4, h / 2 - 65 * zoom)
  // Z axis
  ctx.beginPath()
  ctx.moveTo(w / 2, h / 2)
  ctx.lineTo(w / 2 + 40 * zoom, h / 2 + 30 * zoom)
  ctx.stroke()
  ctx.fillText('Z', w / 2 + 45 * zoom, h / 2 + 35 * zoom)

  // Info
  ctx.fillStyle = 'rgba(255,255,255,0.15)'
  ctx.font = '11px sans-serif'
  ctx.fillText(`${points.length.toLocaleString()} points · ${mode === 'confidence' ? 'Confidence' : 'RGB'} mode`, 16, h - 16)
}

export default function ViewerPage() {
  const router = useRouter()
  const { pointCloud, processingComplete } = useDroneVizStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<'rgb' | 'confidence'>('rgb')
  const [rotX, setRotX] = useState(0.4)
  const [rotY, setRotY] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const lastMouse = useRef({ x: 0, y: 0 })
  const animRef = useRef<number>(0)
  const [autoRotate, setAutoRotate] = useState(true)

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
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.scale(dpr, dpr)
      canvas.style.width = rect.width + 'px'
      canvas.style.height = rect.height + 'px'

      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr

      renderPointCloud(canvas, pointCloud, mode, rotX, ry, zoom)
      animRef.current = requestAnimationFrame(animate)
    }
    animate()
    return () => cancelAnimationFrame(animRef.current)
  }, [pointCloud, mode, rotX, rotY, zoom, autoRotate, isDragging]) // eslint-disable-line

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

  if (pointCloud.length === 0) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center">
        <div className="text-center">
          <div className="text-white/20 text-[15px] mb-4">No 3D data available</div>
          <a href="/droneviz3d/upload" className="text-cyan-400 text-[13px] hover:underline">Upload a video first →</a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Header */}
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 text-[12px] text-white/25 mb-2 font-mono">
              <a href="/droneviz3d" className="hover:text-cyan-400 transition-colors">Home</a>
              <span>/</span>
              <span className="text-white/50">3D Viewer</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Interactive 3D Model
            </h1>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMode(mode === 'rgb' ? 'confidence' : 'rgb')}
              className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[12px] text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-all font-medium"
            >
              {mode === 'rgb' ? '🎨 RGB' : '📊 Confidence'}
            </button>
            <button
              onClick={() => setAutoRotate(!autoRotate)}
              className={`px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-all ${
                autoRotate
                  ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400'
                  : 'bg-white/[0.04] border-white/[0.06] text-white/50 hover:text-white/70'
              }`}
            >
              {autoRotate ? '⟳ Auto' : '⟳ Manual'}
            </button>
            <button
              onClick={() => { setRotX(0.4); setRotY(0); setZoom(1) }}
              className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[12px] text-white/50 hover:text-white/70 transition-all font-medium"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 pb-6">
        <div
          className="relative w-full rounded-2xl border border-white/[0.04] overflow-hidden bg-[#09090b] cursor-grab active:cursor-grabbing"
          style={{ height: 'calc(100vh - 14rem)' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          <canvas ref={canvasRef} className="w-full h-full" />

          {/* Overlay info */}
          <div className="absolute bottom-4 left-4 flex items-center gap-3">
            <div className="px-3 py-1.5 rounded-lg bg-black/50 backdrop-blur-sm text-[11px] text-white/30 font-mono">
              Drag to rotate · Scroll to zoom
            </div>
          </div>

          {mode === 'confidence' && (
            <div className="absolute top-4 right-4 p-3 rounded-lg bg-black/50 backdrop-blur-sm space-y-1">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-2.5 h-2.5 rounded bg-cyan-400" />
                <span className="text-white/40">High confidence (&gt;0.8)</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-2.5 h-2.5 rounded bg-amber-400" />
                <span className="text-white/40">Medium (0.5–0.8)</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-2.5 h-2.5 rounded bg-red-400" />
                <span className="text-white/40">Low confidence (&lt;0.5)</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
