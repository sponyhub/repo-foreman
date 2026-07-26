export function parseNumstat(output) {
  const stats = {
    added: 0,
    deleted: 0,
    files: 0,
    binaryFiles: 0,
  }

  if (!output || !output.trim()) {
    return stats
  }

  const lines = output.split('\n').filter(Boolean)
  for (const line of lines) {
    const [addedRaw, deletedRaw] = line.split('\t')
    if (addedRaw == null || deletedRaw == null) {
      continue
    }
    stats.files += 1

    if (addedRaw === '-' || deletedRaw === '-') {
      stats.binaryFiles += 1
      continue
    }

    const added = parseInt(addedRaw, 10)
    const deleted = parseInt(deletedRaw, 10)
    if (Number.isFinite(added)) {
      stats.added += added
    }
    if (Number.isFinite(deleted)) {
      stats.deleted += deleted
    }
  }

  return stats
}

export function totalChangedLines(stats) {
  const added = Number.isFinite(stats?.added) ? stats.added : 0
  const deleted = Number.isFinite(stats?.deleted) ? stats.deleted : 0
  return added + deleted
}

export function diffGrowthWithinLimit({ previousLines, currentLines, maxGrowth }) {
  const previous = Number.isFinite(previousLines) ? previousLines : 0
  const current = Number.isFinite(currentLines) ? currentLines : 0
  const growth = current - previous
  return {
    ok: growth <= maxGrowth,
    growth,
  }
}
