/**
 * @jest-environment node
 */

describe('codex orchestrator worker block handling', () => {
  test('autonomous mode prefers auto-resolve', async () => {
    const { decideWorkerBlockedAction } = await import('../lib/mode.mjs')

    expect(typeof decideWorkerBlockedAction).toBe('function')
    expect(decideWorkerBlockedAction({ mode: 'autonomous' })).toBe('auto-resolve')
  })

  test('interactive mode waits for user input by default', async () => {
    const { decideWorkerBlockedAction } = await import('../lib/mode.mjs')

    expect(typeof decideWorkerBlockedAction).toBe('function')
    expect(decideWorkerBlockedAction({ mode: 'interactive' })).toBe('wait')
    expect(decideWorkerBlockedAction({})).toBe('wait')
  })

  test('autonomous mode waits when questions are security/compliance critical', async () => {
    const { decideWorkerBlockedAction } = await import('../lib/mode.mjs')

    expect(typeof decideWorkerBlockedAction).toBe('function')
    expect(
      decideWorkerBlockedAction({
        mode: 'autonomous',
        questions: ['[blocking] Legal/GDPR confirmation required before proceeding'],
      }),
    ).toBe('wait')
  })

  test('metadata-first critical structured questions stop autonomous auto-resolve', async () => {
    const { decideWorkerBlockedAction } = await import('../lib/mode.mjs')

    expect(typeof decideWorkerBlockedAction).toBe('function')
    expect(
      decideWorkerBlockedAction({
        mode: 'autonomous',
        questions: [
          'Can I continue with code formatting cleanups?',
          {
            text: 'Approval required before proceeding.',
            severity: 'critical',
            category: 'gdpr',
            requires_user_input: true,
          },
        ],
      }),
    ).toBe('wait')
  })
})
