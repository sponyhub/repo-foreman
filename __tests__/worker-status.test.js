/**
 * @jest-environment node
 */

describe('codex orchestrator worker status', () => {
  test('treats only blocked status as blocking', async () => {
    const { isWorkerStatusBlocking } = await import('../lib/worker-status.mjs')

    expect(isWorkerStatusBlocking('blocked')).toBe(true)
    expect(isWorkerStatusBlocking('partial')).toBe(false)
    expect(isWorkerStatusBlocking('done')).toBe(false)
    expect(isWorkerStatusBlocking()).toBe(false)
  })
})
