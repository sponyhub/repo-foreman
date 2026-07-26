/**
 * @jest-environment node
 */

describe('branch naming', () => {
  test('derives 2-5 descriptive words from the task text', async () => {
    const { deriveBranchDescriptorWords } = await import('../lib/branch-name.mjs')

    const words = deriveBranchDescriptorWords('Implement a better branch name for codex orchestrator runs')

    expect(words).toEqual(['better', 'branch', 'name', 'codex', 'orchestrator'])
    expect(words.length).toBeGreaterThanOrEqual(2)
    expect(words.length).toBeLessThanOrEqual(5)
  })

  test('uses full task context instead of only the first line when deriving words', async () => {
    const { deriveBranchDescriptorWords } = await import('../lib/branch-name.mjs')

    const words = deriveBranchDescriptorWords(`20251218T154418-215096

Fix OAuth callback CSRF in dev
`)

    expect(words).toEqual(['oauth', 'callback', 'csrf', 'dev'])
  })

  test('falls back to relaxed filtering when strict filtering yields <2 words', async () => {
    const { deriveBranchDescriptorWords } = await import('../lib/branch-name.mjs')

    expect(deriveBranchDescriptorWords('Fix bug')).toEqual(['fix', 'bug'])
  })

  test('makeRunBranchName appends the run id and keeps a safe, readable prefix', async () => {
    const { makeRunBranchName } = await import('../lib/branch-name.mjs')

    const runId = '20250101T000000-abcdef'
    const branch = makeRunBranchName({ runId, taskText: 'Implement a better branch name for Patch Gantry runs' })

    expect(branch).toBe(`better-branch-name-patch-gantry-${runId}`)
  })
})
