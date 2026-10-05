'use client'

/**
 * viewer-scene.tsx — the three.js scene, as React components.
 *
 * This replaces the hand-written canvas renderer. The viewer keeps its own
 * orbit camera (viewer-camera.ts) and its own pointer/keyboard handling; three
 * only draws. `CameraRig` mirrors the orbit camera onto the three.js camera every
 * time it changes, so the two can never drift apart, and every geometry buffer
 * comes from the pure builders in viewer-frame.ts.
 *
 * What stayed out of here on purpose: object labels, marker rings, the
 * orientation gizmo and the HUD. Those are screen-space annotations, and as DOM
 * elements they keep their exact pixel sizes, stay crisp at any zoom, and remain
 * verifiable without a GPU — the same split the old renderer used for the HUD it
 * already drew in the DOM.
 *
 * The point cloud is drawn by a tiny shader rather than THREE.PointsMaterial for
 * one reason: the point-size control is defined in pixels at the camera's
 * reference depth, with the same gentle depth attenuation as before
 * (`attenuatedSize`). A uniform-driven `gl_PointSize` reproduces that exactly,
 * whereas a world-space material size would change meaning with distance.
 */

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'

import { TrackedObject } from './grounding'
import { Point3D } from './reconstruct'
import { Bounds3, NEAR_PLANE, OrbitCamera, Vec3, viewBasis } from './viewer-camera'
import {
  ColorMode, VIEWER_PALETTE, buildCloudGeometry, detectionFootprintSegments,
  groundGridSegments, trajectoryDots, trajectorySegments,
} from './viewer-frame'

/** Far plane: model scales reach kilometres when the flight track is included. */
const FAR_PLANE = 100_000

/**
 * Mirrors the viewer's orbit camera onto three's. z-up, same eye and target,
 * same near plane — so a point culled by the projector is culled here too.
 */
export function CameraRig({ camera }: { camera: OrbitCamera }) {
  const three = useThree((state) => state.camera) as THREE.PerspectiveCamera
  const invalidate = useThree((state) => state.invalidate)
  const eye = viewBasis(camera).eye
  const { target, fovY } = camera

  useEffect(() => {
    three.up.set(0, 0, 1)
    three.position.set(eye.x, eye.y, eye.z)
    three.fov = (fovY * 180) / Math.PI
    three.near = NEAR_PLANE
    three.far = FAR_PLANE
    three.lookAt(target.x, target.y, target.z)
    three.updateProjectionMatrix()
    invalidate()
  }, [three, invalidate, eye.x, eye.y, eye.z, target.x, target.y, target.z, fovY])

  return null
}

const POINT_VERTEX_SHADER = `
  uniform float uSize;
  uniform float uRefDepth;
  uniform float uPixelRatio;
  attribute vec4 aColor;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    float depth = max(-viewPosition.z, 1.0);
    // The same attenuation law the 2D renderer used: gentle, clamped 0.5x–2.5x,
    // so nearer points read as nearer without a 1/depth swing.
    float scale = clamp(uRefDepth / depth, 0.5, 2.5);
    gl_PointSize = max(0.6, uSize * scale) * uPixelRatio;
    gl_Position = projectionMatrix * viewPosition;
  }
`

const POINT_FRAGMENT_SHADER = `
  varying vec4 vColor;
  void main() { gl_FragColor = vColor; }
`

