/** @jest-environment node */

import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { readUserAnswers, readUserAnswersDelta } from '../lib/user-input.mjs'

async function writeAnswers(runDir, content) {
  const answersPath = path.join(runDir, 'answers.md')
  await writeFile(answersPath, content, 'utf8')
}

describe('user-input answers handling', () => {
  it('returns the latest Answers section', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'codex-answers-'))
    const content = [
      'Intro line',
      '## Answers',
      '```json',
      '{ "answers": ["first answer"] }',
      '```',
      '## Answers',
      '```json',
      '{ "answers": ["second answer"] }',
      '```',
    ].join('\n')
    await writeAnswers(runDir, content)

    const answers = await readUserAnswers(runDir)

    expect(answers).toContain('second answer')
  })

  it('ignores preamble changes and detects updated Answers content', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'codex-answers-'))
    const initial = ['Intro line', '## Answers', '```json', '{ "answers": ["first answer"] }', '```'].join('\n')
    await writeAnswers(runDir, initial)

    const firstRead = await readUserAnswersDelta(runDir, { hash: null })
    expect(firstRead.answers).toContain('first answer')

    const preambleChanged = [
      'Intro line updated',
      '## Answers',
      '```json',
      '{ "answers": ["first answer"] }',
      '```',
    ].join('\n')
    await writeAnswers(runDir, preambleChanged)

    const secondRead = await readUserAnswersDelta(runDir, firstRead.nextCursor)
    expect(secondRead.answers).toBe('')

    const answersChanged = [
      'Intro line updated',
      '## Answers',
      '```json',
      '{ "answers": ["second answer"] }',
      '```',
    ].join('\n')
    await writeAnswers(runDir, answersChanged)

    const thirdRead = await readUserAnswersDelta(runDir, secondRead.nextCursor)
    expect(thirdRead.answers).toContain('second answer')
  })
})
