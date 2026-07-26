function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)))
}

function parseTypeScriptFailureIds(output) {
  return Array.from(String(output ?? '').matchAll(/\bTS\d{3,5}\b/g)).map((match) => match[0])
}

function parseJestFailureIds(output) {
  const lines = String(output ?? '').split(/\r?\n/)
  const ids = []

  for (const line of lines) {
    const match = line.match(/^\s*[●✕]\s+(.+?)\s*$/)
    if (match) {
      ids.push(match[1].trim())
    }
  }

  return ids
}

function parseEslintRuleIds(output) {
  const ids = []
  const lines = String(output ?? '').split(/\r?\n/)

  for (const line of lines) {
    const match = line.match(/\b(?:error|warning)\b.*?\b([@a-z0-9-]+(?:\/[@a-z0-9-]+)?(?:-[a-z0-9-]+)*)\s*$/i)
    if (match) {
      ids.push(match[1].trim())
    }
  }

  return ids
}

function parseFailureIds(output) {
  return unique([
    ...parseTypeScriptFailureIds(output),
    ...parseJestFailureIds(output),
    ...parseEslintRuleIds(output),
  ])
}

export function summarizeCommandOutput(output, { maxLength = 240 } = {}) {
  const normalized = normalizeWhitespace(output)
  if (!normalized) {
    return '(no output captured)'
  }
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength - 3)}...`
}

export function collectKnownFailureIds(results) {
  const knownFailures = []

  for (const result of Array.isArray(results) ? results : []) {
    if ((result?.exitCode ?? result?.exit_code ?? 0) === 0) {
      continue
    }

    const command = typeof result?.command === 'string' ? result.command : 'unknown-command'
    const output = typeof result?.output === 'string' ? result.output : ''
    const parsed = parseFailureIds(output)

    if (parsed.length > 0) {
      knownFailures.push(...parsed)
      continue
    }

    knownFailures.push(`${command}:unparseable`)
  }

  return unique(knownFailures)
}

export function classifyVerificationFailures({ baselineKnownFailures, currentFailures } = {}) {
  const baseline = new Set(Array.isArray(baselineKnownFailures) ? baselineKnownFailures : [])
  return unique(Array.isArray(currentFailures) ? currentFailures : []).map((failure) => ({
    failure,
    status: baseline.has(failure) ? 'pre_existing' : 'introduced_by_task',
  }))
}

export function buildVerificationCommandPlan({
  finalTestsCommand,
  coverageEnabled = false,
  coverageCommand = null,
  auditEnabled = false,
} = {}) {
  const plan = [
    {
      key: 'tests',
      state: 'TESTS_PASSED',
      label: 'tests',
      command: finalTestsCommand,
      logFile: 'npm-test.log',
    },
  ]

  if (coverageEnabled && coverageCommand) {
    plan.push({
      key: 'coverage',
      state: 'COVERAGE_PASSED',
      label: 'coverage',
      command: coverageCommand,
      logFile: 'coverage.log',
    })
  }

  if (auditEnabled) {
    plan.push({
      key: 'audit',
      state: 'AUDIT_PASSED',
      label: 'audit',
      command: 'npm audit --omit=dev',
      logFile: 'audit.log',
    })
  }

  return plan
}
