import { isCriticalQuestion } from './questions.mjs'

function normalizeQuestionText(question) {
  if (typeof question === 'string') {
    const trimmed = question.trim().replace(/^\[blocking\]\s*/i, '')
    return trimmed || null
  }
  if (question && typeof question === 'object' && typeof question.text === 'string') {
    const trimmed = question.text.trim()
    return trimmed || null
  }
  return null
}

function isBlockingQuestion(question) {
  if (question && typeof question === 'object' && question.blocking === true) {
    return true
  }
  return isCriticalQuestion(question)
}

function defaultAutonomousAssumedAnswer(questionId) {
  return `Assumed safest compliant default for ${questionId} until explicit user confirmation is provided.`
}

function defaultAutonomousMitigation(questionId) {
  return `Document and validate ${questionId} with user confirmation before final merge.`
}

export function extractBlockingPrecheckQuestions(questions) {
  if (!Array.isArray(questions)) {
    return []
  }

  const blockingQuestions = []
  for (const question of questions) {
    if (!isBlockingQuestion(question)) {
      continue
    }
    const text = normalizeQuestionText(question)
    if (!text) {
      continue
    }
    blockingQuestions.push(text)
  }

  return blockingQuestions.map((question, index) => ({
    id: `BQ-${index + 1}`,
    question,
  }))
}

export function resolveBlockingQuestionPrecheck({
  mode = 'interactive',
  blockingQuestions = [],
  structuredAnswers = null,
  log = () => {},
} = {}) {
  const normalizedMode = mode === 'autonomous' ? 'autonomous' : 'interactive'
  const normalizedBlockingQuestions = Array.isArray(blockingQuestions)
    ? blockingQuestions
        .map((question) => {
          const id = typeof question?.id === 'string' && question.id.trim() ? question.id.trim() : null
          const text = typeof question?.question === 'string' ? question.question.trim() : ''
          if (!id || !text) {
            return null
          }
          return { id, question: text }
        })
        .filter(Boolean)
    : []
  const normalizedAnswers = Array.isArray(structuredAnswers)
    ? structuredAnswers.map((answer) => {
        if (typeof answer === 'string') {
          return answer.trim()
        }
        if (typeof answer === 'boolean') {
          return String(answer)
        }
        return ''
      })
    : []

  if (normalizedBlockingQuestions.length === 0) {
    return {
      blocking_questions: [],
      blocking_questions_resolved: true,
    }
  }

  if (normalizedMode === 'autonomous') {
    const resolvedQuestions = normalizedBlockingQuestions.map((question) => {
      const mitigation = defaultAutonomousMitigation(question.id)
      log(`Autonomous mode: treating blocking question '${question.id}' as assumption with mitigation: ${mitigation}`)
      return {
        id: question.id,
        question: question.question,
        assumed_answer: defaultAutonomousAssumedAnswer(question.id),
        mitigation,
        resolved_by: 'autonomous_assumption',
      }
    })
    return {
      blocking_questions: resolvedQuestions,
      blocking_questions_resolved: true,
    }
  }

  const resolvedQuestions = normalizedBlockingQuestions.map((question, index) => {
    const answer = normalizedAnswers[index] || null
    return {
      id: question.id,
      question: question.question,
      assumed_answer: answer,
      mitigation: null,
      resolved_by: answer ? 'user' : 'n/a',
    }
  })

  return {
    blocking_questions: resolvedQuestions,
    blocking_questions_resolved: resolvedQuestions.every((question) => question.resolved_by === 'user'),
  }
}
