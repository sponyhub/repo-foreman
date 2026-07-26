/** @jest-environment node */

const TEST_AWS_KEY = ['AKIA', '12345678', '90ABCDEF'].join('')

describe('RepoForeman policy', () => {
  it('blocks forbidden commands in event streams', async () => {
    const { detectForbiddenContent } = await import('../lib/policy.mjs')

    const policy = {
      version: 2,
      name: 'strict',
      deny_substrings: ['rm -rf', 'sudo'],
      deny_regex: ['\\bmkfs\\b'],
      deny_path_globs: [],
      allow_path_globs: [],
      deny_diff_regex: [],
      max_deleted_files: 0,
    }

    const violations = detectForbiddenContent(
      JSON.stringify({ type: 'tool_call', command: 'rm -rf /' }),
      policy,
    )
    expect(violations).toEqual([
      {
        kind: 'deny_substring',
        pattern: 'rm -rf',
      },
    ])
  })

  it('allows mktemp-scoped rm -rf cleanup in event streams', async () => {
    const { detectForbiddenContent } = await import('../lib/policy.mjs')

    const policy = {
      version: 2,
      name: 'strict',
      deny_substrings: ['rm -rf', 'sudo'],
      deny_regex: ['\\bmkfs\\b'],
      deny_path_globs: [],
      allow_path_globs: [],
      deny_diff_regex: [],
      max_deleted_files: 0,
    }

    const violations = detectForbiddenContent(
      "/bin/zsh -lc 'tmpdir=$(mktemp -d) && touch \"$tmpdir/file\"; rm -rf \"$tmpdir\"'",
      policy,
    )
    expect(violations).toEqual([])
  })

  it('blocks rm -rf when mktemp variable is reassigned before cleanup', async () => {
    const { detectForbiddenContent } = await import('../lib/policy.mjs')

    const policy = {
      version: 2,
      name: 'strict',
      deny_substrings: ['rm -rf', 'sudo'],
      deny_regex: ['\\bmkfs\\b'],
      deny_path_globs: [],
      allow_path_globs: [],
      deny_diff_regex: [],
      max_deleted_files: 0,
    }

    const violations = detectForbiddenContent(
      "/bin/zsh -lc 'tmpdir=$(mktemp -d); tmpdir=/; rm -rf \"$tmpdir\"'",
      policy,
    )
    expect(violations).toEqual([
      {
        kind: 'deny_substring',
        pattern: 'rm -rf',
      },
    ])
  })

  it('detects secret-like values in diffs', async () => {
    const { detectSecretDiffMatches } = await import('../lib/policy.mjs')

    const policy = {
      version: 2,
      name: 'strict',
      deny_substrings: [],
      deny_regex: [],
      deny_path_globs: [],
      allow_path_globs: [],
      deny_diff_regex: ['AKIA[0-9A-Z]{16}'],
      max_deleted_files: 0,
    }

    const diffText = [
      'diff --git a/file.txt b/file.txt',
      '+++ b/file.txt',
      `+AWS key: ${TEST_AWS_KEY}`,
    ].join('\n')

    const matches = detectSecretDiffMatches(diffText, policy)
    expect(matches).toEqual([
      {
        pattern: 'AKIA[0-9A-Z]{16}',
        match: TEST_AWS_KEY,
      },
    ])
  })
})
