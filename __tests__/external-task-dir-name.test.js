/** @jest-environment node */

describe('RepoForeman task dir naming', () => {
  it('derives a deterministic slug from the task title', async () => {
    const { deriveTaskDirSlug } = await import('../lib/task-dir-name.mjs')

    expect(deriveTaskDirSlug('Remove invoice email from user types and fixtures')).toBe(
      'invoice-email-user-types-fixtures',
    )
  })

  it('disambiguates duplicate slugs with numeric suffixes', async () => {
    const { buildTaskDirNameMap } = await import('../lib/task-dir-name.mjs')

    const map = buildTaskDirNameMap([
      { id: 'T1', title: 'Update docs' },
      { id: 'T2', title: 'Update docs' },
    ])

    expect(map.get('T1')).toBe('update-docs')
    expect(map.get('T2')).toBe('update-docs-2')
  })
})
