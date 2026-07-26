/**
 * @jest-environment node
 */

describe('codex event line processing', () => {
  test('drops oversized lines and continues', async () => {
    const { createEventLineProcessor } = await import('../lib/codex.mjs')
    const lines = []
    const dropped = []

    const processor = createEventLineProcessor({
      maxLineLength: 10,
      onLine: (line) => lines.push(line),
      onTruncatedLine: (bytes) => dropped.push(bytes),
    })

    processor.write('aaaaaaaaaaaaaa\nok\n')
    processor.end()

    expect(lines).toEqual(['ok'])
    expect(dropped.length).toBe(1)
    expect(dropped[0]).toBeGreaterThan(10)
  })
})
