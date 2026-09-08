/**
 * exporter.ts — client-side export of the reconstruction result.
 *
 * Only formats that can be produced faithfully from the generated point cloud are
 * offered: PLY (point cloud), OBJ (vertices), and CSV (georeferenced table).
 * Survey-grade formats that require a real photogrammetry backend (GeoTIFF
 * orthophoto, DEM, LAS) are intentionally NOT offered, so every download is honest.
 */

import { Point3D, ReconstructionPose, ReconstructionMetrics } from './reconstruct'

export interface ExportPayload {
  points: Point3D[]
  trajectory: ReconstructionPose[]
  metrics: ReconstructionMetrics | null
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number } | null
  /** WGS84 origin used for the local ENU frame */
  origin: { lat: number; lng: number } | null
}

function toBlob(text: string, type: string): Blob {
  return new Blob([text], { type })
}

/** Binary-style ASCII PLY with per-point color + confidence (as scalar quality). */
export function toPly(payload: ExportPayload): Blob {
  const { points } = payload
  const lines: string[] = [
    'ply',
    'format ascii 1.0',
    'comment DroneViz3D reconstruction (LocateAnything-3B grounded demo)',
    `element vertex ${points.length}`,
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'property float confidence',
    'end_header',
  ]
  for (const p of points) {
    lines.push(
      `${p.x.toFixed(3)} ${p.y.toFixed(3)} ${p.z.toFixed(3)} ${p.r} ${p.g} ${p.b} ${p.confidence.toFixed(3)}`
    )
  }
  return toBlob(lines.join('\n'), 'application/octet-stream')
}

/** OBJ with vertices + per-vertex colors as extension (x y z r g b). */
export function toObj(payload: ExportPayload): Blob {
  const lines: string[] = [
    '# DroneViz3D reconstruction (LocateAnything-3B grounded demo)',
    '# Local ENU frame: x=East, y=North, z=Up, meters',
  ]
  for (const p of payload.points) {
    lines.push(`v ${p.x.toFixed(3)} ${p.z.toFixed(3)} ${(-p.y).toFixed(3)} ${p.r} ${p.g} ${p.b}`)
  }
  return toBlob(lines.join('\n'), 'application/octet-stream')
}

/** Georeferenced CSV: every point with WGS84 coordinates and confidence. */
export function toGeoCsv(payload: ExportPayload): Blob {
  const { points, origin } = payload
  if (!origin) return toBlob('error,no origin\n', 'text/csv')
  const lines: string[] = ['lat,lng,altitude_m,east_m,north_m,label_confidence,r,g,b']
  const M_PER_DEG_LAT = 111320
  const mPerDegLng = M_PER_DEG_LAT * Math.max(0.01, Math.cos((origin.lat * Math.PI) / 180))
  for (const p of points) {
    const lat = origin.lat + p.y / M_PER_DEG_LAT
    const lng = origin.lng + p.x / mPerDegLng
    lines.push(
      `${lat.toFixed(8)},${lng.toFixed(8)},${p.z.toFixed(2)},${p.x.toFixed(2)},${p.y.toFixed(2)},${p.confidence.toFixed(3)},${p.r},${p.g},${p.b}`
    )
  }
  return toBlob(lines.join('\n'), 'text/csv')
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const EXPORT_FORMATS = [
  { id: 'ply', name: 'PLY point cloud', ext: 'ply', description: 'Points with RGB + confidence' },
  { id: 'obj', name: 'OBJ vertices', ext: 'obj', description: 'Vertices with per-vertex color' },
  { id: 'csv', name: 'Geo-referenced CSV', ext: 'csv', description: 'WGS84 lat/lng per point' },
] as const

export type ExportFormatId = (typeof EXPORT_FORMATS)[number]['id']

export function exportAs(format: ExportFormatId, payload: ExportPayload): void {
  const stamp = new Date().toISOString().slice(0, 10)
  if (format === 'ply') triggerDownload(toPly(payload), `droneviz3d-${stamp}.ply`)
  else if (format === 'obj') triggerDownload(toObj(payload), `droneviz3d-${stamp}.obj`)
  else triggerDownload(toGeoCsv(payload), `droneviz3d-${stamp}.csv`)
}
