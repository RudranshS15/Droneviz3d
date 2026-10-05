/**
 * viewer-labels.ts — how object labels share the screen.
 *
 * Moved here from the canvas renderer when the viewer became three.js: the
 * declutter pass never needed a canvas, only the projected positions, and it is
 * the part of the old renderer most worth keeping under test. A single drone pass
 * commonly grounds dozens of objects in a small part of the frame, so labels have
 * to be rationed by legibility rather than drawn on top of each other.
 *
 * Everything here is pure and measured in screen pixels with y growing downward,
 * matching the DOM overlay that now renders the labels.
 */

/** Font size for object labels, in pixels. */
export const LABEL_FONT_SIZE = 11
/**
 * Cap on labels drawn at once. A single pass commonly grounds 50+ objects and
 * they land in a small part of the frame; without a cap the model disappears
 * under its own annotations.
 */
export const MAX_LABELS = 12
/** Horizontal offset from the marker to the label text. */
export const LABEL_OFFSET_X = 10
/** Vertical nudge so the text sits on the marker line rather than through it. */
export const LABEL_DY = 2
/** Height reserved for one label, in pixels. */
export const LABEL_HEIGHT = LABEL_FONT_SIZE + 3
/**
 * Advance width per character, as a fraction of the font size. The overlay draws
 * through the DOM rather than a canvas with `measureText`, so boxes are estimated
 * from the string length — close enough for a declutter pass, and it keeps the
 * whole thing pure and testable.
 */
const LABEL_CHAR_WIDTH = LABEL_FONT_SIZE * 0.62

/** Estimated width of a label at `LABEL_FONT_SIZE`. */
export function labelWidth(text: string): number {
  return text.length * LABEL_CHAR_WIDTH
}

/** An object label competing for screen space. */
export interface LabelPlacement {
  /** index of the object in the scene, so the caller can map the result back */
  index: number
  x: number
  y: number
  text: string
  /** fused detection score, 0..1 — higher wins when labels collide */
  score: number
  /** the selected object is always labelled, whatever else is dropped */
  selected: boolean
}

/**
 * Screen-space box a label occupies, including its offset from the marker. This
 * is the exact rectangle the label text is drawn into, so decluttering on it
 * matches what the user sees.
 */
export function labelBox(placement: Pick<LabelPlacement, 'x' | 'y' | 'text'>):
  { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: placement.x + LABEL_OFFSET_X,
    maxX: placement.x + LABEL_OFFSET_X + labelWidth(placement.text),
    minY: placement.y + LABEL_DY - LABEL_HEIGHT / 2,
    maxY: placement.y + LABEL_DY + LABEL_HEIGHT / 2,
  }
}

function boxesOverlap(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number }
): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
}

/**
 * Greedy screen-space declutter. The selected object is placed first and is
 * never dropped; the rest are added in descending score order, each only if it
 * does not overlap a label already placed, up to `maxLabels`.
 *
 * Returns the accepted placements in scene order, so the caller can draw
 * labels in a stable order regardless of score.
 */
export function declutterLabels(
  placements: readonly LabelPlacement[],
  maxLabels: number = MAX_LABELS
): LabelPlacement[] {
  const order = [...placements].sort((a, b) => {
    if (a.selected !== b.selected) return a.selected ? -1 : 1
    if (a.score !== b.score) return b.score - a.score
    return a.index - b.index
  })

  const boxes: { minX: number; minY: number; maxX: number; maxY: number }[] = []
  const accepted: LabelPlacement[] = []
  for (const placement of order) {
    if (accepted.length >= maxLabels) break
    const box = labelBox(placement)
    if (boxes.some((other) => boxesOverlap(box, other))) continue
    boxes.push(box)
    accepted.push(placement)
  }

  return accepted.sort((a, b) => a.index - b.index)
}
