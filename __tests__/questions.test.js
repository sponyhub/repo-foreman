/**
 * @jest-environment node
 */

describe('codex orchestrator structured question normalization', () => {
  test('uses metadata/defaults for structured questions and does not fallback to keyword inference', async () => {
    const { normalizeQuestion } = await import('../lib/questions.mjs')

    const normalized = normalizeQuestion(
      {
        text: 'GDPR sign-off required before publish.',
      },
      {
        defaultSeverity: 'low',
        defaultCategory: 'other',
        defaultRequiresUserInput: false,
      },
    )

    expect(normalized).toMatchObject({
      text: 'GDPR sign-off required before publish.',
      severity: 'low',
      category: 'other',
      requires_user_input: false,
      source: 'structured',
    })
  })

  test('keeps keyword fallback for legacy string questions', async () => {
    const { normalizeQuestion } = await import('../lib/questions.mjs')

    const normalized = normalizeQuestion('GDPR sign-off required before publish.')

    expect(normalized).toMatchObject({
      severity: 'critical',
      category: 'gdpr',
      requires_user_input: true,
      source: 'legacy',
    })
  })
})
