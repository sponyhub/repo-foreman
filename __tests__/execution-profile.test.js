/**
 * @jest-environment node
 */

describe('execution profile args', () => {
  test('defaults to standard execution profile mapped to balanced review mode', async () => {
    const previousCi = process.env.CI
    delete process.env.CI
    try {
      const { parseArgs } = await import('../lib/args.mjs')
      const { options } = parseArgs(['run', '--task', 'Implement feature'])

      expect(options.execution_profile).toBe('standard')
      expect(options.review_mode).toBe('balanced')
    } finally {
      if (previousCi == null) {
        delete process.env.CI
      } else {
        process.env.CI = previousCi
      }
    }
  })

  test('maps fast execution profile to minimal review mode', async () => {
    const { parseArgs } = await import('../lib/args.mjs')
    const { options } = parseArgs(['run', '--task', 'Implement feature', '--execution-profile', 'fast'])

    expect(options.execution_profile).toBe('fast')
    expect(options.review_mode).toBe('minimal')
  })

  test('maps strict execution profile to strict review mode', async () => {
    const { parseArgs } = await import('../lib/args.mjs')
    const { options } = parseArgs(['run', '--task', 'Implement feature', '--execution-profile', 'strict'])

    expect(options.execution_profile).toBe('strict')
    expect(options.review_mode).toBe('strict')
  })

  test('rejects unsupported execution profile', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    expect(() => parseArgs(['run', '--task', 'Implement feature', '--execution-profile', 'ultra'])).toThrow(
      '--execution-profile must be fast|standard|strict',
    )
  })

  test('allows providing matching execution profile and review mode', async () => {
    const { parseArgs } = await import('../lib/args.mjs')
    const { options } = parseArgs([
      'run',
      '--task',
      'Implement feature',
      '--execution-profile',
      'standard',
      '--review-mode',
      'balanced',
    ])

    expect(options.execution_profile).toBe('standard')
    expect(options.review_mode).toBe('balanced')
  })

  test('rejects conflicting execution profile and review mode', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    expect(() =>
      parseArgs([
        'run',
        '--task',
        'Implement feature',
        '--execution-profile',
        'fast',
        '--review-mode',
        'strict',
      ]),
    ).toThrow('--execution-profile fast maps to --review-mode minimal, but got strict')
  })

  test('uses strict profile defaults in CI', async () => {
    const { parseArgs } = await import('../lib/args.mjs')
    const previousCi = process.env.CI
    process.env.CI = '1'
    try {
      const { options } = parseArgs(['run', '--task', 'Implement feature'])
      expect(options.execution_profile).toBe('strict')
      expect(options.review_mode).toBe('strict')
    } finally {
      if (previousCi == null) {
        delete process.env.CI
      } else {
        process.env.CI = previousCi
      }
    }
  })
})
