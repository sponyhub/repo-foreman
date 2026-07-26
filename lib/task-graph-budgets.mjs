export const DEFAULT_TASK_GRAPH_BUDGETS = Object.freeze({
  max_files_per_task: 24,
  max_acceptance_criteria_per_task: 15,
  max_description_chars: 1800,
  max_verification_commands_per_task: 7,
})

function safeLength(value) {
  if (Array.isArray(value)) {
    return value.length
  }
  if (typeof value === 'string') {
    return value.length
  }
  return 0
}

function countTaskFiles(task) {
  const files = task?.files
  return safeLength(files?.create) + safeLength(files?.modify) + safeLength(files?.delete)
}

export function validateTaskGraphBudgets(taskGraph, budgets) {
  const resolvedBudgets = budgets ?? DEFAULT_TASK_GRAPH_BUDGETS
  const tasks = Array.isArray(taskGraph?.tasks) ? taskGraph.tasks : []

  const violations = []
  for (const task of tasks) {
    const taskId = typeof task?.id === 'string' ? task.id : '(missing-id)'

    const fileCount = countTaskFiles(task)
    if (Number.isFinite(resolvedBudgets.max_files_per_task) && fileCount > resolvedBudgets.max_files_per_task) {
      violations.push({
        task_id: taskId,
        kind: 'max_files_per_task',
        message: `Task lists ${fileCount} file(s) (budget max_files_per_task=${resolvedBudgets.max_files_per_task}).`,
      })
    }

    const acceptanceCriteriaCount = safeLength(task?.acceptance_criteria)
    if (
      Number.isFinite(resolvedBudgets.max_acceptance_criteria_per_task) &&
      acceptanceCriteriaCount > resolvedBudgets.max_acceptance_criteria_per_task
    ) {
      violations.push({
        task_id: taskId,
        kind: 'max_acceptance_criteria_per_task',
        message: `Task has ${acceptanceCriteriaCount} acceptance criteria (budget max_acceptance_criteria_per_task=${resolvedBudgets.max_acceptance_criteria_per_task}).`,
      })
    }

    const descriptionChars = safeLength(task?.description)
    if (Number.isFinite(resolvedBudgets.max_description_chars) && descriptionChars > resolvedBudgets.max_description_chars) {
      violations.push({
        task_id: taskId,
        kind: 'max_description_chars',
        message: `Task description is ${descriptionChars} chars (budget max_description_chars=${resolvedBudgets.max_description_chars}).`,
      })
    }

    const verificationCommandCount = safeLength(task?.verification_commands)
    if (
      Number.isFinite(resolvedBudgets.max_verification_commands_per_task) &&
      verificationCommandCount > resolvedBudgets.max_verification_commands_per_task
    ) {
      violations.push({
        task_id: taskId,
        kind: 'max_verification_commands_per_task',
        message: `Task lists ${verificationCommandCount} verification command(s) (budget max_verification_commands_per_task=${resolvedBudgets.max_verification_commands_per_task}).`,
      })
    }
  }

  return { ok: violations.length === 0, violations }
}

export function formatTaskGraphBudgetConstraints(budgets) {
  const resolved = budgets ?? DEFAULT_TASK_GRAPH_BUDGETS
  return [
    `- Keep each task implementable in a single Codex worker run.`,
    `- Per task, limit planned files touched (create+modify+delete) to <= ${resolved.max_files_per_task}.`,
    `- Per task, limit acceptance criteria items to <= ${resolved.max_acceptance_criteria_per_task}.`,
    `- Per task, limit description length to <= ${resolved.max_description_chars} characters.`,
    `- Per task, limit verification commands to <= ${resolved.max_verification_commands_per_task}.`,
    `- If any item would exceed a limit, split it into smaller tasks instead of increasing scope.`,
  ].join('\n')
}

export function formatTaskGraphBudgetFeedback(violations) {
  const items = Array.isArray(violations) ? violations : []
  if (items.length === 0) {
    return ''
  }
  const lines = ['Previous attempt violated budgets; split further:']
  for (const violation of items) {
    lines.push(`- [${violation.task_id}] ${violation.message}`)
  }
  return lines.join('\n')
}
