function createEmptyConflictMap() {
  return {
    safe: [],
    review_required: [],
    blocked: [],
  }
}

function collectTaskWriteFiles(task) {
  const files = task?.files
  if (!files || typeof files !== 'object') {
    return []
  }

  const collected = []
  for (const operation of ['create', 'modify', 'delete']) {
    const paths = Array.isArray(files[operation]) ? files[operation] : []
    for (const filePath of paths) {
      if (typeof filePath === 'string' && filePath.trim()) {
        collected.push(filePath.trim())
      }
    }
  }

  return Array.from(new Set(collected))
}

function referencesTaskId(task, targetTaskId) {
  const dependencies = Array.isArray(task?.dependencies) ? task.dependencies : []
  if (dependencies.includes(targetTaskId)) {
    return 'explicit dependency'
  }

  const criteria = Array.isArray(task?.acceptance_criteria) ? task.acceptance_criteria : []
  const description = typeof task?.description === 'string' ? [task.description] : []
  const references = [...criteria, ...description]
  if (references.some((entry) => typeof entry === 'string' && entry.includes(targetTaskId))) {
    return 'acceptance criteria/reference'
  }

  return null
}

function sortOccurrences(left, right) {
  const leftIndex = Number.isFinite(left.task_index) ? left.task_index : Number.POSITIVE_INFINITY
  const rightIndex = Number.isFinite(right.task_index) ? right.task_index : Number.POSITIVE_INFINITY
  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex
  }
  return left.task_id.localeCompare(right.task_id)
}

export function detectFileConflicts(taskGraph) {
  const tasks = Array.isArray(taskGraph?.tasks) ? taskGraph.tasks : []
  if (tasks.length < 2) {
    return createEmptyConflictMap()
  }

  const executionOrder = Array.isArray(taskGraph?.execution_order) ? taskGraph.execution_order : []
  const taskIndexById = new Map(executionOrder.map((taskId, index) => [taskId, index]))
  const conflictMap = createEmptyConflictMap()
  const fileToTasks = new Map()

  for (const task of tasks) {
    const taskId = typeof task?.id === 'string' ? task.id : null
    if (!taskId) {
      continue
    }

    for (const filePath of collectTaskWriteFiles(task)) {
      const existing = fileToTasks.get(filePath) ?? []
      existing.push({
        file: filePath,
        task_id: taskId,
        task_index: taskIndexById.get(taskId),
        task,
      })
      fileToTasks.set(filePath, existing)
    }
  }

  for (const [filePath, occurrences] of fileToTasks.entries()) {
    if (occurrences.length < 2) {
      continue
    }

    const sorted = [...occurrences].sort(sortOccurrences)
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const current = sorted[index]
      const next = sorted[index + 1]
      const taskIds = [current.task_id, next.task_id]

      if (!Number.isFinite(current.task_index) || !Number.isFinite(next.task_index) || current.task_index >= next.task_index) {
        conflictMap.blocked.push({
          file: filePath,
          task_ids: taskIds,
          reason: 'Shared file write does not have a stable execution order in execution_order.',
        })
        continue
      }

      const referenceKind = referencesTaskId(next.task, current.task_id)
      if (referenceKind) {
        conflictMap.safe.push({
          file: filePath,
          task_ids: taskIds,
          reason: `Later task documents the shared-file sequence via ${referenceKind}.`,
        })
        continue
      }

      conflictMap.review_required.push({
        file: filePath,
        task_ids: taskIds,
        reason: 'Shared file is mutated by multiple sequential tasks without an explicit dependency or acknowledgement trail.',
      })
    }
  }

  return conflictMap
}

export function findMissingConflictAcknowledgements({ reviewRequiredConflicts, review }) {
  const requiredFiles = Array.isArray(reviewRequiredConflicts)
    ? reviewRequiredConflicts
        .map((entry) => (typeof entry?.file === 'string' ? entry.file.trim() : ''))
        .filter(Boolean)
    : []
  const acknowledged = new Set(
    Array.isArray(review?.acknowledged_conflicts)
      ? review.acknowledged_conflicts
          .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
          .filter(Boolean)
      : [],
  )

  return requiredFiles.filter((filePath) => !acknowledged.has(filePath))
}

export function createEmptyFileConflictMap() {
  return createEmptyConflictMap()
}
