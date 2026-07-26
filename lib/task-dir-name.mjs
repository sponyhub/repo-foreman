import { deriveBranchDescriptorWords } from './branch-name.mjs'

export function deriveTaskDirSlug(title) {
  const rawTitle = typeof title === 'string' ? title.trim() : ''
  if (!rawTitle) {
    return 'codex-task'
  }

  const words = deriveBranchDescriptorWords(rawTitle)
  return words.join('-')
}

export function buildTaskDirNameMap(tasks) {
  const entries = Array.isArray(tasks) ? tasks : []
  const used = new Map()
  const byId = new Map()

  for (const task of entries) {
    if (!task || typeof task.id !== 'string' || !task.id) {
      continue
    }

    const base = deriveTaskDirSlug(task.title)
    const nextCount = (used.get(base) ?? 0) + 1
    used.set(base, nextCount)

    const dirName = nextCount === 1 ? base : `${base}-${nextCount}`
    byId.set(task.id, dirName)
  }

  return byId
}
