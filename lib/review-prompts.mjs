import path from 'node:path'

const REVIEW_PROMPTS = new Map([
  ['analysis', '04-analysis-review.md'],
  ['architecture', '04-architecture-review.md'],
  ['task_graph', '04-task-graph-review.md'],
  ['integration', '04-integration-review.md'],
  ['verification', '04-verification-review.md'],
])

export function getReviewPromptFile({ reviewTarget, promptsDir }) {
  const promptFile =
    reviewTarget?.startsWith('task:') ? '04-task-review.md' : REVIEW_PROMPTS.get(reviewTarget)
  return path.join(promptsDir, promptFile ?? '04-integration-review.md')
}
