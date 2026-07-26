/**
 * @jest-environment node
 */

describe('branch naming (codex output validation)', () => {
  test('accepts valid words limited to candidate tokens', async () => {
    const { validateCodexBranchWords } = await import('../lib/branch-name-codex.mjs')

    const candidateTokens = ['oauth', 'callback', 'csrf', 'dev']
    const output = { words: ['oauth', 'csrf'] }

    expect(validateCodexBranchWords({ output, candidateTokens })).toEqual(['oauth', 'csrf'])
  })

  test('rejects words not present in candidate tokens', async () => {
    const { validateCodexBranchWords } = await import('../lib/branch-name-codex.mjs')

    const candidateTokens = ['oauth', 'callback', 'csrf', 'dev']
    const output = { words: ['oauth', 'production'] }

    expect(validateCodexBranchWords({ output, candidateTokens })).toBeNull()
  })

  test('drops generic verbs when at least 2 content tokens remain', async () => {
    const { validateCodexBranchWords } = await import('../lib/branch-name-codex.mjs')

    const candidateTokens = ['implement', 'oauth', 'callback', 'csrf', 'dev']
    const output = { words: ['implement', 'oauth', 'csrf'] }

    expect(validateCodexBranchWords({ output, candidateTokens })).toEqual(['oauth', 'csrf'])
  })
})
