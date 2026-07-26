/**
 * @jest-environment node
 */

describe('codex orchestrator question severity helpers', () => {
  test('splits blocking vs non-blocking questions', async () => {
    const { splitQuestionCaptureQuestions } = await import('../lib/question-severity.mjs')

    const result = splitQuestionCaptureQuestions({
      blocking_questions: ['Blocker?', '  '],
      questions: ['Non-blocking?', ''],
    })

    expect(result.blockingQuestions).toEqual(['Blocker?'])
    expect(result.nonBlockingQuestions).toEqual(['Non-blocking?'])
    expect(result.allQuestions).toEqual(['Blocker?', 'Non-blocking?'])
  })

  test('normalizes mixed legacy and structured question payloads to text', async () => {
    const { splitQuestionCaptureQuestions } = await import('../lib/question-severity.mjs')

    const result = splitQuestionCaptureQuestions({
      blocking_questions: [{ text: 'Structured blocker' }],
      questions: ['Legacy question', { text: 'Structured non-blocker' }],
    })

    expect(result.blockingQuestions).toEqual(['Structured blocker'])
    expect(result.nonBlockingQuestions).toEqual(['Legacy question', 'Structured non-blocker'])
    expect(result.allQuestions).toEqual(['Structured blocker', 'Legacy question', 'Structured non-blocker'])
  })

  test('formats questions with severity labels', async () => {
    const { formatQuestionEntries } = await import('../lib/question-severity.mjs')

    const entries = formatQuestionEntries({
      blockingQuestions: ['Blocker?'],
      nonBlockingQuestions: ['Non-blocking?'],
    })

    expect(entries).toEqual(['[blocking] Blocker?', '[non-blocking] Non-blocking?'])
  })
})
