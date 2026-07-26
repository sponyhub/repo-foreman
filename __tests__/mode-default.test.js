/**
 * @jest-environment node
 */

describe('mode defaults', () => {
  test('defaults to autonomous mode', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    const { options } = parseArgs(['run', '--task', 'Test default mode'])

    expect(options.mode).toBe('autonomous')
  })

  test('accepts explicit autonomous mode', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    const { options } = parseArgs(['run', '--task', 'Test default mode', '--mode', 'autonomous'])

    expect(options.mode).toBe('autonomous')
  })
})
