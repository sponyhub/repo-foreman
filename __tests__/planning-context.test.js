/**
 * @jest-environment node
 */

describe('planning context', () => {
  test('merges unique, trimmed entries', async () => {
    const { createPlanningContext, mergePlanningContext } = await import('../lib/planning-context.mjs')

    const context = createPlanningContext()
    mergePlanningContext(context, {
      assumptions: ['  safest default  ', '', 'safest default', 'extra'],
      mitigations: ['m1', 'm1', '  '],
      task_hints: ['task A', 'task A', 'task B'],
    })

    expect(context.assumptions).toEqual(['safest default', 'extra'])
    expect(context.mitigations).toEqual(['m1'])
    expect(context.task_hints).toEqual(['task A', 'task B'])
  })
})
