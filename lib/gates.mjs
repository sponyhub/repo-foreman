export function validateTaskGraph(taskGraph) {
  const errors = []
  const tasks = Array.isArray(taskGraph?.tasks) ? taskGraph.tasks : []
  const executionOrder = Array.isArray(taskGraph?.execution_order) ? taskGraph.execution_order : []

  if (tasks.length === 0) {
    errors.push('tasks must be non-empty')
    return { ok: false, errors }
  }

  const ids = tasks.map((task) => task?.id).filter(Boolean)
  const idSet = new Set(ids)
  if (ids.length !== tasks.length || idSet.size !== tasks.length) {
    errors.push('task ids must be unique and non-empty')
  }

  if (executionOrder.length !== tasks.length) {
    errors.push('execution_order must include every task id exactly once')
  } else {
    const orderSet = new Set(executionOrder)
    if (orderSet.size !== executionOrder.length) {
      errors.push('execution_order must not contain duplicates')
    }
    for (const id of ids) {
      if (!orderSet.has(id)) {
        errors.push('execution_order must include every task id exactly once')
        break
      }
    }
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]))
  let topologicalOk = true
  const seen = new Set()
  for (const taskId of executionOrder) {
    const task = taskById.get(taskId)
    if (!task) {
      topologicalOk = false
      continue
    }
    for (const depId of Array.isArray(task.dependencies) ? task.dependencies : []) {
      if (!taskById.has(depId)) {
        errors.push(`task ${taskId} depends on missing task ${depId}`)
        topologicalOk = false
        continue
      }
      if (!seen.has(depId)) {
        topologicalOk = false
      }
    }
    seen.add(taskId)
  }
  if (!topologicalOk) {
    errors.push('execution_order must be dependency-topological')
  }

  for (const task of tasks) {
    if (!Array.isArray(task.acceptance_criteria) || task.acceptance_criteria.length === 0) {
      errors.push(`task ${task.id} acceptance_criteria must be non-empty`)
    }
  }

  return { ok: errors.length === 0, errors }
}
