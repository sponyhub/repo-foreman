/**
 * @jest-environment node
 */

const path = require('node:path')

describe('run/worktree path naming', () => {
  test('derives run/worktree directories from the full branch name', async () => {
    const { resolveRunAndWorktreePaths } = await import('../lib/run-paths.mjs')

    const branchName = 'oauth-csrf-20250101T000000-abcdef'
    const resolved = resolveRunAndWorktreePaths({ branchName })

    expect(resolved.runRelativePath).toBe(path.join('.patch-gantry', 'runs', 'oauth-csrf-20250101T000000-abcdef'))
    expect(resolved.worktreeRelativePath).toBe(
      path.join('.patch-gantry', 'worktrees', 'oauth-csrf-20250101T000000-abcdef'),
    )
  })

  test('rejects path traversal in branch-derived directories', async () => {
    const { resolveRunAndWorktreePaths } = await import('../lib/run-paths.mjs')

    expect(() => resolveRunAndWorktreePaths({ branchName: '../evil' })).toThrow(/branchName/i)
    expect(() => resolveRunAndWorktreePaths({ branchName: '/absolute' })).toThrow(/branchName/i)
    expect(() => resolveRunAndWorktreePaths({ branchName: 'codex/../evil' })).toThrow(/branchName/i)
  })
})
