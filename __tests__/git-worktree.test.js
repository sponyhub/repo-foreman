/**
 * @jest-environment node
 */

const { execFile } = require('node:child_process')
const { mkdtemp, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

async function runGit(cwd, args) {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout.trim()
}

async function initRepo(repoDir) {
  await runGit(repoDir, ['init', '-b', 'main'])
  await runGit(repoDir, ['config', 'user.email', 'test@example.com'])
  await runGit(repoDir, ['config', 'user.name', 'Test User'])
  await writeFile(path.join(repoDir, 'README.md'), 'hello\n')
  await runGit(repoDir, ['add', 'README.md'])
  await runGit(repoDir, ['commit', '-m', 'init'])
}

describe('git worktree helpers', () => {
  test('createWorktreeWithNewBranch creates a worktree without switching the main worktree branch', async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), 'patch-gantry-'))
    try {
      await initRepo(repoDir)
      const baseSha = await runGit(repoDir, ['rev-parse', 'HEAD'])

      const branchName = 'test-run'
      const worktreePath = path.join(repoDir, '.patch-gantry', 'worktrees', 'test-run')

      const { createWorktreeWithNewBranch } = await import('../lib/git.mjs')
      await createWorktreeWithNewBranch(repoDir, { worktreePath, branchName, baseRef: baseSha })

      expect(await runGit(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main')
      expect(await runGit(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(branchName)
      expect(await runGit(worktreePath, ['rev-parse', 'HEAD'])).toBe(baseSha)
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  test('createWorktreeForExistingBranch checks out an existing branch into a worktree directory', async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), 'patch-gantry-'))
    try {
      await initRepo(repoDir)
      const baseSha = await runGit(repoDir, ['rev-parse', 'HEAD'])
      await runGit(repoDir, ['branch', 'feature'])

      const worktreePath = path.join(repoDir, '.patch-gantry', 'worktrees', 'feature-worktree')

      const { createWorktreeForExistingBranch } = await import('../lib/git.mjs')
      await createWorktreeForExistingBranch(repoDir, { worktreePath, branchName: 'feature' })

      expect(await runGit(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('feature')
      expect(await runGit(worktreePath, ['rev-parse', 'HEAD'])).toBe(baseSha)
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })
})
