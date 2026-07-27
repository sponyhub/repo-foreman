/** @jest-environment node */

import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { parseAnswerDirectives, readUserAnswerDirectives } from '../lib/user-input.mjs'

async function writeAnswers(runDir, content) {
  const answersPath = path.join(runDir, 'answers.md')
  await writeFile(answersPath, content, 'utf8')
}

describe('answer directives parsing', () => {
  it('parses directives from a JSON block', () => {
    const answerText = [
      'notes',
      '```json',
      '{ "allow_edits": true, "allow_tests": false }',
      '```',
      'more',
    ].join('\n')

    const result = parseAnswerDirectives(answerText)

    expect(result.directives.allow_edits).toBe(true)
    expect(result.directives.allow_tests).toBe(false)
    expect(result.issues).toHaveLength(0)
  })

  it('parses directives from key-value lines', () => {
    const answerText = ['allow_edits: yes', 'allow_tests = no'].join('\n')

    const result = parseAnswerDirectives(answerText)

    expect(result.directives.allow_edits).toBe(true)
    expect(result.directives.allow_tests).toBe(false)
    expect(result.issues).toHaveLength(0)
  })

  it('reports conflicts and invalid values', () => {
    const answerText = ['allow_edits: true', 'allow_edits: false', 'allow_tests: maybe'].join('\n')

    const result = parseAnswerDirectives(answerText)

    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('uses the latest Answers section when reading directives', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'codex-answers-'))
    const content = [
      '## Answers',
      '```json',
      '{ "answers": ["First"], "allow_edits": false }',
      '```',
      '## Answers',
      '```json',
      '{ "answers": ["Second"], "allow_edits": true }',
      '```',
    ].join('\n')
    await writeAnswers(runDir, content)

    const result = await readUserAnswerDirectives(runDir)

    expect(result.directives.allow_edits).toBe(true)
  })
})
