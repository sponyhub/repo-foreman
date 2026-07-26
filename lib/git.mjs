import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildCodexSubprocessEnv } from './env.mjs'

const execFileAsync = promisify(execFile)

export async function git(repoRoot, args, { allowFailure = false } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: repoRoot,
      env: buildCodexSubprocessEnv(process.env),
    })
    return stdout.trim()
  } catch (error) {
    if (allowFailure) {
      return String(error?.stdout ?? '').trim()
    }
    const stderr = String(error?.stderr ?? '').trim()
    const message = stderr || error?.message || 'git command failed'
    throw new Error(`git ${args.join(' ')}: ${message}`)
  }
}

export async function assertGitRepo(repoRoot) {
  const inside = await git(repoRoot, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true })
  if (inside !== 'true') {
    throw new Error('Not inside a git repository')
  }
}

export async function getRepoRoot(startDir) {
  const root = await git(startDir, ['rev-parse', '--show-toplevel'])
  if (!root) {
    throw new Error('Unable to resolve git repo root')
  }
  return root
}

export async function getHeadSha(repoRoot) {
  return await git(repoRoot, ['rev-parse', 'HEAD'])
}

export async function getStatusPorcelain(repoRoot) {
  return await git(repoRoot, ['status', '--porcelain'])
}

export async function hasChanges(repoRoot) {
  const status = await getStatusPorcelain(repoRoot)
  return Boolean(status.trim())
}

export async function ensureCleanWorkingTree(repoRoot, { autostash = false, stashMessage } = {}) {
  const status = await getStatusPorcelain(repoRoot)
  if (!status.trim()) {
    return { stashed: false }
  }

  if (!autostash) {
    throw new Error('Uncommitted changes present (use --autostash to proceed)')
  }

  await git(repoRoot, ['stash', 'push', '-u', '-m', stashMessage ?? 'patch-gantry autostash'])
  return { stashed: true }
}

export async function popAutostash(repoRoot) {
  await git(repoRoot, ['stash', 'pop'], { allowFailure: true })
}

export async function ensureGitAuthorConfigured(repoRoot, { name, email }) {
  const currentName = await git(repoRoot, ['config', '--get', 'user.name'], { allowFailure: true })
  const currentEmail = await git(repoRoot, ['config', '--get', 'user.email'], { allowFailure: true })

  if (!currentName.trim()) {
    await git(repoRoot, ['config', 'user.name', name])
  }
  if (!currentEmail.trim()) {
    await git(repoRoot, ['config', 'user.email', email])
  }
}

export async function createAndCheckoutBranch(repoRoot, branchName) {
  await git(repoRoot, ['checkout', '-b', branchName])
}

export async function checkoutBranch(repoRoot, branchName) {
  await git(repoRoot, ['checkout', branchName])
}

export async function addAll(repoRoot) {
  await git(repoRoot, ['add', '-A'])
}

export async function commit(repoRoot, message) {
  await git(repoRoot, ['commit', '-m', message])
}

export async function createWorktreeWithNewBranch(repoRoot, { worktreePath, branchName, baseRef }) {
  if (!worktreePath || typeof worktreePath !== 'string') {
    throw new Error('createWorktreeWithNewBranch: worktreePath must be a non-empty string')
  }
  if (!branchName || typeof branchName !== 'string') {
    throw new Error('createWorktreeWithNewBranch: branchName must be a non-empty string')
  }
  if (!baseRef || typeof baseRef !== 'string') {
    throw new Error('createWorktreeWithNewBranch: baseRef must be a non-empty string')
  }

  await git(repoRoot, ['worktree', 'add', '-b', branchName, worktreePath, baseRef])
}

export async function createWorktreeForExistingBranch(repoRoot, { worktreePath, branchName }) {
  if (!worktreePath || typeof worktreePath !== 'string') {
    throw new Error('createWorktreeForExistingBranch: worktreePath must be a non-empty string')
  }
  if (!branchName || typeof branchName !== 'string') {
    throw new Error('createWorktreeForExistingBranch: branchName must be a non-empty string')
  }

  await git(repoRoot, ['worktree', 'add', worktreePath, branchName])
}
