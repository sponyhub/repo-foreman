/**
 * @jest-environment node
 */

const path = require('node:path')

describe('patch-gantry policy presets', () => {
  const basePolicy = {
    version: 2,
    name: 'test',
    deny_substrings: ['rm -rf'],
    deny_regex: [],
    deny_path_globs: [],
    allow_path_globs: [],
    deny_diff_regex: [],
    max_deleted_files: 0,
  }

  test('strict policy allows curl but still blocks wget', async () => {
    const { loadPolicy, detectForbiddenContent } = await import('../lib/policy.mjs')

    const policiesDir = path.join(__dirname, '..', 'policies')
    const policy = await loadPolicy({ policyName: 'strict', policiesDir })

    expect(policy.deny_substrings).not.toContain('curl ')

    expect(detectForbiddenContent('curl https://example.com', policy)).toEqual([])
    expect(detectForbiddenContent('wget https://example.com', policy)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'deny_substring', pattern: 'wget ' })]),
    )
  })

  test('balanced policy allows curl but still blocks wget', async () => {
    const { loadPolicy, detectForbiddenContent } = await import('../lib/policy.mjs')

    const policiesDir = path.join(__dirname, '..', 'policies')
    const policy = await loadPolicy({ policyName: 'balanced', policiesDir })

    expect(policy.deny_substrings).not.toContain('curl ')

    expect(detectForbiddenContent('curl https://example.com', policy)).toEqual([])
    expect(detectForbiddenContent('wget https://example.com', policy)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'deny_substring', pattern: 'wget ' })]),
    )
  })

  test('strict policy does not false-positive on async tokens inside heredoc payloads', async () => {
    const { loadPolicy, detectForbiddenContent } = await import('../lib/policy.mjs')

    const policiesDir = path.join(__dirname, '..', 'policies')
    const policy = await loadPolicy({ policyName: 'strict', policiesDir })

    const command =
      "/bin/zsh -lc \"cat <<'EOF' > __tests__/sample.test.ts\nit('works', async () => {\n  expect(true).toBe(true)\n})\nEOF\""

    expect(detectForbiddenContent(command, policy)).toEqual([])
  })

  test('strict policy still blocks explicit nc command usage', async () => {
    const { loadPolicy, detectForbiddenContent } = await import('../lib/policy.mjs')

    const policiesDir = path.join(__dirname, '..', 'policies')
    const policy = await loadPolicy({ policyName: 'strict', policiesDir })

    expect(detectForbiddenContent("/bin/zsh -lc 'nc 127.0.0.1 80'", policy)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'deny_substring', pattern: 'nc ' })]),
    )
  })

  test('strict policy allows mktemp-scoped rm -rf cleanup', async () => {
    const { loadPolicy, detectForbiddenContent } = await import('../lib/policy.mjs')

    const policiesDir = path.join(__dirname, '..', 'policies')
    const policy = await loadPolicy({ policyName: 'strict', policiesDir })

    const command = "/bin/zsh -lc 'tmpdir=$(mktemp -d) && touch \"$tmpdir/check.ts\"; rm -rf \"$tmpdir\"'"

    expect(detectForbiddenContent(command, policy)).toEqual([])
  })

  test('strict policy still blocks rm -rf outside mktemp-scoped cleanup', async () => {
    const { loadPolicy, detectForbiddenContent } = await import('../lib/policy.mjs')

    const policiesDir = path.join(__dirname, '..', 'policies')
    const policy = await loadPolicy({ policyName: 'strict', policiesDir })

    const command = "/bin/zsh -lc 'tmpdir=/tmp/work && rm -rf \"$tmpdir\"'"

    expect(detectForbiddenContent(command, policy)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'deny_substring', pattern: 'rm -rf' })]),
    )
  })

  test('strict policy blocks rm -rf when mktemp variable is reassigned', async () => {
    const { loadPolicy, detectForbiddenContent } = await import('../lib/policy.mjs')

    const policiesDir = path.join(__dirname, '..', 'policies')
    const policy = await loadPolicy({ policyName: 'strict', policiesDir })

    const command = "/bin/zsh -lc 'tmpdir=$(mktemp -d); tmpdir=/; rm -rf \"$tmpdir\"'"

    expect(detectForbiddenContent(command, policy)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'deny_substring', pattern: 'rm -rf' })]),
    )
  })

  test('allowlist monitor mode reports non-allowlisted command without enforcing block', async () => {
    const { evaluateCommandPolicy } = await import('../lib/policy.mjs')

    const result = evaluateCommandPolicy({
      command: 'python scripts/task.py',
      policy: {
        ...basePolicy,
        allow_command_prefixes: ['node ', 'npm '],
      },
      allowlistMode: 'monitor',
    })

    expect(result.enforceViolations).toEqual([])
    expect(result.monitorViolations).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'allowlist_miss', pattern: 'python' })]),
    )
  })

  test('allowlist enforce mode blocks non-allowlisted command', async () => {
    const { evaluateCommandPolicy } = await import('../lib/policy.mjs')

    const result = evaluateCommandPolicy({
      command: 'python scripts/task.py',
      policy: {
        ...basePolicy,
        allow_command_prefixes: ['node ', 'npm '],
      },
      allowlistMode: 'enforce',
    })

    expect(result.monitorViolations).toEqual([])
    expect(result.enforceViolations).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'allowlist_miss', pattern: 'python' })]),
    )
  })

  test('denylist fallback remains active when allowlist is absent in enforce mode', async () => {
    const { evaluateCommandPolicy } = await import('../lib/policy.mjs')

    const result = evaluateCommandPolicy({
      command: 'rm -rf /tmp/foo',
      policy: {
        ...basePolicy,
      },
      allowlistMode: 'enforce',
    })

    expect(result.enforceViolations).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'deny_substring', pattern: 'rm -rf' })]),
    )
  })

  test('denylist cannot be bypassed even when command is allowlisted', async () => {
    const { evaluateCommandPolicy } = await import('../lib/policy.mjs')

    const result = evaluateCommandPolicy({
      command: 'rm -rf /tmp/foo',
      policy: {
        ...basePolicy,
        allow_command_prefixes: ['rm -rf '],
      },
      allowlistMode: 'enforce',
    })

    expect(result.enforceViolations).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'deny_substring', pattern: 'rm -rf' })]),
    )
  })

  test('synthetic cycle cap defaults to 3 and clamps to the supported range', async () => {
    const { loadPolicy, resolveMaxSyntheticCycles } = await import('../lib/policy.mjs')

    const policiesDir = path.join(__dirname, '..', 'policies')
    const strictPolicy = await loadPolicy({ policyName: 'strict', policiesDir })
    const warnings = []

    expect(strictPolicy.max_synthetic_cycles).toBe(3)
    expect(resolveMaxSyntheticCycles(null)).toBe(3)
    expect(
      resolveMaxSyntheticCycles({ max_synthetic_cycles: 0 }, { onWarning: (message) => warnings.push(message) }),
    ).toBe(1)
    expect(
      resolveMaxSyntheticCycles({ max_synthetic_cycles: 99 }, { onWarning: (message) => warnings.push(message) }),
    ).toBe(10)
    expect(warnings).toEqual([
      'Policy.max_synthetic_cycles=0 is outside 1-10; clamped to 1.',
      'Policy.max_synthetic_cycles=99 is outside 1-10; clamped to 10.',
    ])
  })
})
