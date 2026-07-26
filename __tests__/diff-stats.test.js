/**
 * @jest-environment node
 */

describe('diff stats helpers', () => {
  test('parses git numstat output into totals', async () => {
    const { parseNumstat, totalChangedLines } = await import('../lib/diff-stats.mjs')

    const output = ['10\t2\tlib/run.mjs', '0\t1\tREADME.md', '-\t-\tassets/logo.png'].join('\n')
    const stats = parseNumstat(output)

    expect(stats.files).toBe(3)
    expect(stats.binaryFiles).toBe(1)
    expect(stats.added).toBe(10)
    expect(stats.deleted).toBe(3)
    expect(totalChangedLines(stats)).toBe(13)
  })

  test('handles empty numstat output', async () => {
    const { parseNumstat, totalChangedLines } = await import('../lib/diff-stats.mjs')

    const stats = parseNumstat('')

    expect(stats.files).toBe(0)
    expect(stats.binaryFiles).toBe(0)
    expect(stats.added).toBe(0)
    expect(stats.deleted).toBe(0)
    expect(totalChangedLines(stats)).toBe(0)
  })

  test('checks diff growth limit', async () => {
    const { diffGrowthWithinLimit } = await import('../lib/diff-stats.mjs')

    expect(diffGrowthWithinLimit({ previousLines: 10, currentLines: 15, maxGrowth: 5 }).ok).toBe(true)
    expect(diffGrowthWithinLimit({ previousLines: 10, currentLines: 16, maxGrowth: 5 }).ok).toBe(false)
  })
})
