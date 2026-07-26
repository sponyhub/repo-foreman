/**
 * @jest-environment node
 */

describe('promotion sample size args', () => {
  test('defaults promotion sample size to 30', async () => {
    const { parseArgs } = await import('../lib/args.mjs')
    const { options } = parseArgs(['promote'])

    expect(options.promotion_sample_size).toBe(30)
  })

  test('accepts explicit promotion sample size', async () => {
    const { parseArgs } = await import('../lib/args.mjs')
    const { options } = parseArgs(['promote', '--promotion-sample-size', '12'])

    expect(options.promotion_sample_size).toBe(12)
  })

  test('rejects invalid promotion sample size', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    expect(() => parseArgs(['promote', '--promotion-sample-size', '0'])).toThrow(
      '--promotion-sample-size must be a positive integer',
    )
  })
})
