/**
 * @jest-environment node
 */

describe('codex orchestrator review mode', () => {
  test('uses tuned default review retry budgets per mode', async () => {
    const { defaultMaxReviewFixAttemptsForMode } = await import('../lib/review-mode.mjs')

    expect(defaultMaxReviewFixAttemptsForMode('strict')).toBe(6)
    expect(defaultMaxReviewFixAttemptsForMode('balanced')).toBe(4)
    expect(defaultMaxReviewFixAttemptsForMode('minimal')).toBe(1)
  })

  test('runs all review phases in strict mode', async () => {
    const { shouldRunReviewPhase } = await import('../lib/review-mode.mjs')

    expect(shouldRunReviewPhase({ reviewMode: 'strict', reviewTarget: 'analysis' })).toBe(true)
    expect(shouldRunReviewPhase({ reviewMode: 'strict', reviewTarget: 'task:abc' })).toBe(true)
    expect(shouldRunReviewPhase({ reviewMode: 'strict', reviewTarget: 'integration' })).toBe(true)
  })

  test('skips scoped reviews in minimal mode but keeps end-of-run reviews', async () => {
    const { shouldRunReviewPhase } = await import('../lib/review-mode.mjs')

    expect(shouldRunReviewPhase({ reviewMode: 'minimal', reviewTarget: 'analysis' })).toBe(false)
    expect(shouldRunReviewPhase({ reviewMode: 'minimal', reviewTarget: 'architecture' })).toBe(false)
    expect(shouldRunReviewPhase({ reviewMode: 'minimal', reviewTarget: 'task_graph' })).toBe(false)
    expect(shouldRunReviewPhase({ reviewMode: 'minimal', reviewTarget: 'task:abc' })).toBe(false)
    expect(shouldRunReviewPhase({ reviewMode: 'minimal', reviewTarget: 'integration' })).toBe(true)
    expect(shouldRunReviewPhase({ reviewMode: 'minimal', reviewTarget: 'verification' })).toBe(true)
  })
})
