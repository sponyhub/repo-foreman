/**
 * @jest-environment node
 */

describe('blocking question pre-check', () => {
  test('extracts only blocking questions from analysis gate payloads', async () => {
    const { extractBlockingPrecheckQuestions } = await import('../lib/blocking-question-precheck.mjs')

    const result = extractBlockingPrecheckQuestions([
      'How should we handle UI copy?',
      { text: 'Need explicit GDPR retention policy before architecture.', category: 'gdpr', requires_user_input: true },
      { text: 'Confirm naming style', severity: 'low', requires_user_input: false },
      '[blocking] Confirm production secret-rotation constraints.',
    ])

    expect(result).toEqual([
      {
        id: 'BQ-1',
        question: 'Need explicit GDPR retention policy before architecture.',
      },
      {
        id: 'BQ-2',
        question: 'Confirm production secret-rotation constraints.',
      },
    ])
  })

  test('autonomous mode resolves blocking questions as assumptions and logs mitigations', async () => {
    const { resolveBlockingQuestionPrecheck } = await import('../lib/blocking-question-precheck.mjs')
    const logs = []
    const blockingQuestions = [{ id: 'BQ-1', question: 'Need legal confirmation for GDPR retention policy.' }]

    const result = resolveBlockingQuestionPrecheck({
      mode: 'autonomous',
      blockingQuestions,
      log: (message) => logs.push(message),
    })

    expect(result.blocking_questions_resolved).toBe(true)
    expect(result.blocking_questions).toEqual([
      {
        id: 'BQ-1',
        question: 'Need legal confirmation for GDPR retention policy.',
        assumed_answer: expect.any(String),
        mitigation: expect.any(String),
        resolved_by: 'autonomous_assumption',
      },
    ])
    expect(logs).toEqual([
      expect.stringContaining("Autonomous mode: treating blocking question 'BQ-1' as assumption with mitigation:"),
    ])
  })

  test('interactive mode records user-provided answers in order', async () => {
    const { resolveBlockingQuestionPrecheck } = await import('../lib/blocking-question-precheck.mjs')
    const blockingQuestions = [
      { id: 'BQ-1', question: 'Question one?' },
      { id: 'BQ-2', question: 'Question two?' },
    ]

    const result = resolveBlockingQuestionPrecheck({
      mode: 'interactive',
      blockingQuestions,
      structuredAnswers: ['Answer 1', 'Answer 2'],
    })

    expect(result).toEqual({
      blocking_questions: [
        {
          id: 'BQ-1',
          question: 'Question one?',
          assumed_answer: 'Answer 1',
          mitigation: null,
          resolved_by: 'user',
        },
        {
          id: 'BQ-2',
          question: 'Question two?',
          assumed_answer: 'Answer 2',
          mitigation: null,
          resolved_by: 'user',
        },
      ],
      blocking_questions_resolved: true,
    })
  })
})
