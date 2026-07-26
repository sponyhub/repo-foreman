/** @jest-environment node */

describe('RepoForeman pretty event output', () => {
  it('pretty prints JSON lines when enabled', async () => {
    const { formatCodexEventLine } = await import('../lib/run.mjs')

    expect(formatCodexEventLine('{"type":"turn.started"}', { pretty: false })).toBe('{"type":"turn.started"}')
    expect(formatCodexEventLine('{"type":"turn.started"}', { pretty: true })).toBe('turn started')
    expect(formatCodexEventLine('not json', { pretty: true })).toBe('not json')
  })

  it('renders multiline strings as blocks (no literal \\\\n escapes)', async () => {
    const { formatCodexEventLine } = await import('../lib/run.mjs')

    const line = '{"type":"item.completed","item":{"aggregated_output":"a\\r\\nb\\n"}}'
    expect(formatCodexEventLine(line, { pretty: true })).toBe(
      'type: "item.completed"\nitem:\n  aggregated_output: |\n    a\n    b',
    )
  })
})
