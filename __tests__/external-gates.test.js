/** @jest-environment node */

describe('PatchGantry gates', () => {
  it('rejects an empty task graph', async () => {
    const { validateTaskGraph } = await import('../lib/gates.mjs')

    const result = validateTaskGraph({
      gate: { status: 'pass', reasons: [], questions: [] },
      execution_order: [],
      tasks: [],
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('tasks must be non-empty')
  })

  it('rejects invalid dependencies and execution order', async () => {
    const { validateTaskGraph } = await import('../lib/gates.mjs')

    const result = validateTaskGraph({
      gate: { status: 'pass', reasons: [], questions: [] },
      execution_order: ['t2', 't1'],
      tasks: [
        {
          id: 't1',
          title: 'Task 1',
          type: 'code',
          description: 'Do t1',
          acceptance_criteria: ['a'],
          dependencies: ['t2'],
          risk_level: 'low',
          files: { create: [], modify: [], delete: [] },
          verification_commands: ['npm test'],
        },
        {
          id: 't2',
          title: 'Task 2',
          type: 'tests',
          description: 'Do t2',
          acceptance_criteria: ['b'],
          dependencies: ['does-not-exist'],
          risk_level: 'low',
          files: { create: [], modify: [], delete: [] },
          verification_commands: ['npm test'],
        },
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('task t2 depends on missing task does-not-exist')
    expect(result.errors).toContain('execution_order must be dependency-topological')
  })

  it('accepts a valid dependency-aware task graph', async () => {
    const { validateTaskGraph } = await import('../lib/gates.mjs')

    const result = validateTaskGraph({
      gate: { status: 'pass', reasons: [], questions: [] },
      execution_order: ['t1', 't2'],
      tasks: [
        {
          id: 't1',
          title: 'Task 1',
          type: 'tests',
          description: 'Do t1',
          acceptance_criteria: ['a'],
          dependencies: [],
          risk_level: 'low',
          files: { create: [], modify: [], delete: [] },
          verification_commands: ['npm test'],
        },
        {
          id: 't2',
          title: 'Task 2',
          type: 'code',
          description: 'Do t2',
          acceptance_criteria: ['b'],
          dependencies: ['t1'],
          risk_level: 'low',
          files: { create: [], modify: [], delete: [] },
          verification_commands: ['npm test'],
        },
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })
})
