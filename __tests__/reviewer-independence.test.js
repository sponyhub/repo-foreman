/**
 * @jest-environment node
 */

const fs = require('node:fs/promises')
const path = require('node:path')

describe('reviewer independence mode', () => {
  test('defaults to linked reviewer context mode', async () => {
    const { parseArgs } = await import('../lib/args.mjs')
    const { options } = parseArgs(['run', '--task', 'Implement feature'])

    expect(options.reviewer_independence).toBe('linked')
  })

  test('accepts isolated reviewer context mode', async () => {
    const { parseArgs } = await import('../lib/args.mjs')
    const { options } = parseArgs([
      'run',
      '--task',
      'Implement feature',
      '--reviewer-independence',
      'isolated',
    ])

    expect(options.reviewer_independence).toBe('isolated')
  })

  test('rejects unsupported reviewer context mode', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    expect(() =>
      parseArgs(['run', '--task', 'Implement feature', '--reviewer-independence', 'invalid']),
    ).toThrow('--reviewer-independence must be linked|isolated')
  })

  test('suppresses previous review context in isolated mode', async () => {
    const { previousReviewPromptValue } = await import('../lib/reviewer-independence.mjs')

    const render = jest.fn(() => '{"verdict":"revise"}')
    const review = { verdict: 'revise', summary: 'Fix this' }

    const result = previousReviewPromptValue({
      previousReview: review,
      reviewerIndependence: 'isolated',
      renderPreviousReview: render,
    })

    expect(result).toBe('N/A')
    expect(render).not.toHaveBeenCalled()
  })

  test('includes previous review context in linked mode', async () => {
    const { previousReviewPromptValue } = await import('../lib/reviewer-independence.mjs')

    const render = jest.fn(() => '{"verdict":"revise"}')
    const review = { verdict: 'revise', summary: 'Fix this' }

    const result = previousReviewPromptValue({
      previousReview: review,
      reviewerIndependence: 'linked',
      renderPreviousReview: render,
    })

    expect(result).toBe('{"verdict":"revise"}')
    expect(render).toHaveBeenCalledTimes(1)
    expect(render).toHaveBeenCalledWith(review)
  })

  test('review phase prompt wiring passes reviewer independence mode', async () => {
    const runSource = await fs.readFile(path.join(__dirname, '..', 'lib', 'run.mjs'), 'utf8')

    expect(runSource).toContain('REVIEWER_INDEPENDENCE_MODE: options.reviewer_independence')
    expect(runSource).toContain('PREVIOUS_REVIEW_JSON: previousReviewPromptValue({')
  })
})
