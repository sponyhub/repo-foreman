/**
 * @jest-environment node
 */

describe('codex orchestrator task graph budgets', () => {
  test('defaults keep tasks small and reviewable', async () => {
    const { DEFAULT_TASK_GRAPH_BUDGETS } = await import('../lib/task-graph-budgets.mjs')

    expect(DEFAULT_TASK_GRAPH_BUDGETS.max_files_per_task).toBe(24)
    expect(DEFAULT_TASK_GRAPH_BUDGETS.max_description_chars).toBe(1800)
  })
})
