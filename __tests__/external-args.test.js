/** @jest-environment node */

describe('RepoForeman CLI args', () => {
  it('defaults to the strict policy preset', async () => {
    const { parseArgs } = await import('../lib/args.mjs')
    const previousCi = process.env.CI
    delete process.env.CI

    try {
      const { options } = parseArgs(['run', '--task', 'hello'])

      expect(options.policy).toBe('strict')
    } finally {
      if (previousCi == null) {
        delete process.env.CI
      } else {
        process.env.CI = previousCi
      }
    }
  })

  it('disables web search by default', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    const { options } = parseArgs(['run', '--task', 'hello'])

    expect(options.search).toBe(false)
  })

  it('accepts --no-search to disable web search', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    const { options } = parseArgs(['run', '--task', 'hello', '--no-search'])

    expect(options.search).toBe(false)
  })

  it('accepts --verbose as a boolean flag', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    const { command, options } = parseArgs(['run', '--task', 'hello', '--verbose'])

    expect(command).toBe('run')
    expect(options.task).toBe('hello')
    expect(options.verbose).toBe(true)
  })

  it('accepts --pretty-events as a boolean flag', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    const { command, options } = parseArgs(['run', '--task', 'hello', '--pretty-events'])

    expect(command).toBe('run')
    expect(options.task).toBe('hello')
    expect(options.pretty_events).toBe(true)
  })

  it('defaults to autonomous mode with verbose pretty events enabled', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    const { options } = parseArgs(['run', '--task', 'hello'])

    expect(options.mode).toBe('autonomous')
    expect(options.interaction_model).toBe('phased')
    expect(options.verbose).toBe(true)
    expect(options.pretty_events).toBe(true)
  })

  it('accepts --interaction-model conversational', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    const { options } = parseArgs(['run', '--task', 'hello', '--interaction-model', 'conversational'])

    expect(options.interaction_model).toBe('conversational')
  })

  it('defaults and parses --max-review-fix-attempts', async () => {
    const { parseArgs } = await import('../lib/args.mjs')
    const previousCi = process.env.CI
    delete process.env.CI

    try {
      const { options: defaultOptions } = parseArgs(['run', '--task', 'hello'])
      expect(defaultOptions.review_mode).toBe('balanced')
      expect(defaultOptions.max_review_fix_attempts).toBe(4)

      const { options } = parseArgs(['run', '--task', 'hello', '--max-review-fix-attempts', '7'])
      expect(options.max_review_fix_attempts).toBe(7)
    } finally {
      if (previousCi == null) {
        delete process.env.CI
      } else {
        process.env.CI = previousCi
      }
    }
  })

  it('accepts --prompt-json-max-chars', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    const { options } = parseArgs(['run', '--task', 'hello', '--prompt-json-max-chars', '64000'])
    expect(options.prompt_json_max_chars).toBe(64000)
  })

  it('rejects invalid --prompt-json-max-chars', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    expect(() => parseArgs(['run', '--task', 'hello', '--prompt-json-max-chars', '0'])).toThrow(
      '--prompt-json-max-chars must be a positive integer',
    )
  })

  it('uses stricter retry defaults for strict review mode', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    const { options } = parseArgs(['run', '--task', 'hello', '--review-mode', 'strict'])
    expect(options.review_mode).toBe('strict')
    expect(options.max_review_fix_attempts).toBe(6)
  })

  it('uses minimal retry defaults for minimal review mode', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    const { options } = parseArgs(['run', '--task', 'hello', '--review-mode', 'minimal'])
    expect(options.review_mode).toBe('minimal')
    expect(options.max_review_fix_attempts).toBe(1)
  })

  it('defaults retry limits for task sizing and fixes', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    const { options } = parseArgs(['run', '--task', 'hello'])

    expect(options.max_fix_attempts).toBe(5)
    expect(options.max_worker_attempts).toBe(3)
    expect(options.max_task_graph_attempts).toBe(7)
  })

  it('accepts --task-tests and --final-tests', async () => {
    const { parseArgs } = await import('../lib/args.mjs')

    const { options } = parseArgs([
      'run',
      '--task',
      'hello',
      '--task-tests',
      'npm run test:unit',
      '--final-tests',
      'npm test -- --runInBand',
    ])

    expect(options.task_tests).toBe('npm run test:unit')
    expect(options.final_tests).toBe('npm test -- --runInBand')
  })

  it('defaults task tests to --tests and final tests to the repo verification contract', async () => {
    const { parseArgs } = await import('../lib/args.mjs')
    const previousCi = process.env.CI
    delete process.env.CI

    try {
      const { options } = parseArgs(['run', '--task', 'hello'])

      expect(options.task_tests).toBe(options.tests)
      expect(options.final_tests).toBe('npm test')
    } finally {
      if (previousCi == null) {
        delete process.env.CI
      } else {
        process.env.CI = previousCi
      }
    }
  })

  it('applies strict reliability defaults in CI when flags are omitted', async () => {
    const { parseArgs } = await import('../lib/args.mjs')
    const previousCi = process.env.CI
    process.env.CI = 'true'

    try {
      const { options } = parseArgs(['run', '--task', 'hello'])

      expect(options.policy).toBe('strict')
      expect(options.review_mode).toBe('strict')
      expect(options.coverage).toBe(true)
      expect(options.audit).toBe(true)
      expect(options.prompt_json_max_chars).toBe(32000)
      expect(options.final_tests).toBe('npm test')
      expect(options.task_tests).toBe('npm test')
    } finally {
      if (previousCi == null) {
        delete process.env.CI
      } else {
        process.env.CI = previousCi
      }
    }
  })
})
