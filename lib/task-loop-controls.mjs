import { extractQuestionTexts } from './questions.mjs'

function normalizeQuestion(question) {
  const [text] = extractQuestionTexts([question])
  return text ?? null
}

function normalizeAnswer(answer) {
  if (typeof answer === 'boolean') {
    return answer
  }
  if (typeof answer === 'string') {
    const normalized = answer.trim()
    return normalized || null
  }
  if (answer && typeof answer === 'object' && typeof answer.text === 'string') {
    const normalized = answer.text.trim()
    return normalized || null
  }
  return null
}

export function createQuestionSetSignature(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return ''
  }
  const normalized = questions
    .map((question) => normalizeQuestion(question))
    .filter(Boolean)
  if (normalized.length === 0) {
    return ''
  }
  return normalized.join('\n')
}

export function deriveTaskLoopLimits({ maxReviewFixAttempts } = {}) {
  const normalizedFixAttempts = Number.isFinite(maxReviewFixAttempts)
    ? Math.max(0, Math.floor(maxReviewFixAttempts))
    : 0
  return {
    maxReviewFixAttempts: normalizedFixAttempts,
    maxVerificationRetries: normalizedFixAttempts,
    maxAutoResolveAttempts: normalizedFixAttempts + 1,
    maxManagerAttempts: Math.max(2, Math.min(6, normalizedFixAttempts + 1)),
    maxCycles: Math.max(8, (normalizedFixAttempts + 1) * 4),
  }
}

export function buildAutonomousFallbackAnswersBlock(questions) {
  const normalizedQuestions = Array.isArray(questions)
    ? questions
        .map((question) => normalizeQuestion(question))
        .filter(Boolean)
    : []

  const answers = normalizedQuestions.length > 0
    ? normalizedQuestions.map(
        () =>
          'Proceed using the safest in-scope default and continue implementation. Do not execute out-of-scope follow-up work; record it in followups.',
      )
    : [
        'Proceed using the safest in-scope default and continue implementation. Do not execute out-of-scope follow-up work; record it in followups.',
      ]

  const payload = {
    answers,
    allow_edits: true,
    allow_tests: true,
  }

  return `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
}

export function buildAnswersBlockFromList(answers) {
  const normalizedAnswers = Array.isArray(answers)
    ? answers
        .map((answer) => normalizeAnswer(answer))
        .filter((answer) => answer !== null)
    : []

  const payload = {
    answers: normalizedAnswers.length > 0 ? normalizedAnswers : ['Proceed with the safest in-scope default.'],
    allow_edits: true,
    allow_tests: true,
  }

  return `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
}
