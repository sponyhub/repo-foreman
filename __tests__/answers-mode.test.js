/**
 * @jest-environment node
 */

describe('answers mode args', () => {
  test('defaults answers_mode to auto', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    const { options } = parseArgs(['run', '--task', 'Test answers mode'])

    expect(options.answers_mode).toBe('auto')
  })

  test('accepts explicit answers-mode console', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    const { options } = parseArgs(['run', '--task', 'Test answers mode', '--answers-mode', 'console'])

    expect(options.answers_mode).toBe('console')
  })

  test('rejects invalid answers-mode', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    expect(() => parseArgs(['run', '--task', 'Test answers mode', '--answers-mode', 'invalid'])).toThrow(
      '--answers-mode must be auto|file|console',
    )
  })
})
