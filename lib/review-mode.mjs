export const REVIEW_MODES = Object.freeze(['strict', 'balanced', 'minimal'])
export const EXECUTION_PROFILES = Object.freeze(['fast', 'standard', 'strict'])

const EXECUTION_PROFILE_TO_REVIEW_MODE = Object.freeze({
  fast: 'minimal',
  standard: 'balanced',
  strict: 'strict',
})

export function normalizeReviewMode(reviewMode) {
  if (reviewMode == null) {
    return 'balanced'
  }
  if (typeof reviewMode !== 'string') {
    throw new Error(`review mode must be a string, got ${typeof reviewMode}`)
  }
  const normalized = reviewMode.trim()
  if (!REVIEW_MODES.includes(normalized)) {
    throw new Error(`Unsupported review mode: ${reviewMode}`)
  }
  return normalized
}

export function normalizeExecutionProfile(executionProfile) {
  if (executionProfile == null) {
    return 'standard'
  }
  if (typeof executionProfile !== 'string') {
    throw new Error(`execution profile must be a string, got ${typeof executionProfile}`)
  }
  const normalized = executionProfile.trim()
  if (!EXECUTION_PROFILES.includes(normalized)) {
    throw new Error(`Unsupported execution profile: ${executionProfile}`)
  }
  return normalized
}

export function reviewModeForExecutionProfile(executionProfile) {
  const normalized = normalizeExecutionProfile(executionProfile)
  return EXECUTION_PROFILE_TO_REVIEW_MODE[normalized]
}

export function executionProfileForReviewMode(reviewMode) {
  const normalized = normalizeReviewMode(reviewMode)
  if (normalized === 'minimal') {
    return 'fast'
  }
  if (normalized === 'strict') {
    return 'strict'
  }
  return 'standard'
}

export function defaultMaxReviewFixAttemptsForMode(reviewMode) {
  const normalized = normalizeReviewMode(reviewMode)
  if (normalized === 'strict') {
    return 6
  }
  if (normalized === 'minimal') {
    return 1
  }
  return 4
}

export function shouldRunReviewPhase({ reviewMode, reviewTarget }) {
  const normalized = normalizeReviewMode(reviewMode)
  if (normalized === 'strict' || normalized === 'balanced') {
    return true
  }

  if (reviewTarget === 'integration' || reviewTarget === 'verification') {
    return true
  }

  return false
}
