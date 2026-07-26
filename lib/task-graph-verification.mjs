export function ensureTaskGraphVerificationCommands(taskGraph, requiredCommands) {
  const required = [
    ...new Set(
      (Array.isArray(requiredCommands) ? requiredCommands : [])
        .filter((command) => typeof command === 'string' && command.trim())
        .map((command) => command.trim()),
    ),
  ]

  if (!taskGraph) {
    return { taskGraph, changed: false }
  }

  const tasks = Array.isArray(taskGraph.tasks) ? taskGraph.tasks : []
  let changed = false

  const nextTasks = tasks.map((task) => {
    const existing = Array.isArray(task?.verification_commands) ? task.verification_commands : []
    if (existing.length === required.length && existing.every((command, index) => command === required[index])) {
      return task
    }
    changed = true
    return { ...task, verification_commands: [...required] }
  })

  if (!changed) {
    return { taskGraph, changed: false }
  }

  return { taskGraph: { ...taskGraph, tasks: nextTasks }, changed: true }
}
