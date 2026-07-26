import path from 'node:path'

function splitBranchNameSegments(branchName) {
  if (!branchName || typeof branchName !== 'string') {
    throw new Error('resolveRunAndWorktreePaths: branchName must be a non-empty string')
  }
  if (branchName.includes('\0')) {
    throw new Error('resolveRunAndWorktreePaths: branchName contains NUL byte')
  }
  if (branchName.startsWith('/') || branchName.startsWith('\\')) {
    throw new Error('resolveRunAndWorktreePaths: branchName must be a relative ref name')
  }

  const rawSegments = branchName.split('/')
  if (rawSegments.length === 0) {
    throw new Error('resolveRunAndWorktreePaths: branchName must not be empty')
  }

  const segments = []
  for (const seg of rawSegments) {
    const segment = String(seg ?? '')
    if (!segment) {
      throw new Error('resolveRunAndWorktreePaths: branchName contains an empty path segment')
    }
    if (segment === '.' || segment === '..') {
      throw new Error('resolveRunAndWorktreePaths: branchName contains a path traversal segment')
    }
    if (segment.includes('\\')) {
      throw new Error('resolveRunAndWorktreePaths: branchName must use "/" separators only')
    }
    segments.push(segment)
  }

  return segments
}
export function resolveRunAndWorktreePaths({ branchName }) {
  const segments = splitBranchNameSegments(branchName)
  return {
    branchSegments: segments,
    runRelativePath: path.join('.repo-foreman', 'runs', ...segments),
    worktreeRelativePath: path.join('.repo-foreman', 'worktrees', ...segments),
  }
}
