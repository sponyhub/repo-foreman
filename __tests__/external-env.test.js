/** @jest-environment node */

describe('RepoForeman env filtering', () => {
  it('excludes common secret env prefixes by default', async () => {
    const { buildCodexSubprocessEnv } = await import('../lib/env.mjs')

    const env = buildCodexSubprocessEnv({
      PATH: '/bin',
      HOME: '/home/test',
      CI: '1',
      NODE_ENV: 'test',
      AWS_SECRET_ACCESS_KEY: 'abc',
      AZURE_CLIENT_SECRET: 'def',
      GOOGLE_APPLICATION_CREDENTIALS: '/secrets/gcp.json',
      STRIPE_SECRET_KEY: 'sk_test_123',
      OPENAI_API_KEY: 'sk-test',
    })

    expect(env.PATH).toBe('/bin')
    expect(env.HOME).toBe('/home/test')
    expect(env.CI).toBe('1')
    expect(env.NODE_ENV).toBe('test')
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(env.AZURE_CLIENT_SECRET).toBeUndefined()
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined()
    expect(env.STRIPE_SECRET_KEY).toBeUndefined()
    expect(env.OPENAI_API_KEY).toBeUndefined()
  })

  it('includes only explicitly allowlisted operational variables', async () => {
    const { buildCodexSubprocessEnv } = await import('../lib/env.mjs')

    const env = buildCodexSubprocessEnv({
      PATH: '/bin',
      HOME: '/home/test',
      npm_config_user_agent: 'npm/11 node/v24',
      NODE_OPTIONS: '--max-old-space-size=2048',
      GIT_TERMINAL_PROMPT: '0',
      CODEX_HOME: '/tmp/codex',
    })

    expect(env.npm_config_user_agent).toBe('npm/11 node/v24')
    expect(env.CODEX_HOME).toBe('/tmp/codex')
    expect(env.NODE_OPTIONS).toBeUndefined()
    expect(env.GIT_TERMINAL_PROMPT).toBeUndefined()
  })
})
