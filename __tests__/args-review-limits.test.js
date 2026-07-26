/**
 * @jest-environment node
 */

describe('codex orchestrator review limits', () => {
  test('defaults max review diff growth lines', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    const { options } = parseArgs(['run', '--task', 'Test review limits'])

    expect(options.max_review_diff_growth_lines).toBe(1200)
  })

  test('rejects invalid max review diff growth lines', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    expect(() => parseArgs(['run', '--task', 'x', '--max-review-diff-growth-lines', '-1'])).toThrow(
      '--max-review-diff-growth-lines must be a non-negative integer',
    )
  })
})
