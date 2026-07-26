function normalizeString(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function mergeUniqueStrings(existing, additions) {
  const merged = Array.isArray(existing) ? [...existing] : []
  const seen = new Set(merged)
  if (!Array.isArray(additions)) {
    return merged
  }
  for (const item of additions) {
    const normalized = normalizeString(item)
    if (!normalized) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    merged.push(normalized)
  }
  return merged
}

export function createPlanningContext() {
  return {
    assumptions: [],
    mitigations: [],
    task_hints: [],
    notes: [],
  }
}

export function mergePlanningContext(target, update) {
  if (!target || typeof target !== 'object' || !update || typeof update !== 'object') {
    return target
  }

  target.assumptions = mergeUniqueStrings(target.assumptions, update.assumptions)
  target.mitigations = mergeUniqueStrings(target.mitigations, update.mitigations)
  target.task_hints = mergeUniqueStrings(target.task_hints, update.task_hints)
  target.notes = mergeUniqueStrings(target.notes, update.notes)

  return target
}
