/**
 * @jest-environment node
 */

describe('task review loop controls', () => {
  test('allocates more cycle attempts than review-fix attempts', async () => {
    const { deriveTaskLoopLimits } = await import('../lib/task-loop-controls.mjs')

    expect(deriveTaskLoopLimits({ maxReviewFixAttempts: 6 })).toEqual({
      maxReviewFixAttempts: 6,
      maxVerificationRetries: 6,
      maxAutoResolveAttempts: 7,
      maxManagerAttempts: 6,
      maxCycles: 28,
    })
  })

  test('builds structured autonomous fallback answers for worker questions', async () => {
    const { buildAutonomousFallbackAnswersBlock } = await import('../lib/task-loop-controls.mjs')

    const block = buildAutonomousFallbackAnswersBlock([
      'Do you want me to fix unrelated coverage tooling now?',
      'Can I continue only with in-scope T02 work?',
    ])

    expect(block).toContain('```json')
    expect(block).toContain('"answers"')
    expect(block).toContain('safest in-scope default')
    expect(block).toContain('"allow_edits": true')
    expect(block).toContain('"allow_tests": true')
  })

  test('creates a deterministic signature for auto-answered question sets', async () => {
    const { createQuestionSetSignature } = await import('../lib/task-loop-controls.mjs')

    const a = createQuestionSetSignature(['q1', 'q2'])
    const b = createQuestionSetSignature(['q1', 'q2'])
    const c = createQuestionSetSignature(['q2', 'q1'])

    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})
