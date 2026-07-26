import { collectKnownFailureIds, summarizeCommandOutput } from './baseline-verification.mjs'
import { resolveMaxSyntheticCycles } from './policy.mjs'

const VALID_SOURCE_PHASES = new Set(['integration_review', 'verification_review'])

function normalizeSourcePhase(sourcePhase) {
  return VALID_SOURCE_PHASES.has(sourcePhase) ? sourcePhase : 'verification_review'
}

function normalizeCycleCount(value) {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.trunc(value))
}

function normalizeFailureId(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeFailureDescription(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function normalizeSyntheticCycleState(state = {}) {
  return {
    synthetic_cycle_count: normalizeCycleCount(state?.synthetic_cycle_count),
    unresolved_post_cycle_failures: Array.isArray(state?.unresolved_post_cycle_failures)
      ? state.unresolved_post_cycle_failures
      : [],
    final_status: typeof state?.final_status === 'string' && state.final_status.trim() ? state.final_status.trim() : null,
  }
}

export function buildUnresolvedPostCycleFailuresFromIssues({
  issues,
  sourcePhase = 'integration_review',
  cycleCountAtCap = 0,
} = {}) {
  const normalizedSourcePhase = normalizeSourcePhase(sourcePhase)
  const normalizedCycleCount = normalizeCycleCount(cycleCountAtCap)

  return (Array.isArray(issues) ? issues : []).map((issue, index) => ({
    failure_id: normalizeFailureId(issue?.id, `${normalizedSourcePhase}-failure-${index + 1}`),
    description: normalizeFailureDescription(issue?.description, `Unresolved ${normalizedSourcePhase} failure ${index + 1}.`),
    source_phase: normalizedSourcePhase,
    cycle_count_at_cap: normalizedCycleCount,
  }))
}

export function buildUnresolvedPostCycleFailuresFromVerification({
  command = 'verification',
  output = '',
  sourcePhase = 'verification_review',
  cycleCountAtCap = 0,
} = {}) {
  const normalizedSourcePhase = normalizeSourcePhase(sourcePhase)
  const normalizedCycleCount = normalizeCycleCount(cycleCountAtCap)
  const failureIds = collectKnownFailureIds([
    {
      command,
      exitCode: 1,
      output,
    },
  ])

  return failureIds.map((failureId) => ({
    failure_id: failureId,
    description:
      failureId.endsWith(':unparseable')
        ? `Unresolved verification failure from ${summarizeCommandOutput(command, { maxLength: 80 })}.`
        : failureId,
    source_phase: normalizedSourcePhase,
    cycle_count_at_cap: normalizedCycleCount,
  }))
}

function normalizeUnresolvedFailures(unresolvedFailures, { cycleCountAtCap } = {}) {
  const normalizedCycleCount = normalizeCycleCount(cycleCountAtCap)

  return (Array.isArray(unresolvedFailures) ? unresolvedFailures : []).map((failure, index) => ({
    failure_id: normalizeFailureId(failure?.failure_id, `unresolved-failure-${index + 1}`),
    description: normalizeFailureDescription(failure?.description, `Unresolved failure ${index + 1}.`),
    source_phase: normalizeSourcePhase(failure?.source_phase),
    cycle_count_at_cap: normalizeCycleCount(failure?.cycle_count_at_cap ?? normalizedCycleCount),
  }))
}

export function planSyntheticCycleEnqueue({ state, policy, unresolvedFailures = [], onWarning } = {}) {
  const normalizedState = normalizeSyntheticCycleState(state)
  const maxSyntheticCycles = resolveMaxSyntheticCycles(policy, { onWarning })

  if (normalizedState.synthetic_cycle_count >= maxSyntheticCycles) {
    const normalizedFailures = normalizeUnresolvedFailures(unresolvedFailures, {
      cycleCountAtCap: normalizedState.synthetic_cycle_count,
    })

    return {
      allowed: false,
      maxSyntheticCycles,
      statePatch: {
        synthetic_cycle_count: normalizedState.synthetic_cycle_count,
        unresolved_post_cycle_failures: normalizedFailures,
        final_status: 'partial',
      },
      warningMessage: `Synthetic fix cycle cap reached (${maxSyntheticCycles}). ${normalizedFailures.length} failures remain unresolved. Final status: partial.`,
    }
  }

  return {
    allowed: true,
    maxSyntheticCycles,
    statePatch: {
      synthetic_cycle_count: normalizedState.synthetic_cycle_count + 1,
      unresolved_post_cycle_failures: normalizedState.unresolved_post_cycle_failures,
    },
  }
}
