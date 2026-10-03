/**
 * video-fingerprint.ts — a stable identity for the uploaded clip.
 *
 * Why this exists: the simulated grounding adapter synthesizes an illustrative
 * scene from a seed, and that seed used to be the flight metadata alone. Two
 * different clips with the same GPS / altitude / heading — two takes of one
 * survey, or a re-export of the same flight — therefore produced byte-identical
 * scenes, so the app looked like it had re-used a cached model even when it had
 * genuinely re-run. Seeding from the upload itself is what makes "a different
 * video ⇒ a different scene" true rather than incidental.
 *
 * Why bytes and not decoded frames: decoding keyframes is the more faithful
 * input, but it is slow, canvas-bound, and impossible to exercise in Node — the
 * claim above would then rest on browser-only observation. Reading a few windows
 * of the file's bytes is fast (≤ 512 KB, never the whole clip), works in the
 * browser and in tests, and is enough to separate two clips: compressed video
 * carries per-frame payloads across the whole file, so evenly spread windows
 * differ whenever the content does, including two files of the same length.
 *
 * It is a change detector, not a security primitive: no key, no HMAC, and no
 * claim that two files sharing a fingerprint are the same video. Nothing leaves
 * the device — `Blob.slice().arrayBuffer()` reads local bytes only.
 */

/** Upper bound on how much of the clip is ever read. */
export const FINGERPRINT_SAMPLE_BYTES = 512 * 1024
/** Size of one read window; the number of windows follows from the two bounds. */
export const FINGERPRINT_STRIDE_BYTES = 64 * 1024

export interface VideoFingerprint {
  /** SHA-256 over the sampled windows plus the file length, lowercase hex */
  hex: string
  /** total file length in bytes */
  bytes: number
  /** how much of the file was actually read */
  sampledBytes: number
}

/**
 * Hash a few evenly spread windows of `blob` together with its total length.
 *
 * Windows are spread across the file rather than taken from the start, because
 * two clips that differ only in their middle (a different second half of a
 * flight) share their container header and must still fingerprint differently.
 * The length is part of the hash so a truncated copy of the same footage is not
 * mistaken for the original.
 */
export async function fingerprintVideoFile(blob: Blob): Promise<VideoFingerprint> {
  const size = blob.size
  const windows = Math.max(1, Math.ceil(FINGERPRINT_SAMPLE_BYTES / FINGERPRINT_STRIDE_BYTES))
  // Small clips are read in full (they are below the budget anyway); large ones
  // take one stride-sized window from each evenly spaced position, so the total
  // read stays under FINGERPRINT_SAMPLE_BYTES no matter how big the upload is.
  const even = size > 0 ? Math.max(1, Math.ceil(size / windows)) : 0
  const chunk = Math.min(FINGERPRINT_STRIDE_BYTES, even)

  const parts: Uint8Array[] = []
  if (chunk > 0) {
    for (let i = 0; i < windows; i++) {
      const start = Math.min(size, Math.floor((i * size) / windows))
      const end = Math.min(size, start + chunk)
      if (end <= start) break
      parts.push(new Uint8Array(await blob.slice(start, end).arrayBuffer()))
    }
  }
  const sampledBytes = parts.reduce((sum, p) => sum + p.byteLength, 0)

  // The window layout goes into the hash as text, so the digest depends on how
  // the file was sampled as well as on the bytes that came back.
  const layout = new TextEncoder().encode(`${size}:${windows}:${chunk}|`)
  const payload = new Uint8Array(layout.byteLength + sampledBytes)
  payload.set(layout, 0)
  let offset = layout.byteLength
  for (const part of parts) {
    payload.set(part, offset)
    offset += part.byteLength
  }

  const digest = await globalThis.crypto.subtle.digest('SHA-256', payload)
  return { hex: toHex(digest), bytes: size, sampledBytes }
}

/**
 * The string the simulated adapter hashes to seed its scene: the flight metadata
 * plus, when a video is in hand, the clip's fingerprint.
 *
 * Pure and synchronous on purpose — the seed derivation is the part that has to
 * be testable without decoding a video, and keeping it here means the "two
 * videos, one scene" regression can be asserted on the seed itself as well as
 * end to end. A null fingerprint is the honest fallback (no video to read), and
 * reproduces the metadata-only behaviour exactly.
 */
export function simulatedSeedSource(metadataSeed: string, fingerprint: string | null): string {
  return fingerprint ? `${metadataSeed}|video:${fingerprint}` : metadataSeed
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}