/** The reconstructed point cloud. */
export function PointCloud({
  points, colorMode, pointSize, referenceDepth,
}: {
  points: readonly Point3D[]
  colorMode: ColorMode
  pointSize: number
  referenceDepth: number
}) {
  const dpr = useThree((state) => state.viewport.dpr)
  const invalidate = useThree((state) => state.invalidate)

  const geometry = useMemo(() => {
    const { positions, colors } = buildCloudGeometry(points, colorMode)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('aColor', new THREE.BufferAttribute(colors, 4))
    g.computeBoundingSphere()
    return g
  }, [points, colorMode])

  useEffect(() => () => geometry.dispose(), [geometry])

  const uniforms = useMemo(() => ({
    uSize: { value: pointSize },
    uRefDepth: { value: referenceDepth },
    uPixelRatio: { value: dpr },
  // The uniform objects are created once and mutated below; recreating them would
  // churn the material every frame of a drag.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])
  uniforms.uSize.value = pointSize
  uniforms.uRefDepth.value = referenceDepth
  uniforms.uPixelRatio.value = dpr

  // Demand rendering: a uniform or prop change is not a scene-graph change, so
  // ask for the frame explicitly.
  useEffect(() => { invalidate() }, [invalidate, pointSize, referenceDepth, dpr, colorMode])

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={2}>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={POINT_VERTEX_SHADER}
        fragmentShader={POINT_FRAGMENT_SHADER}
        transparent
        depthWrite={false}
      />
    </points>
  )
}

/** The ground plan grid at z = 0, drawn from the model's bounds. */
export function GroundGrid({ bounds, opacity = 0.18 }: { bounds: Bounds3; opacity?: number }) {
  const geometry = useMemo(() => {
    const positions = groundGridSegments(bounds)
    if (positions.length === 0) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return g
  }, [bounds])

  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null

  return (
    <lineSegments geometry={geometry} renderOrder={0}>
      <lineBasicMaterial color="#a8a29e" transparent opacity={opacity} />
    </lineSegments>
  )
}

/** The assumed flight path: a line through the poses, with a dot on each. */
export function Trajectory({ path, color = VIEWER_PALETTE.accent }: { path: readonly Vec3[]; color?: string }) {
  const dpr = useThree((state) => state.viewport.dpr)

  const segments = useMemo(() => {
    const positions = trajectorySegments(path)
    if (positions.length === 0) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return g
  }, [path])

  const dots = useMemo(() => {
    const positions = trajectoryDots(path)
    if (positions.length === 0) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return g
  }, [path])

  useEffect(() => () => { segments?.dispose(); dots?.dispose() }, [segments, dots])

  return (
    <>
      {segments && (
        <lineSegments geometry={segments} renderOrder={1} frustumCulled={false}>
          <lineBasicMaterial color={color} />
        </lineSegments>
      )}
      {dots && (
        <points geometry={dots} renderOrder={1} frustumCulled={false}>
          {/* sizeAttenuation off: the 2D renderer drew a fixed 2 px radius dot. */}
          <pointsMaterial color={color} size={4 * dpr} sizeAttenuation={false} />
        </points>
      )}
    </>
  )
}

/** Footprint outlines for every grounded object, coloured by selection. */
export function DetectionFootprints({
  objects, selectedIndex,
}: {
  objects: readonly TrackedObject[]
  selectedIndex: number | null
}) {
  const geometry = useMemo(() => {
    const { positions, colors } = detectionFootprintSegments(objects, selectedIndex)
    if (positions.length === 0) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return g
  }, [objects, selectedIndex])

  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null

  return (
    <lineSegments geometry={geometry} renderOrder={3}>
      {/* Transparent so the layer stays in the same paint order as before:
          the cloud is drawn, then the annotations on top of it. */}
      <lineBasicMaterial vertexColors transparent />
    </lineSegments>
  )
}

export interface ViewerSceneProps {
  camera: OrbitCamera
  bounds: Bounds3
  points: readonly Point3D[]
  trajectoryPath: readonly Vec3[]
  objects: readonly TrackedObject[]
  colorMode: ColorMode
  pointSize: number
  showDetections: boolean
  showTrajectory: boolean
  selectedIndex: number | null
  background?: string
}

/** Everything inside the canvas, in the old renderer's paint order. */
export function ViewerScene({
  camera, bounds, points, trajectoryPath, objects,
  colorMode, pointSize, showDetections, showTrajectory, selectedIndex, background,
}: ViewerSceneProps) {
  return (
    <>
      <color attach="background" args={[background ?? VIEWER_PALETTE.background]} />
      <CameraRig camera={camera} />
      <GroundGrid bounds={bounds} />
      {showTrajectory && trajectoryPath.length > 0 && <Trajectory path={trajectoryPath} />}
      <PointCloud
        points={points}
        colorMode={colorMode}
        pointSize={pointSize}
        referenceDepth={camera.distance}
      />
      {showDetections && objects.length > 0 && (
        <DetectionFootprints objects={objects} selectedIndex={selectedIndex} />
      )}
    </>
  )
}
