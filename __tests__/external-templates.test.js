/** @jest-environment node */

describe('PatchGantry prompt JSON rendering', () => {
  it('truncates large JSON payloads for prompt inlining', async () => {
    const { jsonStringifyForPrompt } = await import('../lib/templates.mjs')

    const payload = { large: 'x'.repeat(6000) }
    const rendered = jsonStringifyForPrompt(payload, { maxChars: 300, label: 'LARGE_PAYLOAD' })

    expect(rendered.length).toBeLessThanOrEqual(450)
    expect(rendered).toContain('[TRUNCATED LARGE_PAYLOAD')
    expect(rendered).toContain('original_chars=')
  })

  it('returns truncation metadata for prompt JSON rendering', async () => {
    const { renderJsonForPrompt } = await import('../lib/templates.mjs')

    const payload = { large: 'x'.repeat(6000) }
    const rendered = renderJsonForPrompt(payload, { maxChars: 300, label: 'LARGE_PAYLOAD' })

    expect(rendered.truncated).toBe(true)
    expect(rendered.originalChars).toBeGreaterThan(rendered.maxChars)
    expect(rendered.label).toBe('LARGE_PAYLOAD')
    expect(rendered.text).toContain('[TRUNCATED LARGE_PAYLOAD')
  })

  it('truncates large free-form text payloads for prompt inlining', async () => {
    const { renderTextForPrompt } = await import('../lib/templates.mjs')

    const payload = `${'A'.repeat(5000)}\n${'Z'.repeat(5000)}`
    const rendered = renderTextForPrompt(payload, { maxChars: 300, label: 'VERIFICATION_FEEDBACK' })

    expect(rendered.truncated).toBe(true)
    expect(rendered.originalChars).toBe(payload.length)
    expect(rendered.text.length).toBeLessThanOrEqual(300)
    expect(rendered.text).toContain('[TRUNCATED VERIFICATION_FEEDBACK')
    expect(rendered.text.startsWith('A')).toBe(true)
    expect(rendered.text.endsWith('Z')).toBe(true)
  })
})
