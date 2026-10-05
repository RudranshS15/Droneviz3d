/**
 * footage-advisory.ts — is this clip plausible drone survey footage?
 *
 * The pipeline assumes a single downward-looking flight pass with known camera
 * geometry and enough movement to place objects. A phone clip — portrait, a few
 * seconds long — breaks every one of those assumptions, but nothing on the page
 * said so: the run completes and produces an illustrative scene that looks like
 * a result. These checks are the cheap, honest part of that gap: they fire from
 * facts the browser already knows after loading the video's metadata (duration,
 * frame size), name what is unusual about the clip, and leave the decision to
 * run it to the person holding the phone.
 *
 * They are advisories, never gates: nothing here blocks a run, and a clip that
 * fails every check can still be processed — the result will simply carry the
 * usual "illustrative" labelling. Unknown facts produce no advisory, so a video
 * whose metadata has not loaded yet is never described as broken.
 */

export interface FootageFacts {
  /** Clip length in seconds, or null when not known yet. */
  durationSec: number | null
  /** Frame width in pixels, or null when not known yet. */
  width: number | null
  /** Frame height in pixels, or null when not known yet. */
  height: number | null
}

export interface FootageAdvisory {
  id: 'portrait' | 'short'
  message: string
}

/** Short enough that a single pass has almost no baseline between keyframes. */
const SHORT_CLIP_SECONDS = 3

export function footageAdvisories(facts: FootageFacts): FootageAdvisory[] {
  const advisories: FootageAdvisory[] = []

  const { width, height } = facts
  if (width !== null && height !== null && height > width) {
    advisories.push({
      id: 'portrait',
      message:
        `This clip is portrait (${width}×${height}). Drone survey footage is normally landscape and looking ` +
        'downward; a reconstruction from this footage should be read as illustrative.',
    })
  }

  if (facts.durationSec !== null && facts.durationSec > 0 && facts.durationSec < SHORT_CLIP_SECONDS) {
    advisories.push({
      id: 'short',
      message:
        `This clip is ${facts.durationSec.toFixed(1)} s long. The pipeline plans keyframes across a flight ` +
        'pass, so a clip this short gives it almost no baseline — expect a mostly synthesized scene.',
    })
  }

  return advisories
}
