/**
 * @jest-environment node
 */

describe('RepoForeman model defaults', () => {
  test('records the default model and reasoning effort in a new run manifest', async () => {
    const { createManifest } = await import('../lib/manifest.mjs')

    const manifest = createManifest({
      runId: 'test-run',
      mode: 'autonomous',
      reviewMode: 'balanced',
      createdAt: '2026-07-26T00:00:00.000Z',
      baseSha: 'abc123',
      branchName: 'repo-foreman/run-test-run',
      worktreePath: '/tmp/repo-foreman-test-run',
      taskSource: { type: 'inline' },
      policyPreset: 'strict',
      runtimeConfig: {},
    })

    expect(manifest.model).toBe('gpt-5.6-sol')
    expect(manifest.model_reasoning_effort).toBe('xhigh')
    expect(manifest.runtime_config).toMatchObject({
      model: 'gpt-5.6-sol',
      reasoning_effort: 'xhigh',
    })
  })

  test('records explicit model and reasoning overrides in a new run manifest', async () => {
    const { createManifest } = await import('../lib/manifest.mjs')

    const manifest = createManifest({
      runId: 'test-run',
      mode: 'autonomous',
      reviewMode: 'balanced',
      createdAt: '2026-07-26T00:00:00.000Z',
      baseSha: 'abc123',
      branchName: 'repo-foreman/run-test-run',
      worktreePath: '/tmp/repo-foreman-test-run',
      taskSource: { type: 'inline' },
      policyPreset: 'strict',
      runtimeConfig: {
        model: 'custom-model',
        reasoning_effort: 'low',
      },
    })

    expect(manifest.model).toBe('custom-model')
    expect(manifest.model_reasoning_effort).toBe('low')
    expect(manifest.runtime_config).toMatchObject({
      model: 'custom-model',
      reasoning_effort: 'low',
    })
  })
})
