const POLICY_VIOLATION_PREFIX = 'Policy violation detected in Codex event stream:'

export function extractPolicyViolationEntries(error) {
  const message = String(error?.message ?? error ?? '')
  if (!message.startsWith(POLICY_VIOLATION_PREFIX)) {
    return []
  }

  const payload = message.slice(POLICY_VIOLATION_PREFIX.length).trim()
  if (!payload) {
    return []
  }

  return payload
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':')
      if (separator === -1) {
        return { kind: 'unknown', pattern: entry.trim() }
      }
      return {
        kind: entry.slice(0, separator).trim() || 'unknown',
        pattern: entry.slice(separator + 1).trim(),
      }
    })
}

export function formatPolicyViolationGuidanceBlock(error) {
  const violations = extractPolicyViolationEntries(error)
  if (violations.length === 0) {
    return ''
  }

  const summary = violations.map((violation) => `${violation.kind}:${violation.pattern}`).join(', ')
  return [
    'Policy guidance (highest priority):',
    `- Forbidden patterns from previous attempt: ${summary}`,
    '- Do NOT run commands matching those patterns.',
    '- Choose policy-safe alternatives and continue from current repo state.',
    '',
  ].join('\n')
}

export function resolvePolicyGuidanceRetryLimit(reviewRetryBudget) {
  const parsed =
    typeof reviewRetryBudget === 'string'
      ? Number.parseInt(reviewRetryBudget, 10)
      : Number.isFinite(reviewRetryBudget)
        ? Math.trunc(reviewRetryBudget)
        : NaN

  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1
  }
  return parsed
}

export function isRetryableCodexPhaseError(error) {
  const message = String(error?.message ?? error ?? '')
  if (message.startsWith('Codex output parse failed')) {
    return false
  }
  return true
}

export function formatWorkerContinuationBlock({ attemptNumber, maxAttempts, previousAttemptDir, error }) {
  if (!attemptNumber || attemptNumber <= 1) {
    return ''
  }

  const message = String(error?.message ?? error ?? '')
  const policyGuidance = formatPolicyViolationGuidanceBlock(error)
  return [
    'CONTINUATION (read carefully):',
    `- This is attempt ${attemptNumber}/${maxAttempts} for the SAME task.`,
    `- Previous attempt dir (logs + prompt): ${previousAttemptDir}`,
    `- Previous failure summary: ${message}`,
    '',
    'Instructions:',
    '- Do NOT restart the task from scratch.',
    '- First, inspect the current repo working tree (git diff) and only do the remaining work.',
    '- If previous changes are wrong/incomplete, fix them in-place (minimal diff).',
    '- Re-run the task verification commands and make them pass.',
    '',
    policyGuidance,
  ].join('\n')
}
