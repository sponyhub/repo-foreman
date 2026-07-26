/** @jest-environment node */

describe('RepoForeman mode', () => {
  it('treats needs_user_input as non-blocking in autonomous mode', async () => {
    const { decideGateAction } = await import('../lib/mode.mjs')

    expect(decideGateAction({ mode: 'autonomous', gateStatus: 'needs_user_input' })).toEqual({
      stop: false,
      effectiveStatus: 'pass-with-warnings',
    })
  })

  it('stops on needs_user_input in interactive mode', async () => {
    const { decideGateAction } = await import('../lib/mode.mjs')

    expect(decideGateAction({ mode: 'interactive', gateStatus: 'needs_user_input' })).toEqual({
      stop: true,
      effectiveStatus: 'needs_user_input',
    })
  })

  it('always stops on blocked gate status', async () => {
    const { decideGateAction } = await import('../lib/mode.mjs')

    expect(decideGateAction({ mode: 'autonomous', gateStatus: 'blocked' })).toEqual({
      stop: true,
      effectiveStatus: 'blocked',
    })
  })

  it('stops on critical compliance/security questions even in autonomous mode', async () => {
    const { decideGateAction } = await import('../lib/mode.mjs')

    expect(
      decideGateAction({
        mode: 'autonomous',
        gateStatus: 'needs_user_input',
        gateQuestions: ['[blocking] GDPR processor approval missing'],
      }),
    ).toEqual({
      stop: true,
      effectiveStatus: 'needs_user_input',
    })
  })
})
