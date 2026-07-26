import crypto from 'node:crypto'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileExists, readJsonFile, readTextFile, writeJsonFile, writeTextFile } from './fs.mjs'
import { extractQuestionTexts } from './questions.mjs'

const DEFAULT_ANSWERS_MODE = 'auto'

export function resolveAnswersMode({ requestedMode, stdin = process.stdin, stdout = process.stdout, env = process.env } = {}) {
  const normalized = typeof requestedMode === 'string' ? requestedMode.trim() : DEFAULT_ANSWERS_MODE
  if (normalized === 'file' || normalized === 'console') {
    return normalized
  }
  const hasTty = Boolean(stdin?.isTTY && stdout?.isTTY)
  const isCi = Boolean(env?.CI)
  return hasTty && !isCi ? 'console' : 'file'
}

export function hasMeaningfulAnswer(text) {
  if (typeof text !== 'string') {
    return false
  }
  return text.split('\n').some((line) => {
    const trimmed = line.trim()
    if (!trimmed) {
      return false
    }
    if (trimmed.startsWith('#')) {
      return false
    }
    return true
  })
}

function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, '\n')
}

function extractJsonBlocks(answerText) {
  if (typeof answerText !== 'string') {
    return []
  }
  return [...answerText.matchAll(/```json\s*([\s\S]*?)```/gi)].map((match) => match[1])
}

function extractAnswersSection(text) {
  if (typeof text !== 'string') {
    return ''
  }
  const normalized = normalizeLineEndings(text)
  const lines = normalized.split('\n')
  let startIndex = 0
  for (let i = 0; i < lines.length; i += 1) {
    if (/^##\s*Answers\b/i.test(lines[i])) {
      startIndex = i + 1
    }
  }
  return lines.slice(startIndex).join('\n')
}

function hashAnswers(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function parseBooleanValue(value) {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === 'yes' || normalized === '1') {
    return true
  }
  if (normalized === 'false' || normalized === 'no' || normalized === '0') {
    return false
  }
  return null
}

function normalizeDirectiveKey(key) {
  return key.toLowerCase().replace(/[^a-z]/g, '')
}

function mapDirectiveKey(rawKey) {
  const normalized = normalizeDirectiveKey(rawKey)
  if (normalized === 'allowedits') {
    return 'allow_edits'
  }
  if (normalized === 'allowtests') {
    return 'allow_tests'
  }
  return null
}

function parseJsonDirectives(answerText) {
  const blocks = extractJsonBlocks(answerText)
  if (blocks.length === 0) {
    return null
  }
  const jsonPayload = blocks[blocks.length - 1]
  const directives = {}
  const issues = []
  let parsed = null
  try {
    parsed = JSON.parse(jsonPayload)
  } catch (error) {
    issues.push('Directives JSON block could not be parsed.')
    return { directives, issues }
  }
  if (!parsed || typeof parsed !== 'object') {
    issues.push('Directives JSON block must be an object.')
    return { directives, issues }
  }
  for (const [key, value] of Object.entries(parsed)) {
    const mappedKey = mapDirectiveKey(key)
    if (!mappedKey) {
      continue
    }
    const parsedValue = parseBooleanValue(value)
    if (parsedValue == null) {
      issues.push(`Directive ${mappedKey} must be a boolean.`)
      continue
    }
    directives[mappedKey] = parsedValue
  }
  return { directives, issues }
}

export function parseStructuredAnswers(answerText) {
  const blocks = extractJsonBlocks(answerText)
  if (blocks.length === 0) {
    return { answers: null, issues: ['Structured answers must be provided as a JSON block.'] }
  }
  const jsonPayload = blocks[blocks.length - 1]
  let parsed = null
  try {
    parsed = JSON.parse(jsonPayload)
  } catch {
    return { answers: null, issues: ['Structured answers JSON block could not be parsed.'] }
  }
  const rawAnswers = parsed?.answers
  if (!Array.isArray(rawAnswers)) {
    return { answers: null, issues: ['Structured answers must include an "answers" array.'] }
  }
  const normalized = rawAnswers.map((value) => {
    if (typeof value === 'string') {
      return value.trim()
    }
    if (typeof value === 'boolean') {
      return value
    }
    return null
  })
  if (normalized.some((value) => value === null || value === '')) {
    return { answers: null, issues: ['All entries in the "answers" array must be non-empty strings or booleans.'] }
  }
  return { answers: normalized, issues: [] }
}

function hasStructuredAnswers(answerText) {
  const parsed = parseStructuredAnswers(answerText)
  return Array.isArray(parsed.answers) && parsed.answers.length > 0 && parsed.issues.length === 0
}

export function parseAnswerDirectives(answerText) {
  if (typeof answerText !== 'string' || !answerText.trim()) {
    return { directives: {}, issues: [] }
  }

  const jsonResult = parseJsonDirectives(answerText)
  if (jsonResult) {
    return jsonResult
  }

  const directives = {}
  const issues = []
  const seen = new Map()
  const lines = answerText.split('\n')
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9 _-]*)\s*[:=]\s*(.+)\s*$/)
    if (!match) {
      continue
    }
    const mappedKey = mapDirectiveKey(match[1])
    if (!mappedKey) {
      continue
    }
    const parsedValue = parseBooleanValue(match[2])
    if (parsedValue == null) {
      issues.push(`Directive ${mappedKey} must be a boolean.`)
      continue
    }
    if (seen.has(mappedKey) && seen.get(mappedKey) !== parsedValue) {
      issues.push(`Directive ${mappedKey} has conflicting values.`)
    }
    seen.set(mappedKey, parsedValue)
    directives[mappedKey] = parsedValue
  }

  return { directives, issues }
}

