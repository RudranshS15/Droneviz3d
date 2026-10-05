/**
 * label-vocabulary.ts — the object classes the grounding step is asked for.
 *
 * The classes used to be three literals buried in the pipeline runner
 * (`['building', 'vehicle', 'tree']`), which made "ground a different kind of
 * object" a code change rather than a form field. This module is the one place
 * that decides what a typed list means, so the upload form, the validator and
 * the pipeline all agree — and so the rules can be tested without a browser.
 *
 * Two honest constraints travel with this:
 *
 * 1. The classes are only ever a *prompt*. In worker mode they are sent to
 *    LocateAnything-3B as the label set; the model then grounds what it finds.
 *    Nothing here guarantees a class will appear in the output.
 * 2. The built-in simulated adapter ignores the list entirely — it generates its
 *    own illustrative scene from the clip's fingerprint and the flight metadata.
 *    The upload form says so where the list is entered, and
 *    `simulatedGroundingBasis` records it with the result.
 */

/** What the grounding step asks for when the operator does not say otherwise. */
export const DEFAULT_LABEL_VOCABULARY = ['building', 'vehicle', 'tree'] as const

/** More classes than this and the prompt gets noisy and the form unwieldy. */
export const MAX_VOCABULARY_LABELS = 8
/** Long enough for "photovoltaic panel"; short enough to stay a label. */
export const MAX_LABEL_LENGTH = 24

export interface ParsedVocabulary {
  ok: boolean
  /** Normalised, de-duplicated classes. Empty when `ok` is false. */
  labels: string[]
  /** Why the input was rejected, ready to show under the field. Null when ok. */
  error: string | null
}

/**
 * Turn what somebody typed into the class list the pipeline will use.
 *
 * Commas separate; whitespace is collapsed; case is folded; duplicates are
 * dropped in place; and anything outside letters, digits, spaces and hyphens is
 * removed — these values are joined with commas and sent as the worker's label
 * set, so a stray control character or a second comma must never reach the wire.
 * Rejecting rather than truncating keeps "you asked for twelve classes, I used
 * eight" from silently meaning something other than what was typed.
 */
export function parseLabelVocabulary(input: string): ParsedVocabulary {
  const labels: string[] = []
  for (const part of String(input).split(',')) {
    const label = part
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (label === '') continue
    if (label.length > MAX_LABEL_LENGTH) {
      return {
        ok: false, labels: [],
        error: `“${label}” is longer than ${MAX_LABEL_LENGTH} characters. Use a shorter class name.`,
      }
    }
    if (!labels.includes(label)) labels.push(label)
  }

  if (labels.length === 0) {
    return {
      ok: false, labels: [],
      error: `Enter at least one object class to look for, e.g. “${DEFAULT_LABEL_VOCABULARY.join(', ')}”.`,
    }
  }
  if (labels.length > MAX_VOCABULARY_LABELS) {
    return {
      ok: false, labels: [],
      error: `List at most ${MAX_VOCABULARY_LABELS} classes; ${labels.length} were given.`,
    }
  }
  return { ok: true, labels, error: null }
}

/** The default list, ready for the text field. */
export function defaultVocabularyInput(): string {
  return DEFAULT_LABEL_VOCABULARY.join(', ')
}
