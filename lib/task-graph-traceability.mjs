function normalizeString(value) {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collectTaskNarrativeText(taskGraph) {
  const chunks = []
  const tasks = Array.isArray(taskGraph?.tasks) ? taskGraph.tasks : []
  for (const task of tasks) {
    const description = normalizeString(task?.description)
    if (description) {
      chunks.push(description)
    }
    const criteria = Array.isArray(task?.acceptance_criteria) ? task.acceptance_criteria : []
    for (const criterion of criteria) {
      const normalized = normalizeString(criterion)
      if (normalized) {
        chunks.push(normalized)
      }
    }
  }
  return chunks.join('\n')
}

export function findMissingArchitectureDecisionCoverage({ architecture, taskGraph }) {
  const decisions = Array.isArray(architecture?.decisions) ? architecture.decisions : []
  if (decisions.length === 0) {
    return []
  }

  const narrative = collectTaskNarrativeText(taskGraph)
  if (!narrative) {
    return decisions
      .map((decision) => normalizeString(decision?.id))
      .filter((decisionId) => decisionId != null)
  }

  const missing = []
  for (const decision of decisions) {
    const decisionId = normalizeString(decision?.id)
    if (!decisionId) {
      continue
    }
    const pattern = new RegExp(`\\b${escapeRegex(decisionId)}\\b`)
    if (!pattern.test(narrative)) {
      missing.push(decisionId)
    }
  }
  return missing
}