export function formatAnswersTemplate(questions = []) {
  const normalizedQuestions = extractQuestionTexts(questions)
  const lines = [
    '# PatchGantry Answers',
    '# Provide answers below. Remove the leading "#" or add new lines.',
    '# The run resumes when this file contains at least one non-comment line.',
    '',
    '## Open questions',
  ]

  if (normalizedQuestions.length > 0) {
    for (const question of normalizedQuestions) {
      lines.push(`# - ${question}`)
    }
  } else {
    lines.push('# (none)')
  }

  lines.push('')
  lines.push('## Answers')
  lines.push('# Provide structured answers as JSON (required).')
  lines.push('# Optional directives: allow_edits, allow_tests (top-level booleans).')
  lines.push('# Example:')
  lines.push('# ```json')
  lines.push('# { "answers": ["Answer 1", "Answer 2"], "allow_edits": true }')
  lines.push('# ```')
  lines.push('```json')
  lines.push(
    JSON.stringify(
      {
        answers: normalizedQuestions.length > 0 ? normalizedQuestions.map(() => '') : [''],
      },
      null,
      2,
    ),
  )
  lines.push('```')
  lines.push('')

  return `${lines.join('\n')}\n`
}

export async function readAnswersCursor(runDir) {
  const cursorPath = path.join(runDir, 'answers.cursor.json')
  if (!(await fileExists(cursorPath))) {
    return { hash: null }
  }
  try {
    const data = await readJsonFile(cursorPath)
    const hash = typeof data?.hash === 'string' && data.hash.trim() ? data.hash.trim() : null
    return { hash }
  } catch {
    return { hash: null }
  }
  return { hash: null }
}

export async function writeAnswersCursor(runDir, cursor) {
  const cursorPath = path.join(runDir, 'answers.cursor.json')
  const hash = typeof cursor?.hash === 'string' && cursor.hash.trim() ? cursor.hash.trim() : null
  await writeJsonFile(cursorPath, { hash })
}

export async function ensureAnswersTemplate(runDir, questions = []) {
  const answersPath = path.join(runDir, 'answers.md')
  if (await fileExists(answersPath)) {
    return answersPath
  }
  await writeTextFile(answersPath, formatAnswersTemplate(questions))
  return answersPath
}

export async function appendUserAnswers(runDir, answers, questions = []) {
  const answersPath = await ensureAnswersTemplate(runDir, questions)
  const existing = await readTextFile(answersPath)
  const trimmed = typeof answers === 'string' ? answers.trim() : ''
  if (!trimmed) {
    return { answersPath, length: existing.length }
  }
  const separator = existing.endsWith('\n') ? '' : '\n'
  const updated = `${existing}${separator}${trimmed}\n`
  await writeTextFile(answersPath, updated)
  return { answersPath, length: updated.length }
}

export async function readUserAnswers(runDir) {
  const answersPath = path.join(runDir, 'answers.md')
  if (!(await fileExists(answersPath))) {
    return ''
  }
  const text = await readTextFile(answersPath)
  const extracted = extractAnswersSection(text)
  if (!hasMeaningfulAnswer(extracted)) {
    return ''
  }
  const normalized = normalizeLineEndings(extracted)
  if (!hasStructuredAnswers(normalized)) {
    return ''
  }
  return normalized.trim()
}

export async function readUserAnswerDirectives(runDir) {
  const answers = await readUserAnswers(runDir)
  return parseAnswerDirectives(answers)
}

export async function readUserAnswersDelta(runDir, cursor = {}) {
  const answersPath = path.join(runDir, 'answers.md')
  if (!(await fileExists(answersPath))) {
    return { answers: '', nextCursor: cursor, issues: [] }
  }
  const text = await readTextFile(answersPath)
  const extracted = extractAnswersSection(text)
  if (!hasMeaningfulAnswer(extracted)) {
    return { answers: '', nextCursor: cursor, issues: [] }
  }
  const normalized = normalizeLineEndings(extracted)
  const nextHash = hashAnswers(normalized)
  if (cursor?.hash === nextHash) {
    return { answers: '', nextCursor: cursor, issues: [] }
  }
  const parsed = parseStructuredAnswers(normalized)
  if (!parsed.answers) {
    return { answers: '', nextCursor: { hash: nextHash }, issues: parsed.issues }
  }
  return { answers: normalized.trim(), nextCursor: { hash: nextHash }, issues: [] }
}

export async function readOpenQuestions(runDir) {
  const questionsPath = path.join(runDir, 'open_questions.md')
  if (!(await fileExists(questionsPath))) {
    return ''
  }
  const text = await readTextFile(questionsPath)
  return text.trim()
}

export async function promptForConsoleAnswers({ questions, ui }) {
  const log = ui?.log?.bind(ui) ?? console.log
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answers = []
  const normalizedQuestions = extractQuestionTexts(questions)
  if (normalizedQuestions.length > 0) {
    log('Answer each question. Responses are captured as structured JSON.')
    let index = 0
    for (const question of normalizedQuestions) {
      index += 1
      log(`Q${index}: ${question}`)
      while (true) {
        const response = await rl.question('> ')
        const answer = response.trim()
        if (answer) {
          answers.push(answer)
          break
        }
        log('Answer required; enter a non-empty response.')
      }
    }
  } else {
    log('Enter answers below. Finish with a line containing only "."')
    const lines = []
    while (true) {
      const line = await rl.question('> ')
      if (line.trim() === '.') {
        break
      }
      lines.push(line)
    }
    const combined = lines.join('\n').trim()
    if (combined) {
      answers.push(combined)
    }
  }
  rl.close()
  if (answers.length === 0) {
    return ''
  }
  return `\`\`\`json\n${JSON.stringify({ answers }, null, 2)}\n\`\`\``
}
