/**
 * @jest-environment node
 */

describe('policy allowlist mode args', () => {
  test('defaults policy allowlist mode to monitor', async () => {
    const { parseArgs } = await import('../lib/args.mjs')
    const { options } = parseArgs(['run', '--task', 'Implement feature'])

    expect(options.policy_allowlist_mode).toBe('monitor')
  })

  test('accepts explicit monitor mode', async () => {
    const { parseArgs } = await import('../lib/args.mjs')
    const { options } = parseArgs([
      'run',
      '--task',
      'Implement feature',
      '--policy-allowlist-mode',
      'monitor',
    ])

    expect(options.policy_allowlist_mode).toBe('monitor')
  })

  test('rejects unsupported policy allowlist mode', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    expect(() =>
      parseArgs(['run', '--task', 'Implement feature', '--policy-allowlist-mode', 'invalid']),
    ).toThrow('--policy-allowlist-mode must be off|monitor|enforce')
  })

  test('policy allowlist mode does not alter required final verification command defaults', async () => {
    const { parseArgs } = await import('../lib/args.mjs')
    const { options } = parseArgs([
      'run',
      '--task',
      'Implement feature',
      '--policy',
      'strict',
      '--policy-allowlist-mode',
      'monitor',
    ])

    expect(options.final_tests).toBe('npm test')
  })
})
