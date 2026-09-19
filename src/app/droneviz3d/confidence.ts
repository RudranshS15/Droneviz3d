/**
 * confidence.ts — the one confidence scale.
 *
 * The viewer colours points by confidence and the results page charts the same
 * points; if the two ever disagreed, the numbers and the picture would tell
 * different stories. Both read the bands from here — thresholds and colours
 * included — so there is exactly one definition to change.
 *
 * The colours are chosen for contrast against the #0c0a09 field and are
 * distinguishable by lightness as well as hue, so the scale survives
 * colour-vision differences and greyscale printing.
 */

export type ConfidenceBandId = 'high' | 'medium' | 'low'

export interface ConfidenceBand {
  id: ConfidenceBandId
  label: string
  /** inclusive lower bound, 0..1 */
  min: number
  /** exclusive upper bound; > 1 means unbounded */
  maxExclusive: number
  /** canvas fill colour, [r, g, b] */
  rgb: readonly [number, number, number]
  /** tailwind background class for bars and swatches */
  barClass: string
  /** tailwind text class that stays readable at the same hues */
  textClass: string
  description: string
}

export const CONFIDENCE_BANDS: readonly ConfidenceBand[] = [
  {
    id: 'high', label: 'High', min: 0.8, maxExclusive: Infinity, rgb: [34, 211, 238],
    barClass: 'bg-cyan-400', textClass: 'text-cyan-300',
    description: 'seen from several keyframes with consistent geometry',
  },
  {
    id: 'medium', label: 'Medium', min: 0.5, maxExclusive: 0.8, rgb: [251, 191, 36],
    barClass: 'bg-amber-400', textClass: 'text-amber-300',
    description: 'single observation or a partially occluded view',
  },
  {
    id: 'low', label: 'Low', min: 0, maxExclusive: 0.5, rgb: [248, 113, 113],
    barClass: 'bg-red-400', textClass: 'text-red-300',
    description: 'weak grounding at this location — treat as indicative only',
  },
]

/** The band a confidence value falls in. Values outside 0..1 are clamped. */
export function bandFor(confidence: number): ConfidenceBand {
  const c = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0
  for (const band of CONFIDENCE_BANDS) {
    if (c >= band.min && c < band.maxExclusive) return band
  }
  return CONFIDENCE_BANDS[CONFIDENCE_BANDS.length - 1]
}

/**
 * Canvas fill colour for a confidence value. Alpha rises with confidence so a
 * dense high-confidence surface reads as solid rather than as a haze.
 */
export function confidenceColor(confidence: number, baseAlpha = 0.55): string {
  const band = bandFor(confidence)
  const c = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0
  const alpha = Math.max(0.15, Math.min(0.95, baseAlpha + c * 0.4))
  return `rgba(${band.rgb[0]}, ${band.rgb[1]}, ${band.rgb[2]}, ${alpha.toFixed(3)})`
}

export interface ConfidenceCount { band: ConfidenceBand; count: number; share: number }

/** Count points per band, in band order, for the results chart. */
export function countByBand(values: readonly number[]): ConfidenceCount[] {
  const counts = CONFIDENCE_BANDS.map((band) => ({ band, count: 0, share: 0 }))
  for (const v of values) {
    const id = bandFor(v).id
    const entry = counts.find((c) => c.band.id === id)
    if (entry) entry.count += 1
  }
  const total = values.length
  for (const entry of counts) entry.share = total > 0 ? entry.count / total : 0
  return counts
}
