/**
 * @jest-environment node
 */

describe('failure manager decision validation', () => {
  test('accepts safe retry action with feedback', async () => {
    const { validateFailureManagerDecision, validateRecoveryAction } = await import('../lib/failure-manager.mjs')

    const result = validateFailureManagerDecision({
      action: 'retry',
      reason: 'Address reviewer blocker with explicit fix guidance.',
      review_feedback: '{"blocking_issues":[{"id":"T02-B1"}]}',
      verification_feedback: '',
      questions: [],
      answers: [],
      notes: [],
    })

    expect(result.ok).toBe(true)
    expect(result.decision.action).toBe('retry')
    expect(validateRecoveryAction(result.decision, {})).toEqual({ valid: true, reason: 'ok' })
  })

  test('blocks unknown actions and falls back to escalate', async () => {
    const { resolveRecoveryAction } = await import('../lib/failure-manager.mjs')

    const result = resolveRecoveryAction({
      suggestion: {
        action: 'delete_and_retry',
        reason: 'unsafe',
        review_feedback: '',
        verification_feedback: '',
        questions: [],
        answers: [],
        notes: [],
      },
      context: { task: { id: 'T-1' } },
      timestamp: '2026-03-05T10:00:00.000Z',
    })

    expect(result.validation).toEqual({ valid: false, reason: 'action_not_in_allowlist' })
    expect(result.decision.action).toBe('escalate')
    expect(result.invalidRecoverySuggestion).toEqual({
      action: 'delete_and_retry',
      reason: 'action_not_in_allowlist',
      task_id: 'T-1',
      timestamp: '2026-03-05T10:00:00.000Z',
    })
  })

  test('rejects unsafe retry instructions that disable quality gates', async () => {
    const { validateFailureManagerDecision, validateRecoveryAction } = await import('../lib/failure-manager.mjs')

    const normalized = validateFailureManagerDecision({
      action: 'retry',
      reason: 'unsafe',
      review_feedback: 'Skip npm test and disable checks to pass quickly.',
      verification_feedback: '',
      questions: [],
      answers: [],
      notes: [],
    })

    expect(normalized.ok).toBe(true)
    expect(validateRecoveryAction(normalized.decision, {})).toEqual({
      valid: false,
      reason: 'unsafe_recovery_instruction',
    })
  })

  test('blocks auto-answer decisions for gdpr questions', async () => {
    const { validateFailureManagerDecision, validateRecoveryAction } = await import('../lib/failure-manager.mjs')

    const result = validateFailureManagerDecision({
      action: 'auto_answer_noncritical',
      reason: 'unsafe',
      review_feedback: '',
      verification_feedback: '',
      questions: ['Can we proceed?'],
      answers: ['Proceed.'],
      notes: [],
    })

    expect(result.ok).toBe(true)
    expect(
      validateRecoveryAction(result.decision, {
        mode: 'autonomous',
        questions: [{ text: 'Can we proceed?', gdpr: true, answer_type: 'free_text' }],
      }),
    ).toEqual({
      valid: false,
      reason: 'auto_answer_blocked_sensitive_question',
    })
  })

  test('blocks auto-answer decisions when answer type does not match question type', async () => {
    const { validateFailureManagerDecision, validateRecoveryAction } = await import('../lib/failure-manager.mjs')

    const result = validateFailureManagerDecision({
      action: 'auto_answer_noncritical',
      reason: 'unsafe',
      review_feedback: '',
      verification_feedback: '',
      questions: ['Enable the fallback?'],
      answers: ['yes'],
      notes: [],
    })

    expect(result.ok).toBe(true)
    expect(
      validateRecoveryAction(result.decision, {
        mode: 'autonomous',
        questions: [{ text: 'Enable the fallback?', answer_type: 'boolean' }],
      }),
    ).toEqual({
      valid: false,
      reason: 'answer_type_mismatch',
    })
  })

  test('blocks skip_task on required tasks', async () => {
    const { validateFailureManagerDecision, validateRecoveryAction } = await import('../lib/failure-manager.mjs')

    const result = validateFailureManagerDecision({
      action: 'skip_task',
      reason: 'unsafe',
      review_feedback: '',
      verification_feedback: '',
      questions: [],
      answers: [],
      notes: [],
    })

    expect(result.ok).toBe(true)
    expect(validateRecoveryAction(result.decision, { task: { required: true } })).toEqual({
      valid: false,
      reason: 'skip_blocked_required_task',
    })
  })

  test('blocks skip_task on migration tasks', async () => {
    const { validateFailureManagerDecision, validateRecoveryAction } = await import('../lib/failure-manager.mjs')

    const result = validateFailureManagerDecision({
      action: 'skip_task',
      reason: 'unsafe',
      review_feedback: '',
      verification_feedback: '',
      questions: [],
      answers: [],
      notes: [],
    })

    expect(result.ok).toBe(true)
    expect(validateRecoveryAction(result.decision, { task: { affects_migrations: true } })).toEqual({
      valid: false,
      reason: 'skip_blocked_schema_task',
    })
  })

  test('accepts valid escalate suggestions', async () => {
    const { validateFailureManagerDecision, validateRecoveryAction } = await import('../lib/failure-manager.mjs')

    const result = validateFailureManagerDecision({
      action: 'escalate',
      reason: 'Need explicit user decision.',
      review_feedback: '',
      verification_feedback: '',
      questions: [],
      answers: [],
      notes: [],
    })

    expect(result.ok).toBe(true)
    expect(result.decision.questions).toHaveLength(1)
    expect(validateRecoveryAction(result.decision, {})).toEqual({ valid: true, reason: 'ok' })
  })

  test('accepts valid auto-answer decisions when enum answers match', async () => {
    const { validateFailureManagerDecision, validateRecoveryAction } = await import('../lib/failure-manager.mjs')

    const result = validateFailureManagerDecision({
      action: 'auto_answer_noncritical',
      reason: 'Use the safest supported enum.',
      review_feedback: '',
      verification_feedback: '',
      questions: ['Choose the publish mode.'],
      answers: ['dry-run'],
      notes: [],
    })

    expect(result.ok).toBe(true)
    expect(
      validateRecoveryAction(result.decision, {
        mode: 'autonomous',
        questions: [{ text: 'Choose the publish mode.', answer_type: 'enum', options: ['dry-run', 'apply'] }],
      }),
    ).toEqual({ valid: true, reason: 'ok' })
  })
})
