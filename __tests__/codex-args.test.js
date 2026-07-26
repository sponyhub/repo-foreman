/**
 * @jest-environment node
 */

describe('codex exec arg construction', () => {
  test('requires the public Codex exec flags used by RepoForeman', async () => {
    const { assessCodexCliContract } = await import('../lib/codex.mjs')
    const supported = assessCodexCliContract({
      cliVersion: 'codex-cli test',
      execHelpText:
        '--ask-for-approval --cd --json --output-last-message --output-schema --sandbox --search',
    })
    const unsupported = assessCodexCliContract({ execHelpText: '--json --sandbox' })

    expect(supported).toMatchObject({ supported: true, missingFlags: [] })
    expect(unsupported.supported).toBe(false)
    expect(unsupported.missingFlags).toContain('--output-schema')
    expect(unsupported.missingFlags).toContain('--search')
  })

  test('classifies current CLI help as incompatible with true live in-place structured interaction', async () => {
    const { assessCodexLiveInteractionSupport } = await import('../lib/codex.mjs')

    const capability = assessCodexLiveInteractionSupport({
      cliVersion: 'codex-cli 0.111.0',
      execHelpText: `
Usage: codex exec [OPTIONS] [PROMPT] [COMMAND]

Arguments:
  [PROMPT]
          Initial instructions for the agent. If not provided as an argument (or if \`-\` is used),
          instructions are read from stdin
`,
      execResumeHelpText: `
Usage: codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]

Options:
      --json
          Print events to stdout as JSONL

  -o, --output-last-message <FILE>
          Specifies file where the last message from the agent should be written
`,
    })

    expect(capability.supported).toBe(false)
    expect(capability.mode).toBe('interrupt-replay')
    expect(capability.blockers).toEqual([
      'exec_has_no_documented_live_input_channel',
      'resume_missing_output_schema',
      'resume_missing_sandbox',
      'resume_missing_cd',
    ])
    expect(capability.summary).toContain('interrupt-and-replay')
  })

  test('uses the RepoForeman default model when no model override is provided', async () => {
    const { buildCodexExecArgs } = await import('../lib/codex.mjs')

    const args = buildCodexExecArgs({
      repoRoot: '/repo',
      schemaPath: '/repo/schema.json',
      outputPath: '/repo/out.json',
      sandbox: 'danger-full-access',
      search: false,
    })

    const modelFlagIndex = args.indexOf('--model')
    expect(modelFlagIndex).toBeGreaterThanOrEqual(0)
    expect(args[modelFlagIndex + 1]).toBe('gpt-5.6-sol')
    expect(args).toEqual(expect.arrayContaining(['--ask-for-approval', 'on-request']))
    expect(args).toContain('sandbox_workspace_write.network_access=false')
  })

  test('passes an explicit model override to Codex CLI', async () => {
    const { buildCodexExecArgs } = await import('../lib/codex.mjs')

    const args = buildCodexExecArgs({
      repoRoot: '/repo',
      schemaPath: '/repo/schema.json',
      outputPath: '/repo/out.json',
      sandbox: 'workspace-write',
      search: false,
      model: 'test-model',
    })

    const modelFlagIndex = args.indexOf('--model')
    expect(modelFlagIndex).toBeGreaterThanOrEqual(0)
    expect(args[modelFlagIndex + 1]).toBe('test-model')
  })

  test('enables live web search only via the official --search opt-in', async () => {
    const { buildCodexExecArgs } = await import('../lib/codex.mjs')

    const args = buildCodexExecArgs({
      repoRoot: '/repo',
      schemaPath: '/repo/schema.json',
      outputPath: '/repo/out.json',
      sandbox: 'danger-full-access',
      search: true,
    })

    expect(args[0]).toBe('exec')
    expect(args).toContain('--search')
    expect(args).not.toContain('web_search_request')
  })

  test('disables web search explicitly when search is not enabled', async () => {
    const { buildCodexExecArgs } = await import('../lib/codex.mjs')

    const args = buildCodexExecArgs({
      repoRoot: '/repo',
      schemaPath: '/repo/schema.json',
      outputPath: '/repo/out.json',
      sandbox: 'danger-full-access',
      search: false,
    })

    expect(args[0]).toBe('exec')
    expect(args).toContain('web_search="disabled"')
    expect(args).not.toContain('--search')
    expect(args).not.toContain('web_search_request')
  })

  test('uses the RepoForeman default reasoning effort when no override is provided', async () => {
    const { buildCodexExecArgs } = await import('../lib/codex.mjs')

    const args = buildCodexExecArgs({
      repoRoot: '/repo',
      schemaPath: '/repo/schema.json',
      outputPath: '/repo/out.json',
      sandbox: 'danger-full-access',
      search: false,
    })

    expect(args).toContain('model_reasoning_effort="xhigh"')
  })

  test('allows overriding reasoning effort', async () => {
    const { buildCodexExecArgs } = await import('../lib/codex.mjs')

    const args = buildCodexExecArgs({
      repoRoot: '/repo',
      schemaPath: '/repo/schema.json',
      outputPath: '/repo/out.json',
      sandbox: 'danger-full-access',
      search: false,
      reasoningEffort: 'low',
    })

    expect(args).toContain('model_reasoning_effort="low"')
  })
})
