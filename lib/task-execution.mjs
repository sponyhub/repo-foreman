const POST_TASK_EXECUTION_STATES = new Set([
  'INTEGRATION_REVIEW_DONE',
  'TESTS_PASSED',
  'COVERAGE_PASSED',
  'AUDIT_PASSED',
  'SUMMARY_DONE',
])

function normalizeExecutionOrder(executionOrder) {
  if (!Array.isArray(executionOrder)) {
    return []
  }
  return executionOrder.filter((taskId) => typeof taskId === 'string' && taskId.trim())
}

function clampIndex(value, total) {
  const numericValue = Number.isFinite(value) ? Math.trunc(value) : 0
  return Math.min(Math.max(numericValue, 0), total)
}

function normalizeTaskExecutionShape(taskExecution, executionOrder = []) {
  const normalizedExecutionOrder = normalizeExecutionOrder(executionOrder)
  const validTaskIds = new Set(normalizedExecutionOrder)
  const completedTaskIds = Array.isArray(taskExecution?.completed_task_ids)
    ? Array.from(
        new Set(
          taskExecution.completed_task_ids.filter(
            (taskId) => typeof taskId === 'string' && taskId.trim() && validTaskIds.has(taskId),
          ),
        ),
      )
    : []

  const failedTaskId =
    typeof taskExecution?.failed_task_id === 'string' && taskExecution.failed_task_id.trim()
      ? taskExecution.failed_task_id.trim()
      : null
  const currentTaskIndex = Math.max(
    clampIndex(taskExecution?.current_task_index, normalizedExecutionOrder.length),
    completedTaskIds.length,
  )

  return {
    total: normalizedExecutionOrder.length,
    completed_task_ids: completedTaskIds,
    failed_task_id: failedTaskId,
    current_task_index: currentTaskIndex,
    last_updated:
      typeof taskExecution?.last_updated === 'string' && taskExecution.last_updated.trim()
        ? taskExecution.last_updated
        : null,
  }
}

export function createTaskExecutionState(executionOrder = []) {
  return normalizeTaskExecutionShape({}, executionOrder)
}

export function hydrateTaskExecutionState({ executionOrder = [], taskExecution = null, force = false, warnOnMissing = true }) {
  const normalizedExecutionOrder = normalizeExecutionOrder(executionOrder)
  const warningMessages = []
  const normalizedTaskExecution = taskExecution
    ? normalizeTaskExecutionShape(taskExecution, normalizedExecutionOrder)
    : createTaskExecutionState(normalizedExecutionOrder)

  if (!taskExecution && warnOnMissing) {
    warningMessages.push('task_execution not found in state - starting Phase 11 from beginning.')
  }

  if (force && normalizedTaskExecution.completed_task_ids.length > 0) {
    warningMessages.push(
      `WARNING: --force flag detected but ${normalizedTaskExecution.completed_task_ids.length} already-committed tasks will be skipped to prevent double-commit. Use --reset-tasks to clear commit history if a full rerun is intended.`,
    )
  }

  const completedTaskIds = new Set(normalizedTaskExecution.completed_task_ids)
  const startIndex = normalizedTaskExecution.current_task_index
  const pendingTaskIds = normalizedExecutionOrder.slice(startIndex).filter((taskId) => !completedTaskIds.has(taskId))
  const resumeMessage =
    taskExecution == null
      ? null
      : `Resuming Phase 11 from task ${startIndex + 1} of ${normalizedTaskExecution.total} (${normalizedTaskExecution.completed_task_ids.length} already committed, skipping).`

  return {
    taskExecution: normalizedTaskExecution,
    completedTaskIds,
    startIndex,
    pendingTaskIds,
    resumeMessage,
    warningMessages,
  }
}

export function shouldSkipCommittedTask({ completedTaskIds, taskId }) {
  return completedTaskIds instanceof Set ? completedTaskIds.has(taskId) : false
}

export function recordCommittedTask({ taskExecution, taskId, timestamp = new Date().toISOString() }) {
  const currentTaskExecution = {
    total: Number.isFinite(taskExecution?.total) ? Math.max(0, Math.trunc(taskExecution.total)) : 0,
    completed_task_ids: Array.isArray(taskExecution?.completed_task_ids) ? taskExecution.completed_task_ids : [],
    failed_task_id:
      typeof taskExecution?.failed_task_id === 'string' && taskExecution.failed_task_id.trim()
        ? taskExecution.failed_task_id.trim()
        : null,
    current_task_index: Number.isFinite(taskExecution?.current_task_index)
      ? Math.max(0, Math.trunc(taskExecution.current_task_index))
      : 0,
    last_updated:
      typeof taskExecution?.last_updated === 'string' && taskExecution.last_updated.trim()
        ? taskExecution.last_updated
        : null,
  }
  const completedTaskIds = new Set(currentTaskExecution.completed_task_ids)
  completedTaskIds.add(taskId)

  return {
    ...currentTaskExecution,
    completed_task_ids: Array.from(completedTaskIds),
    failed_task_id: null,
    current_task_index: Math.min(
      currentTaskExecution.total,
      Math.max(currentTaskExecution.current_task_index + 1, completedTaskIds.size),
    ),
    last_updated: timestamp,
  }
}

export function recordFailedTask({ taskExecution, taskId, timestamp = new Date().toISOString() }) {
  return {
    total: Number.isFinite(taskExecution?.total) ? Math.max(0, Math.trunc(taskExecution.total)) : 0,
    completed_task_ids: Array.isArray(taskExecution?.completed_task_ids) ? [...taskExecution.completed_task_ids] : [],
    failed_task_id: taskId,
    current_task_index: Number.isFinite(taskExecution?.current_task_index)
      ? Math.max(0, Math.trunc(taskExecution.current_task_index))
      : 0,
    last_updated: timestamp,
  }
}

function resolvePhase11Status(phaseState, taskExecution) {
  if (phaseState === 'IMPLEMENTING_TASKS') {
    return 'in progress'
  }
  if ((taskExecution?.current_task_index ?? 0) >= (taskExecution?.total ?? 0) || POST_TASK_EXECUTION_STATES.has(phaseState)) {
    return 'complete'
  }
  return 'interrupted'
}

export function formatTaskExecutionProgressLines({ phaseState, taskExecution }) {
  if (!taskExecution || typeof taskExecution !== 'object') {
    return []
  }

  const total = Number.isFinite(taskExecution.total) ? Math.max(0, Math.trunc(taskExecution.total)) : 0
  if (total === 0) {
    return []
  }

  const completedTaskIds = Array.isArray(taskExecution.completed_task_ids) ? taskExecution.completed_task_ids : []
  const lines = [
    `Phase 11: Per-task implementation (${resolvePhase11Status(phaseState, taskExecution)})`,
    `  Tasks: ${completedTaskIds.length} / ${total} completed`,
  ]

  if (completedTaskIds.length > 0) {
    lines.push(`  Last completed: ${completedTaskIds.at(-1)}`)
  }
  if (typeof taskExecution.failed_task_id === 'string' && taskExecution.failed_task_id.trim()) {
    lines.push(`  Failed: ${taskExecution.failed_task_id}`)
  }

  return lines
}
