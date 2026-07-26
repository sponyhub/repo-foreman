import { extractQuestionTexts } from './questions.mjs'

function normalizeQuestions(questions) {
  return extractQuestionTexts(questions)
}

export function splitQuestionCaptureQuestions(questionCapture = {}) {
  const blockingQuestions = normalizeQuestions(questionCapture.blocking_questions)
  const nonBlockingQuestions = normalizeQuestions(questionCapture.questions)
  return {
    blockingQuestions,
    nonBlockingQuestions,
    allQuestions: [...blockingQuestions, ...nonBlockingQuestions],
  }
}

export function formatQuestionEntries({ blockingQuestions = [], nonBlockingQuestions = [] } = {}) {
  const entries = []
  for (const question of blockingQuestions) {
    entries.push(`[blocking] ${question}`)
  }
  for (const question of nonBlockingQuestions) {
    entries.push(`[non-blocking] ${question}`)
  }
  return entries
}
