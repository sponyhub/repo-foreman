import { collectArchitectureDocsToUpdate, findInvalidArchitectureDocsToUpdateEntries } from './task-graph-coverage.mjs'

const TASK_TYPES = new Set(['code', 'tests', 'docs', 'refactor', 'infra'])
const RISK_LEVELS = new Set(['low', 'medium', 'high'])

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function resolveTaskId(task) {
  if (nonEmptyString(task?.id)) {
    return task.id.trim()
  }
  return 'unknown-synthetic-task'
}

function validateSyntheticTaskSchema(task) {
  if (!task || typeof task !== 'object') {
    return false
  }

  if (!nonEmptyString(task.id) || !nonEmptyString(task.title) || !nonEmptyString(task.description)) {
    return false
  }
  if (!TASK_TYPES.has(task.type)) {
    return false
  }
  if (!RISK_LEVELS.has(task.risk_level)) {
    return false
  }
  if (!Array.isArray(task.acceptance_criteria) || !Array.isArray(task.dependencies)) {
    return false
  }
  if (!isStringArray(task.acceptance_criteria) || !isStringArray(task.dependencies)) {
    return false
  }
  if (!Array.isArray(task.verification_commands) || !isStringArray(task.verification_commands)) {
    return false
  }

  const files = task.files
  if (!files || typeof files !== 'object') {
    return false
  }
  if (!Array.isArray(files.create) || !Array.isArray(files.modify) || !Array.isArray(files.delete)) {
    return false
  }
  if (!isStringArray(files.create) || !isStringArray(files.modify) || !isStringArray(files.delete)) {
    return false
  }

  return true
}

function getDeleteLimit(policy) {
  const value = policy?.max_deleted_files
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function getArchitectureDrift(task, architecture) {
  const allowedDocs = new Set(collectArchitectureDocsToUpdate(architecture))
  const taskDocs = collectArchitectureDocsToUpdate({ docs_to_update: task?.docs_to_update })
  const invalidTaskDocs = findInvalidArchitectureDocsToUpdateEntries({ docs_to_update: task?.docs_to_update })
  const conflictingDocs = [
    ...invalidTaskDocs,
    ...taskDocs.filter((entry) => !allowedDocs.has(entry)),
  ]

  return conflictingDocs.length > 0 ? Array.from(new Set(conflictingDocs)) : []
}

export function validateSyntheticTask(task, { policy, architecture } = {}) {
  if (!validateSyntheticTaskSchema(task)) {
    return { ok: false, reason: 'schema_invalid' }
  }

  const deleteCount = Array.isArray(task?.files?.delete) ? task.files.delete.length : 0
  if (deleteCount > getDeleteLimit(policy)) {
    return { ok: false, reason: 'delete_limit_exceeded' }
  }

  const conflictingDocs = getArchitectureDrift(task, architecture)
  if (conflictingDocs.length > 0) {
    return {
      ok: false,
      reason: 'architecture_drift',
      conflicting_docs: conflictingDocs,
    }
  }

  return { ok: true }
}

export function buildSyntheticTaskGateQuestion({ task, sourcePhase, conflictingDocs }) {
  if (!Array.isArray(conflictingDocs) || conflictingDocs.length === 0) {
    return null
  }

  return [
    `Synthetic task ${resolveTaskId(task)} from ${sourcePhase} introduces docs_to_update entries outside the approved architecture scope.`,
    `Blocked entries: ${conflictingDocs.join(', ')}.`,
    'Please confirm whether the architecture/docs scope should be expanded in a follow-up task.',
  ].join(' ')
}

export async function gateSyntheticTaskForEnqueue({
  task,
  sourcePhase,
  policy,
  architecture,
  mode = 'autonomous',
} = {}) {
  const validation = validateSyntheticTask(task, { policy, architecture })
  if (validation.ok) {
    return { ok: true, task }
  }

  const blocked = {
    id: resolveTaskId(task),
    reason: validation.reason,
    source_phase: sourcePhase,
  }

  const result = { ok: false, blocked }
  if (mode === 'interactive' && validation.reason === 'architecture_drift') {
    result.escalationQuestion = buildSyntheticTaskGateQuestion({
      task,
      sourcePhase,
      conflictingDocs: validation.conflicting_docs,
    })
  }

  return result
}
