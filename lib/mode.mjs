import { hasCriticalQuestions } from './questions.mjs'

export const MODES = Object.freeze(['autonomous', 'interactive'])

export function normalizeMode(mode) {
  if (mode == null) {
    return 'interactive'
  }
  if (typeof mode !== 'string') {
    throw new Error(`mode must be a string, got ${typeof mode}`)
  }
  const normalized = mode.trim()
  if (!MODES.includes(normalized)) {
    throw new Error(`Unsupported mode: ${mode}`)
  }
  return normalized
}

export function decideGateAction({ mode, gateStatus, gateQuestions } = {}) {
  const normalizedMode = normalizeMode(mode)
  if (gateStatus === 'blocked') {
    return { stop: true, effectiveStatus: 'blocked' }
  }
  if (gateStatus === 'needs_user_input') {
    if (hasCriticalQuestions(gateQuestions)) {
      return { stop: true, effectiveStatus: 'needs_user_input' }
    }
    if (normalizedMode === 'interactive') {
      return { stop: true, effectiveStatus: 'needs_user_input' }
    }
    return { stop: false, effectiveStatus: 'pass-with-warnings' }
  }
  return { stop: false, effectiveStatus: 'pass' }
}

export function decideWorkerBlockedAction({ mode, questions } = {}) {
  const normalizedMode = normalizeMode(mode)
  if (hasCriticalQuestions(questions)) {
    return 'wait'
  }
  return normalizedMode === 'autonomous' ? 'auto-resolve' : 'wait'
}
