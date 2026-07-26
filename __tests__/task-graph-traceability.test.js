/**
 * @jest-environment node
 */

describe('task graph traceability', () => {
  test('finds missing architecture decision coverage in task narratives', async () => {
    const { findMissingArchitectureDecisionCoverage } = await import('../lib/task-graph-traceability.mjs')

    const architecture = {
      decisions: [{ id: 'D1' }, { id: 'D2' }, { id: 'SEC-4' }],
    }
    const taskGraph = {
      tasks: [
        {
          description: 'Implement API contract [trace:D1]',
          acceptance_criteria: ['covers D2 behavior'],
        },
      ],
    }

    expect(findMissingArchitectureDecisionCoverage({ architecture, taskGraph })).toEqual(['SEC-4'])
  })

  test('returns empty list when all decision IDs are covered', async () => {
    const { findMissingArchitectureDecisionCoverage } = await import('../lib/task-graph-traceability.mjs')

    const architecture = {
      decisions: [{ id: 'D1' }, { id: 'D2' }],
    }
    const taskGraph = {
      tasks: [
        {
          description: 'Implements D1 and D2',
          acceptance_criteria: [],
        },
      ],
    }

    expect(findMissingArchitectureDecisionCoverage({ architecture, taskGraph })).toEqual([])
  })
})
