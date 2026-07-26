/** @jest-environment node */

describe('RepoForeman run id', () => {
  it('generates a stable, filesystem-safe run id', async () => {
    const { generateRunId } = await import('../lib/run.mjs')

    expect(() => generateRunId()).not.toThrow()
    expect(generateRunId()).toMatch(/^\d{8}T\d{6}-[0-9a-f]{6}$/)
  })
})
