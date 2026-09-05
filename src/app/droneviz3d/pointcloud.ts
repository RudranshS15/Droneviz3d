/**
 * PointCloudFactory — adapter converting processing output into a PointCloud.
 * Two adapters (mock and future-real) make the 3D data source replaceable.
 */

export interface Point3D {
  x: number; y: number; z: number; r: number; g: number; b: number; confidence: number
}

export interface CameraPose {
  lat: number; lng: number; altitude: number; pitch: number; yaw: number
  timeOffset: number; frameIndex: number
}

export interface ConfidenceAnnotation {
  x: number; y: number; z: number; score: number
  cause: 'occlusion' | 'motion_blur' | 'low_parallax' | 'dynamic_object' | 'lighting' | 'gps_noise'
  explanation: string; affectedFrames: [number, number]
}

export interface PointCloudMetrics {
  totalPoints: string; accuracy: string; processingTime: string; coverage: string; confidenceScore: string
}

export interface PointCloudResult {
  points: Point3D[]; trajectory: CameraPose[]; annotations: ConfidenceAnnotation[]; metrics: PointCloudMetrics
}

export type PointCloudAdapter<TInput = void> = (input: TInput) => PointCloudResult

export function createMockAdapter(): PointCloudAdapter<void> {
  return (): PointCloudResult => {
    const points: Point3D[] = []
    for (let i = 0; i < 50_000; i++) {
      const theta = Math.random() * Math.PI * 2
      const r = 2 + Math.random() * 8
      const heightVar = (Math.random() - 0.5) * 3
      points.push({
        x: Math.cos(theta) * r + (Math.random() - 0.5) * 0.5,
        y: heightVar + Math.sin(theta * 3) * 0.5,
        z: Math.sin(theta) * r + (Math.random() - 0.5) * 0.5,
        r: Math.floor(80 + Math.random() * 60),
        g: Math.floor(140 + Math.random() * 80),
        b: Math.floor(60 + Math.random() * 40),
        confidence: 0.5 + Math.random() * 0.5,
      })
    }
    for (let bx = -3; bx <= 3; bx += 3) {
      for (let bz = -3; bz <= 3; bz += 3) {
        const bHeight = 1 + Math.random() * 2.5
        for (let j = 0; j < 800; j++) {
          const px = bx + (Math.random() - 0.5) * 1.5
          const py = Math.random() * bHeight
          const pz = bz + (Math.random() - 0.5) * 1.5
          points.push({
            x: px, y: py, z: pz,
            r: Math.floor(120 + Math.random() * 60),
            g: Math.floor(110 + Math.random() * 50),
            b: Math.floor(100 + Math.random() * 50),
            confidence: py < bHeight * 0.8 ? 0.9 : 0.6,
          })
        }
      }
    }
    const trajectory: CameraPose[] = []
    for (let i = 0; i < 40; i++) {
      const t = i / 39
      trajectory.push({
        lat: 28.6139 + (t - 0.5) * 0.002, lng: 77.2090 + Math.sin(t * Math.PI * 2) * 0.001,
        altitude: 120 + Math.sin(t * Math.PI) * 15, pitch: -75 - Math.sin(t * Math.PI * 3) * 15,
        yaw: t * 360, timeOffset: t * 180, frameIndex: Math.floor(t * 3600),
      })
    }
    const annotations: ConfidenceAnnotation[] = [
      { x: 3, y: 2.5, z: -3, score: 0.35, cause: 'occlusion', explanation: 'Building at (3, -3) occluded rear facade — only 2 viewing angles from single flight path', affectedFrames: [450, 620] },
      { x: -2, y: 0.5, z: 2, score: 0.42, cause: 'motion_blur', explanation: 'Motion blur detected at frames 112–120 during fast forward pass at 12 m/s', affectedFrames: [112, 120] },
      { x: 0, y: 1.2, z: -1, score: 0.55, cause: 'low_parallax', explanation: 'Insufficient parallax angle — drone trajectory too linear (< 5° angular difference)', affectedFrames: [800, 950] },
      { x: -3, y: 0.3, z: 0, score: 0.48, cause: 'dynamic_object', explanation: 'Moving vehicle detected in frames 234–245 — excluded from static reconstruction', affectedFrames: [234, 245] },
      { x: 2, y: 0.8, z: 3, score: 0.38, cause: 'lighting', explanation: 'Strong shadow cast across ground — variable illumination reduced feature matching', affectedFrames: [1200, 1350] },
      { x: -1, y: 0.1, z: -2, score: 0.60, cause: 'gps_noise', explanation: 'GPS drift of ±2.3m detected — RTK corrections not available for this segment', affectedFrames: [2000, 2200] },
    ]
    return {
      points, trajectory, annotations,
      metrics: { totalPoints: points.length.toLocaleString(), accuracy: '0.8 cm RMSE', processingTime: '47 min 23 sec', coverage: '94.2%', confidenceScore: '0.87' },
    }
  }
}
