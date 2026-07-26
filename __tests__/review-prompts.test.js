/**
 * @jest-environment node
 */

const path = require('node:path')

describe('review prompt selection', () => {
  test('uses scoped review prompts for pre-implementation phases', async () => {
    const { getReviewPromptFile } = await import('../lib/review-prompts.mjs')
    const promptsDir = '/tmp/prompts'

    expect(getReviewPromptFile({ reviewTarget: 'analysis', promptsDir })).toBe(
      path.join(promptsDir, '04-analysis-review.md'),
    )
    expect(getReviewPromptFile({ reviewTarget: 'architecture', promptsDir })).toBe(
      path.join(promptsDir, '04-architecture-review.md'),
    )
    expect(getReviewPromptFile({ reviewTarget: 'task_graph', promptsDir })).toBe(
      path.join(promptsDir, '04-task-graph-review.md'),
    )
  })

  test('uses scoped review prompts for implementation phases', async () => {
    const { getReviewPromptFile } = await import('../lib/review-prompts.mjs')
    const promptsDir = '/tmp/prompts'

    expect(getReviewPromptFile({ reviewTarget: 'integration', promptsDir })).toBe(
      path.join(promptsDir, '04-integration-review.md'),
    )
    expect(getReviewPromptFile({ reviewTarget: 'verification', promptsDir })).toBe(
      path.join(promptsDir, '04-verification-review.md'),
    )
    expect(getReviewPromptFile({ reviewTarget: 'task:publish-flow', promptsDir })).toBe(
      path.join(promptsDir, '04-task-review.md'),
    )
  })
})
