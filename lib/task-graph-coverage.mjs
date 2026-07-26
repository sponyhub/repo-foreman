function normalizeFilePath(value) {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const TRAILING_PUNCTUATION = /[.,;:]+$/g
const BACKTICK_PATH_PATTERN = /`([^`]+)`/g

function isPathLikeToken(value) {
  if (typeof value !== 'string') {
    return false
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }
  if (/[\s()`]/.test(trimmed)) {
    return false
  }
  return /[/.]/.test(trimmed)
}

function sanitizePathToken(value) {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const withoutPunctuation = trimmed.replace(TRAILING_PUNCTUATION, '')
  return withoutPunctuation || null
}

function normalizeArchitectureDocPathFromString(value) {
  const normalized = normalizeFilePath(value)
  if (!normalized) {
    return null
  }

  BACKTICK_PATH_PATTERN.lastIndex = 0
  let match = null
  while ((match = BACKTICK_PATH_PATTERN.exec(normalized)) !== null) {
    const candidate = sanitizePathToken(match[1])
    if (candidate && isPathLikeToken(candidate)) {
      return candidate
    }
  }

  const beforeParen = sanitizePathToken(normalized.split('(')[0] ?? '')
  if (beforeParen && isPathLikeToken(beforeParen)) {
    return beforeParen
  }

  const firstToken = sanitizePathToken(normalized.split(/\s+/)[0] ?? '')
  if (firstToken && isPathLikeToken(firstToken)) {
    return firstToken
  }

  const full = sanitizePathToken(normalized)
  if (full && isPathLikeToken(full)) {
    return full
  }

  return null
}

function normalizeArchitectureDocEntry(entry) {
  if (typeof entry === 'string') {
    return normalizeArchitectureDocPathFromString(entry)
  }
  if (entry && typeof entry === 'object') {
    return normalizeArchitectureDocPathFromString(entry.path)
  }
  return null
}

function normalizeArchitectureDocEntryForDebug(entry) {
  if (typeof entry === 'string') {
    return entry.trim()
  }
  if (entry && typeof entry === 'object') {
    try {
      return JSON.stringify(entry)
    } catch {
      return String(entry)
    }
  }
  return String(entry)
}

export function collectArchitectureDocsToUpdate(architecture) {
  const docsToUpdate = Array.isArray(architecture?.docs_to_update) ? architecture.docs_to_update : []
  const docs = []

  for (const entry of docsToUpdate) {
    const normalized = normalizeArchitectureDocEntry(entry)
    if (!normalized) {
      continue
    }
    docs.push(normalized)
  }

  return docs
}

export function findInvalidArchitectureDocsToUpdateEntries(architecture) {
  const docsToUpdate = Array.isArray(architecture?.docs_to_update) ? architecture.docs_to_update : []
  const invalid = []

  for (const entry of docsToUpdate) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim()
      const sanitized = sanitizePathToken(trimmed)
      const strictPathOnly = Boolean(trimmed && sanitized && trimmed === sanitized && isPathLikeToken(trimmed))
      if (strictPathOnly) {
        continue
      }
      invalid.push(normalizeArchitectureDocEntryForDebug(entry))
      continue
    }
    invalid.push(normalizeArchitectureDocEntryForDebug(entry))
  }

  return invalid
}

function collectTaskFileEntries(task = {}) {
  const files = task?.files ?? {}
  const all = []
  for (const key of ['create', 'modify', 'delete']) {
    const entries = Array.isArray(files?.[key]) ? files[key] : []
    for (const entry of entries) {
      const normalized = normalizeFilePath(entry)
      if (!normalized) continue
      all.push(normalized)
    }
  }
  return all
}

export function collectTaskGraphTouchedFiles(taskGraph) {
  const touched = new Set()
  const tasks = Array.isArray(taskGraph?.tasks) ? taskGraph.tasks : []
  for (const task of tasks) {
    for (const entry of collectTaskFileEntries(task)) {
      touched.add(entry)
    }
  }
  return touched
}

export function findMissingArchitectureDocsToUpdate({ architecture, taskGraph }) {
  const docsToUpdate = collectArchitectureDocsToUpdate(architecture)
  const touched = collectTaskGraphTouchedFiles(taskGraph)
  const missing = []

  for (const docPath of docsToUpdate) {
    const normalized = normalizeFilePath(docPath)
    if (!normalized) continue
    if (touched.has(normalized)) continue
    missing.push(normalized)
  }

  return missing
}
