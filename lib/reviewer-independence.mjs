export const REVIEWER_INDEPENDENCE_MODES = Object.freeze(['linked', 'isolated'])

export function normalizeReviewerIndependenceMode(mode) {
  if (mode == null) {
    return 'linked'
  }
  if (typeof mode !== 'string') {
    throw new Error(`reviewer independence mode must be a string, got ${typeof mode}`)
  }
  const normalized = mode.trim()
  if (!REVIEWER_INDEPENDENCE_MODES.includes(normalized)) {
    throw new Error(`Unsupported reviewer independence mode: ${mode}`)
  }
  return normalized
}

export function previousReviewPromptValue({ previousReview, reviewerIndependence, renderPreviousReview }) {
  if (!previousReview) {
    return 'N/A'
  }
  const mode = normalizeReviewerIndependenceMode(reviewerIndependence)
  if (mode === 'isolated') {
    return 'N/A'
  }
  return renderPreviousReview(previousReview)
}
