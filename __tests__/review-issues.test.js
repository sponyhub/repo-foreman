/**
 * @jest-environment node
 */

describe('codex orchestrator review issue handling', () => {
  test('filters only actionable blocking issues', async () => {
    const { getActionableBlockingIssues } = await import('../lib/review-issues.mjs')

    const review = {
      blocking_issues: [
        { id: 'ok-1', description: 'Fix behavior', suggested_fix: 'Update condition' },
        { id: '', description: 'Missing id', suggested_fix: 'n/a' },
        { id: 'missing-fix', description: 'No suggested fix', suggested_fix: '' },
        { id: 'missing-desc', description: '', suggested_fix: 'Do something' },
      ],
    }

    expect(getActionableBlockingIssues(review)).toEqual([{ id: 'ok-1', description: 'Fix behavior', suggested_fix: 'Update condition' }])
  })
})
