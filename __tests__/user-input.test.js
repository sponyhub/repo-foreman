/**
 * @jest-environment node
 */

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

describe('user input helpers', () => {
  test('hasMeaningfulAnswer ignores comment-only content', async () => {
    const { hasMeaningfulAnswer } = await import('../lib/user-input.mjs')

    expect(hasMeaningfulAnswer('# comment\n# another')).toBe(false)
    expect(hasMeaningfulAnswer('\n   \n')).toBe(false)
    expect(hasMeaningfulAnswer('# comment\nanswer here')).toBe(true)
  })

  test('readUserAnswers returns empty when only comments are present', async () => {
    const { readUserAnswers } = await import('../lib/user-input.mjs')

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-'))
    await fs.writeFile(path.join(tmpDir, 'answers.md'), '# nothing yet\n', 'utf8')

    const result = await readUserAnswers(tmpDir)
    expect(result).toBe('')
  })

  test('readUserAnswers ignores unstructured answers', async () => {
    const { readUserAnswers } = await import('../lib/user-input.mjs')

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-'))
    await fs.writeFile(path.join(tmpDir, 'answers.md'), '## Answers\n1) Not JSON\n', 'utf8')

    const result = await readUserAnswers(tmpDir)
    expect(result).toBe('')
  })

  test('readUserAnswers returns JSON answers block when structured', async () => {
    const { readUserAnswers } = await import('../lib/user-input.mjs')

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-'))
    const content = ['## Answers', '```json', '{ "answers": ["First answer"] }', '```', ''].join('\n')
    await fs.writeFile(path.join(tmpDir, 'answers.md'), content, 'utf8')

    const result = await readUserAnswers(tmpDir)
    expect(result).toContain('"answers"')
  })

  test('readUserAnswers accepts boolean structured answers', async () => {
    const { readUserAnswers, parseStructuredAnswers } = await import('../lib/user-input.mjs')

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-'))
    const content = ['## Answers', '```json', '{ "answers": [true, "dry-run"] }', '```', ''].join('\n')
    await fs.writeFile(path.join(tmpDir, 'answers.md'), content, 'utf8')

    const result = await readUserAnswers(tmpDir)
    expect(result).toContain('true')
    expect(parseStructuredAnswers(result)).toEqual({
      answers: [true, 'dry-run'],
      issues: [],
    })
  })

  test('ensureAnswersTemplate writes questions as comments', async () => {
    const { ensureAnswersTemplate, readUserAnswers } = await import('../lib/user-input.mjs')

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-'))
    const answersPath = await ensureAnswersTemplate(tmpDir, ['First question', 'Second question'])
    const content = await fs.readFile(answersPath, 'utf8')

    expect(content).toContain('# - First question')
    expect(content).toContain('# - Second question')
    expect(await readUserAnswers(tmpDir)).toBe('')
  })

  test('resolveAnswersMode prefers console for TTY unless CI', async () => {
    const { resolveAnswersMode } = await import('../lib/user-input.mjs')

    expect(resolveAnswersMode({ stdin: { isTTY: true }, stdout: { isTTY: true }, env: {} })).toBe('console')
    expect(resolveAnswersMode({ stdin: { isTTY: true }, stdout: { isTTY: true }, env: { CI: '1' } })).toBe('file')
    expect(resolveAnswersMode({ requestedMode: 'file', stdin: { isTTY: true }, stdout: { isTTY: true } })).toBe('file')
    expect(resolveAnswersMode({ requestedMode: 'console', stdin: { isTTY: false }, stdout: { isTTY: false } })).toBe(
      'console',
    )
  })

  test('readUserAnswersDelta returns only new answers after cursor', async () => {
    const { appendUserAnswers, readUserAnswersDelta, readAnswersCursor, writeAnswersCursor } = await import(
      '../lib/user-input.mjs',
    )

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-'))
    await appendUserAnswers(tmpDir, '```json\n{ "answers": ["First answer"] }\n```')

    const firstRead = await readUserAnswersDelta(tmpDir, { hash: null })
    expect(firstRead.answers).toContain('First answer')

    await writeAnswersCursor(tmpDir, firstRead.nextCursor)
    const cursor = await readAnswersCursor(tmpDir)
    const secondRead = await readUserAnswersDelta(tmpDir, cursor)
    expect(secondRead.answers).toBe('')
  })

  test('readUserAnswersDelta ignores unstructured answers until JSON is provided', async () => {
    const { readUserAnswersDelta } = await import('../lib/user-input.mjs')

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-'))
    await fs.writeFile(path.join(tmpDir, 'answers.md'), '## Answers\nNot JSON\n', 'utf8')

    const firstRead = await readUserAnswersDelta(tmpDir, { hash: null })
    expect(firstRead.answers).toBe('')

    const content = ['## Answers', '```json', '{ "answers": ["Structured"] }', '```', ''].join('\n')
    await fs.writeFile(path.join(tmpDir, 'answers.md'), content, 'utf8')

    const secondRead = await readUserAnswersDelta(tmpDir, { hash: null })
    expect(secondRead.answers).toContain('Structured')
  })
})
